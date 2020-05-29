const metadata = require('./metadata')
const Free = require('./free')

const providers = [
  ['eos', require('dazaar-payment-eos')],
  ['eos-testnet', require('dazaar-payment-eos/testnet')],
  ['lnd', require('dazaar-payment-lightning')],
  ['clightning', require('dazaar-payment-lightning')]
]

module.exports = class DazaarPayment {
  constructor (seller, payments, opts) {
    if (payments && !Array.isArray(payments)) payments = []

    this.sellerKey = seller.key
    this.providers = []

    if (!payments || payments.length === 0) {
      this.providers.push(new Free())
    } else {
      for (const pay of payments) {
        const p = findProvider(seller, pay, opts)
        this.providers.push(p)
      }
    }
  }

  metadata (buyer) {
    return metadata(this.sellerKey, buyer)
  }

  destroy () {
    for (const p of this.providers) {
      if (p) p.destroy()
    }
  }

  validate (key, cb) {
    const self = this
    let i = 0

    loop()

    function loop () {
      if (i >= self.providers.length) return cb(new Error('No payment is supported'))
      const provider = self.providers[i++]
      if (!provider) return process.nextTick(loop)
      provider.validate(key, onvalidate)
    }

    function onvalidate (err, info) {
      if (err) {
        if (i >= self.providers.length) return cb(err)
        return loop()
      }
      cb(null, info)
    }
  }

  value (seller, time) {
    var paymentOptions = []

    for (let p of this.providers) {
      for (let pay of seller.payment) {
        if (!p.supports(pay)) continue
        paymentOptions.push({
          amount: time * convertDazaarPayment(pay),
          currency: pay.currency,
          provider: p
        })
      }
    }

    if (!paymentOptions.length) {
      throw new Error('Payments not supported')
    }

    return paymentOptions
  }

  buy (seller, amount, auth, provider, cb) {
    if (typeof auth === 'function') return this.buy(seller, amount, null, null, auth)
    if (typeof provider === 'function') return this.buy(seller, amount, auth, null, provider)
    if (!provider) provider = this.providers[0]
    if (!auth) auth = {}

    if (!provider)
    for (let p of this.providers) {
      for (let pay of seller.payment) {
        if (!p.supports(pay)) provider = p
        break
      }
    }

    provider.buy(seller.id, amount, auth, cb)
  }
}

function findProvider (seller, payment, opts) {
  for (const [label, P] of providers) {
    if (P.supports(payment) && (!payment.label || label === payment.label)) {
      return new P(seller, payment, opts[label])
    }
  }
  return null
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

  const perSecond = Number(pay.amount) / (Number(pay.interval) * ratio)
  if (!perSecond) throw new Error('Invalid payment info')

  return perSecond
}
