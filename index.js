var Peer = require('peerjs')
var EJSON = require('ddp-ejson')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var shortid = require('shortid')
var optsSchema = require('./opts-schema')

var SupportedDdpVersions = ['1']

function PDiddyClient (opts) {
  var self = this

  if (!(self instanceof PDiddyClient)) return new PDiddyClient(opts)

  opts = optsSchema.validate(opts).value

  self._opts = opts
  self._callbacks = {}
  self._updatedCallbacks = {}
  self._observers = {}

  self.collections = {}
}
inherits(PDiddyClient, EventEmitter)

PDiddyClient.prototype._send = function (data) {
  this._peerConn.send(EJSON.stringify(data))
}

// handle a message from the server
PDiddyClient.prototype._message = function (data) {
  var self = this

  data = EJSON.parse(data)

  // TODO: 'addedBefore' -- not yet implemented in Meteor
  // TODO: 'movedBefore' -- not yet implemented in Meteor

  if (!data.msg) return

  var cb, name, id

  if (data.msg === 'failed') {
    if (SupportedDdpVersions.indexOf(data.version) !== -1) {
      self._opts.ddpVersion = data.version
      self.connect(self._peerId, function (err) {
        if (err) return self.emit('failed', 'Cannot negotiate DDP version')
        console.log('Successfully negotiated DDP version')
      })
    } else {
      self.emit('failed', 'Cannot negotiate DDP version')
    }
  } else if (data.msg === 'connected') {
    self.session = data.session
    self.emit('connected')
  // method result
  } else if (data.msg === 'result') {
    cb = self._callbacks[data.id]

    if (cb) {
      delete self._callbacks[data.id]
      cb(data.error, data.result)
    }
  // method updated
  } else if (data.msg === 'updated') {
    data.methods.forEach(function (method) {
      var cb = self._updatedCallbacks[method]
      if (cb) {
        delete self._updatedCallbacks[method]
        cb()
      }
    })
  // missing subscription
  } else if (data.msg === 'nosub') {
    cb = self._callbacks[data.id]

    if (cb) {
      delete self._callbacks[data.id]
      cb(data.error)
    }
  // add document to collection
  } else if (data.msg === 'added') {
    if (self.collections && data.collection) {
      name = data.collection
      id = data.id

      self.collections[name] = self.collections[name] || {}
      self.collections[name][id] = self.collections[name][id] || {}
      self.collections[name][id]._id = id

      if (data.fields) {
        Object.keys(data.fields).forEach(function (key) {
          self.collections[name][id][key] = data.fields[key]
        })
      }

      if (self._observers[name]) {
        Object.keys(self._observers[name]).forEach(function (observerId) {
          self._observers[name][observerId].added(id)
        })
      }
    }

  // remove document from collection
  } else if (data.msg === 'removed') {
    if (self.collections && data.collection) {
      name = data.collection
      id = data.id

      if (!self.collections[name][id]) return

      var oldValue = self.collections[name][id]

      delete self.collections[name][id]

      if (self._observers[name]) {
        Object.keys(self._observers[name]).forEach(function (observerId) {
          self._observers[name][observerId].removed(id, oldValue)
        })
      }
    }

  // change document in collection
  } else if (data.msg === 'changed') {
    if (self.maintainCollections && data.collection) {
      name = data.collection
      id = data.id

      if (!self.collections[name]) return
      if (!self.collections[name][id]) return

      var oldFields = {}
      var clearedFields = data.cleared || []
      var newFields = {}

      if (data.fields) {
        Object.keys(data.fields).forEach(function (key) {
          oldFields[key] = self.collections[name][id][key]
          newFields[key] = data.fields[key]
          self.collections[name][id][key] = data.fields[key]
        })
      }

      if (data.cleared) {
        data.cleared.forEach(function (value) {
          delete self.collections[name][id][value]
        })
      }

      if (self._observers[name]) {
        Object.keys(self._observers[name]).forEach(function (observerId) {
          self._observers[name][observerId].changed(id, oldFields, clearedFields, newFields)
        })
      }
    }
  // subscriptions ready
  } else if (data.msg === 'ready') {
    data.subs.forEach(function (id) {
      var cb = self._callbacks[id]
      if (cb) {
        delete self._callbacks[id]
        cb()
      }
    })
  } else if (data.msg === 'ping') {
    self._send(data.id ? {msg: 'pong', id: data.id} : {msg: 'pong'})
  }
}

PDiddyClient.prototype._addObserver = function (observer) {
  var self = this
  self._observers[observer.name] = self._observers[observer.name] || {}
  self._observers[observer.name][observer._id] = observer
}

PDiddyClient.prototype._removeObserver = function (observer) {
  var self = this
  if (!self._observers[observer.name]) return
  delete self._observers[observer.name][observer._id]
}

PDiddyClient.prototype.connect = function (peerId, cb) {
  var self = this
  var opts = self._opts
  var cbCalled = false

  self._peerId = peerId

  if (opts.key) {
    self._peer = new Peer({key: opts.key})
  } else {
    self._peer = new Peer({host: opts.host, port: opts.port, path: opts.path})
  }

  self._peer.on('open', function () {
    var conn = self._peer.connect(peerId)

    conn.on('open', function () {
      if (cbCalled) return

      self._send({
        msg: 'connect',
        version: opts.ddpVersion,
        support: SupportedDdpVersions
      })

      cbCalled = true
      cb()
    })

    conn.on('data', function (data) {
      self._message(data)
    })

    self._peerConn = conn
  })

  self._peer.on('error', function (err) {
    if (cbCalled) return
    cbCalled = true
    cb(err)
  })
}

PDiddyClient.prototype.call = function (name, params, cb, updatedCb) {
  var self = this
  var id = shortid()

  if (cb) {
    self._callbacks[id] = function () {
      cb.apply(this, arguments)
    }
  }

  if (updatedCb) {
    self._updatedCallbacks[id] = function () {
      updatedCb.apply(this, arguments)
    }
  }

  self._send({msg: 'method', id: id, method: name, params: params})
}

PDiddyClient.prototype.subscribe = function (name, params, cb) {
  var self = this
  var id = shortid()

  if (cb) {
    self._callbacks[id] = cb
  }

  self._send({msg: 'sub', id: id, name: name, params: params})

  return id
}

PDiddyClient.prototype.unsubscribe = function (id) {
  this._peerConn.send({msg: 'unsub', id: id})
}

PDiddyClient.prototype.observe = function (name, added, updated, removed) {
  var self = this
  var observer = {}
  var id = shortid()

  // name, _id are immutable
  Object.defineProperty(observer, 'name', {
    get: function () { return name },
    enumerable: true
  })

  Object.defineProperty(observer, '_id', {
    get: function () { return id }
  })

  var noop = function () {}

  observer.added = added || noop
  observer.updated = updated || noop
  observer.removed = removed || noop
  observer.stop = self._removeObserver.bind(this, observer)

  self._addObserver(observer)

  return observer
}

PDiddyClient.prototype.disconnect = function () {
  var self = this

  if (self._peerConn) {
    self._peerConn.close()
    self._peerConn = null
  }

  if (self._peer) {
    self._peer.disconnect()
    self._peer.destroy()
    self._peer = null
  }
}

PDiddyClient.EJSON = EJSON

module.exports = PDiddyClient
