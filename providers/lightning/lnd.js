const LndGrpc = require('grpc-lnd')
const { EventEmitter } = require('events')

process.env.GRPC_SSL_CIPHER_SUITES = 'HIGH+ECDSA'

module.exports = class Payment {
  constructor (opts) {
    this.client = LndGrpc(opts)
    this.invoiceStream = this.client.subscribeInvoices({})
    this.lastIndex = 0

    this.requests = []
  }

  getNodeId (cb) {
    this.client.getInfo({}, function (err, res) {
      if (err) return cb(err)
      cb(null, res.identity_pubkey)
    })
  }

  connect (opts, cb) {
    const self = this

    this.client.listPeers({}, function (err, res) {
      if (err) return cb(err)

      if (res.peers.indexOf(peer => peer.pub_key === opts.id) >= 0) return cb()

      const nodeAddress = {
        pubkey: opts.id,
        address: opts.address
      }

      const request = {
        addr: nodeAddress,
        perm: true
      }

      self.client.connectPeer(request, cb)
    })
  }

  subscription (filter, rate) {
    const self = this
    let perSecond = 0

    if (typeof rate === 'object' && rate) { // dazaar card
      perSecond = convertDazaarPayment(rate)
    } else {
      try {
        const match = rate.trim().match(/^(\d(?:\.\d+)?)\s*BTC\s*\/\s*s$/i)
        if (!match) throw new Error()
        perSecond = Number(match[1]) * 10 ** 8
      } catch {
        const match = rate.trim().match(/^(\d+)(?:\.\d+)?\s*Sat\/\s*s$/i)
        if (!match) throw new Error('rate should have the form "n....nn Sat/s" or "n...nn BTC/s"')
        perSecond = Number(match[1])
      }
    }

    const sub = new EventEmitter()

    let activePayments = []

    sub.synced = false
    sync()

    self.invoiceStream.on('data', filterInvoice)

    sub.active = function (minSeconds) {
      return sub.remainingFunds(minSeconds) > 0
    }

    sub.destroy = function () {
      sub.removeListener('data', filterInvoice)
    }

    sub.remainingTime = function (minSeconds) {
      const funds = sub.remainingFunds(minSeconds)
      return Math.floor(Math.max(0, funds / perSecond * 1000))
    }

    sub.remainingFunds = function (minSeconds) {
      if (!minSeconds) minSeconds = 0

      const now = Date.now() + minSeconds * 1000
      const funds = activePayments.reduce(leftoverFunds, 0)

      return funds

      function leftoverFunds (funds, payment, i) {
        const nextTime = i + 1 < activePayments.length ? activePayments[i + 1].time : now

        const consumed = perSecond * (nextTime - payment.time) / 1000
        funds += payment.amount - consumed

        return funds > 0 ? funds : 0
      }
    }

    return sub

    function filterInvoice (invoice) {
      if (invoice.memo !== filter || !invoice.settled) return

      const amount = parseInt(invoice.value)
      const time = parseInt(invoice.settle_date) * 1000

      activePayments.push({ amount, time })

      sub.emit('update')
    }

    function sync () {
      self.client.listInvoices({}, function (err, res) {
        // CHECK: error handling
        if (err) {
          sub.destroy()
          sub.emit('warning', err)
          return
        }

        const dazaarPayments = res.invoices
          .filter(invoice => invoice.settled && invoice.memo === filter)

        const payments = dazaarPayments.map(payment => ({
          amount: parseInt(payment.value),
          time: parseInt(payment.settle_date) * 1000
        }))

        activePayments = [].concat(activePayments, payments)

        sub.synced = true
        sub.emit('synced')
      })
    }
  }

  addInvoice (filter, amount, cb) {
    if (!cb) cb = noop

    this.client.addInvoice({
      memo: filter,
      value: amount
    }, function (err, res) {
      if (err) return cb(err)

      const invoice = {
        request: res.payment_request,
        amount: amount
      }

      cb(null, invoice)
    })
  }

  payInvoice (paymentRequest, cb) {
    const self = this
    if (!cb) cb = noop

    this.client.decodePayReq({
      pay_req: paymentRequest
    }, function (err, details) {
      if (err) return cb(err)

      // invoice verification logic
      const [label, info] = details.description.split(':')

      if (label !== 'dazaar') return fail()

      const [seller, buyer] = info.trim().split(' ')

      const invoice = {
        buyer,
        seller,
        amount: parseInt(details.num_satoshis)
      }

      const index = self.requests.findIndex(matchRequest(invoice))
      if (index === -1) return fail()

      self.requests.splice(index, 1)

      const call = self.client.sendPayment()
      call.write({
        payment_request: paymentRequest
      })

      call.on('data', function (payment) {
        if (payment.payment_error === '') return cb(null, payment)
        return cb(new Error(payment.payment_error))
      })
    })

    function fail () {
      return cb(new Error('unrecognised invoice'))
    }

    function matchRequest (inv) {
      return req => {
        return req.buyer === inv.buyer &&
          req.seller === inv.seller &&
          req.amount === inv.amount
      }
    }
  }

  earnings () {
    const earnings = {}
    for (const user of this.users) {
      earnings[user] = this.settled.reduce(function (acc, payment) {
        if (payment.ref.split(':')[1] !== user) return acc
        return acc + payment.amount
      }, 0)
    }
    return earnings
  }
}

function noop () {}

function convertDazaarPayment (pay) {
  let ratio = 0

  switch (pay.unit) {
    case 'minutes':
      ratio = 60
      break
    case 'seconds':
      ratio = 1
      break
    case 'hours':
      ratio = 3600
      break
  }

  let satoshiAmt

  if (pay.currency === 'LightningSats') satoshiAmt = Number(pay.amount)
  if (pay.currency === 'LightningBTC') satoshiAmt = toSats(Number(pay.amount))

  const perSecond = satoshiAmt / (Number(pay.interval) * ratio)
  if (!perSecond) throw new Error('Invalid payment info')

  return perSecond
}

function toSats (btcAmount) {
  return btcAmount * 10 ** 8
}
