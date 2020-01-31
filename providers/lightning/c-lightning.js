const crypto = require('crypto')
const unixson = require('unixson')
const { EventEmitter } = require('events')

module.exports = class Payment {
  constructor (opts) {
    this.client = unixson(opts.lightningdDir + '/regtest/lightning-rpc')
    this.requests = []
  }

  getNodeId (cb) {
    this.client.getinfo()
      .then(res => {
        cb(null, res.result.id)
      })
      .catch(err => cb(err))
  }

  connect (opts, cb) {
    if (!cb) cb = noop
    const self = this

    this.client.listpeers()
      .then(res => {
        const peers = res.result.peers

        if (peers.indexOf(peer => peer.pub_key === opts.id) >= 0) return cb()

        const [host, port] = opts.address.split(':')

        self.client.connect(opts.pubkey, host, port)
          .then(res => cb(null, res))
          .catch(err => cb(err))
      })
      .catch(err => cb(err))
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
    sync(tail)

    sub.active = function (minSeconds) {
      return sub.remainingFunds(minSeconds) > 0
    }

    sub.destroy = function () {}

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

    function sync (cb) {
      self.client.listinvoices()
        .then(res => {
          const dazaarPayments = res.result.invoices
            .filter(invoice => invoice.status === 'paid' && invoice.description === filter)

          sub._lastpayIndex = Math.max(...dazaarPayments.map(inv => inv.pay_index))

          const payments = dazaarPayments.map(payment => ({
            amount: payment.msatoshi / 1000,
            time: parseInt(payment.paid_at) * 1000
          }))

          activePayments = [].concat(activePayments, payments)

          sub.synced = true
          sub.emit('synced')
          cb()
        })
        .catch(err => {
          sub.emit('warning', err)
        })
    }

    function tail (index) {
      index = index || sub._lastpayIndex
      self.client.waitanyinvoice(index)
        .then(function (res) {
          const invoice = res.result

          filterInvoice(invoice)

          return tail(++index)
        })
        .catch(err => {
          sub.emit('warning', err)
        })
    }

    function filterInvoice (invoice) {
      if (invoice.description !== filter) return

      const amount = parseInt(invoice.msatoshi) / 1000
      const time = parseInt(invoice.paid_at) * 1000

      activePayments.push({ amount, time })

      sub.emit('update')
    }
  }

  addInvoice (filter, amount, cb) {
    // generate unique label per invoice
    const tag = `${filter}:${Date.now()}`
    const label = crypto.createHash('sha256')
      .update(Buffer.from(tag))
      .digest('base64')

    const amountMsat = amount * 1000

    return this.client.invoice(amountMsat, label, filter)
      .then(res => {
        const invoice = {
          request: res.result.bolt11,
          amount: amount
        }
        cb(null, invoice)
      })
      .catch(err => cb(err))
  }

  payInvoice (paymentRequest, cb) {
    const self = this
    if (!cb) cb = noop

    self.client.decodepay(paymentRequest)
      .then(res => {
        const details = res.result

        const [label, info] = details.description.split(':')

        if (label !== 'dazaar') return fail()

        const [seller, buyer] = info.trim().split(' ')

        const invoice = {
          buyer,
          seller,
          amount: parseInt(details.msatoshi) / 1000
        }

        const index = self.requests.findIndex(matchRequest(invoice))
        if (index === -1) return fail()

        self.requests.splice(index, 1)

        self.client.pay(paymentRequest)
          .then(payment => {
            if (payment.error) return cb(new Error(payment.error.message))

            cb(null, payment)
          })
          .catch(err => cb(err))
      })
      .catch(err => cb(err))

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
}

function noop () {}

function toSats (btcAmount) {
  return btcAmount * 10 ** 8
}

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
