# dazaar-payment

Dazaar payment manager.

```
npm install dazaar-payment
```

Supports EOS and free payments.

## Usage

``` js
const Payment = require('dazaar-payment')

const pay = new Payment(seller, [{
  // dazaar card payment entry
  currency: 'EOS',
  ...
}])
```

## API

#### `pay.validate(remoteKey, done)`

Validate if a remote key can access a sellers stream.
Returns an info object describing the state of the subscription.

#### `pay.destroy()`

Destroy the payment provider.

#### `pay.metadata(buyerKey)`

Returns a metadata string you should attach as the memo/userdata when
doing a payment yourself.

#### `pay.providers`

An array of payment providers, each corresponding to the payment entry passed in the constructor.
If the payment was not support it might contain null.

#### `provider.buy(buyerKey, amount, authentication, cb)`

Convenience method to buy access to a stream using the provider.

## License

MIT
