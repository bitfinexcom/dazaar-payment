const EOS = require('./eos')

module.exports = class EOSTestnet extends EOS {
  constructor (seller, payment, opts = {}) {
    super(seller, payment, { ...opts, chainId: '5fff1dae8dc8e2fc4d5b23b2c7665c97f9e9d8edf2b6485a86ba311c25639191', rpc: 'https://api-kylin.eoslaomao.com' })
  }

  static supports (pay) {
    return pay.currency === 'EOS Testnet'
  }
}
