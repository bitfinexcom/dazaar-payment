module.exports = class DazaarFree {
  validate (key, cb) {
    process.nextTick(cb, null, { type: 'free' })
  }

  buy (buyer, amount, auth, cb) {
    process.nextTick(cb, null)
  }

  destroy () { }

  static supports (payment) {
    return false
  }
}
