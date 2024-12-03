const enhanceServer = require('express-ws')
const {decrypt} = require('@welshman/signer')
const {NOSTR_CONNECT, matchFilters, createEvent} = require('@welshman/util')
const {appSigner} = require('./env')
const {server} = require('./server')

enhanceServer(server)

const subscriptions = new Map()

server.ws('/', socket => {
  const connection = new Connection(socket)

  console.log('connect')

  socket.on('message', msg => connection.handle(msg))
  socket.on('error', e => console.error("Received error on client socket", e))
  socket.on('close', () => connection.cleanup())
})

const makeResponse = async (recipient, payload) => {
  const tags = [["p", recipient]]
  const content = await appSigner.nip44.encrypt(recipient, JSON.stringify(payload))
  const event = await appSigner.sign(createEvent(NOSTR_CONNECT, {tags, content}))

  return event
}

const startSession = async ({client_pubkey, connect_secret}) => {
  const event = await makeResponse(client_pubkey, {result: connect_secret})

  for (const [id, {connection, filters}] of subscriptions.entries()) {
    if (matchFilters(filters, event)) {
      connection.send(['EVENT', id, event])
    }
  }
}

class Connection {

  // Lifecycle

  constructor(socket) {
    this._socket = socket
    this._ids = new Set()
  }

  cleanup() {
    this._socket.close()

    for (const id of this._ids) {
      this.removeSub(id)
    }
  }

  // Subscription management

  addSub(id, filters) {
    subscriptions.set(id, {connection: this, filters})
    this._ids.add(id)
  }

  removeSub(id) {
    subscriptions.delete(id)
    this._ids.delete(id)
  }

  // Send/receive

  send(message) {
    this._socket.send(JSON.stringify(message))
  }

  handle(message) {
    try {
      message = JSON.parse(message)
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to parse message'])
    }

    let verb, payload
    try {
      [verb, ...payload] = message
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to read message'])
    }

    const handler = this[`on${verb}`]

    if (handler) {
      handler.call(this, ...payload)
    } else {
      this.send(['NOTICE', '', `Unable to handle ${verb} message`])
    }
  }

  // Verb-specific handlers

  onCLOSE(id) {
    this.removeSub(id)
  }

  onREQ(id, ...filters) {
    console.log('REQ', id, ...filters)

    if (filters.every(f => f.kinds?.includes(24133))) {
      this.addSub(id, filters)
      this.send(['EOSE', id])
    } else {
      this.send(['NOTICE', '', 'Only filters matching kind 24133 events are accepted'])
    }
  }

  async onEVENT(event) {
    const pubkey = await appSigner.getPubkey()

    console.log('EVENT', event)

    if (event.kind !== 24133) {
      return this.send(['OK', event.id, false, 'Only kind 24133 events are accepted'])
    }

    if (!event.tags?.some(t => t[0] === 'p' && t[1] === pubkey)) {
      return this.send(['OK', event.id, false, 'Event must p-tag this relay'])
    }

    try {
      event.content = decrypt(appSigner, event.pubkey, event.content)
    } catch (e) {
      return this.send(['OK', event.id, false, 'Failed to decrypt event content'])
    }

    this.send(['OK', event.id, true, ""])
  }
}

module.exports = {startSession}
