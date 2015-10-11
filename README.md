# pdiddy-client

P2P DDP client using PeerJS. Code is based _heavily_ on the excellent [ddp-client](https://github.com/oortcloud/node-ddp-client).

## Example

```js
var PDiddy = require('pdiddy-client')

var client = new PDiddy({
  key: '<Your PeerJS Server key>',
  // OR
  host: '<peer server host>',
  port: '<peer server port>',
  path: '<peer server path>'
})

// Connect to another peer
client.connect('<Peer ID>', function (err) {
  if (err) throw err

  // Call meteor method
  client.call('<method name>', ['<arg1>', '<arg2>', '...'], function (err, res) {
    if (err) throw err
    console.log('Method result:', res)
  })
})
```
