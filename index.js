const metadata = require('./metadata')
const Free = require('./free')

const providers = [
  require('dazaar-payment-eos'),
  require('dazaar-payment-eos/testnet'),
  require('dazaar-payment/lightning')
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

  buy (buyer, amount, auth, cb) {
    if (!auth) auth = {}
    if (typeof auth === 'function') return this.buy(buyer, amount, {}, auth)

    const provider = this.providers.find(x => x)

    if (!provider) {
      throw new Error('Payments not supported')
    }

    provider.buy(buyer, amount, auth, cb)
  }
}

function findProvider (seller, payment, opts) {
  for (const P of providers) {
    if (P.supports(payment)) return new P(seller, payment, opts)
  }
  return null
}
