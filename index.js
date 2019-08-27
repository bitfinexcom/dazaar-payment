const metadata = require('./metadata')
const Free = require('./providers/free')

const providers = [
  require('./providers/eos')
]

module.exports = class DazaarPayment {
  constructor (seller, payments, opts) {
    if (payments && !Array.isArray(payments)) payments = []

    this.seller = seller
    this.providers = []

    if (!payments) {
      this.providers.push(new Free())
    } else {
      for (const pay of payments) {
        const p = findProvider(seller, pay, opts)
        this.providers.push(p)
      }
    }
  }

  metadata (buyer) {
    return metadata(this.seller, buyer)
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
}

function findProvider (seller, payment, opts) {
  for (const P of providers) {
    if (P.supports(payment)) return new P(seller, payment, opts)
  }
  return null
}