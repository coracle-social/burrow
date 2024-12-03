const enhanceServer = require('express-ws')
const {decrypt} = require('@welshman/signer')
const {parseJson, switcher, tryCatch} = require('@welshman/lib')
const {NOSTR_CONNECT, matchFilters, createEvent} = require('@welshman/util')
const {appSigner, LOG_NIP46_MESSAGES, LOG_RELAY_MESSAGES} = require('./env')
const {server} = require('./server')
const {loadSession} = require('./database')

enhanceServer(server)

const sessions = new Map()
const subscriptions = new Map()

server.ws('/', socket => {
  const connection = new Connection(socket)

  socket.on('message', msg => connection.handle(msg))
  socket.on('error', () => connection.cleanup())
  socket.on('close', () => connection.cleanup())
})

const makeResponse = async (recipient, payload) => {
  const tags = [["p", recipient]]
  const content = await appSigner.nip44.encrypt(recipient, JSON.stringify(payload))
  const event = await appSigner.sign(createEvent(NOSTR_CONNECT, {tags, content}))

  return event
}

const sendEvent = async event => {
  for (const [id, {connection, filters}] of subscriptions.entries()) {
    if (matchFilters(filters, event)) {
      connection.send(['EVENT', id, event])
    }
  }
}

const startSession = async session => {
  const {client_pubkey, connect_secret} = session
  const event = await makeResponse(client_pubkey, {result: connect_secret})

  sessions.set(client_pubkey, session)
  sendEvent(event)
}

const getSession = async client_pubkey => {
  let session = sessions.get(client_pubkey)

  if (!session) {
    session = await loadSession(client_pubkey)

    if (session) {
      sessions.set(client_pubkey, session)
    }
  }

  return session
}

const nip46Handlers = {
  ping: async session => ({result: "pong"}),
  get_public_key: async ({signer}) => ({result: await signer.getPubkey()}),
  sign_event: async ({signer}, event) => {
    try {
      return {result: JSON.stringify(await signer.sign(JSON.parse(event)))}
    } catch (e) {
      return {error: "Failed to sign event"}
    }
  },
  nip44_encrypt: async ({signer}, pk, text) => {
    try {
      return {result: await signer.nip44.encrypt(pk, text)}
    } catch (e) {
      return {error: "Failed to encrypt"}
    }
  },
  nip44_decrypt: async ({signer}, pk, text) => {
    try {
      return {result: await signer.nip44.decrypt(pk, text)}
    } catch (e) {
      return {error: "Failed to decrypt"}
    }
  },
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

    if (LOG_RELAY_MESSAGES) {
      console.log('relay sent:', ...message)
    }
  }

  handle(message) {
    try {
      message = JSON.parse(message)
    } catch (e) {
      this.send(['NOTICE', '', 'Unable to parse message'])
    }

    if (LOG_RELAY_MESSAGES) {
      console.log('relay received:', ...message)
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
    if (filters.every(f => f.kinds?.includes(24133))) {
      this.addSub(id, filters)
      this.send(['EOSE', id])
    } else {
      this.send(['NOTICE', '', 'Only filters matching kind 24133 events are accepted'])
    }
  }

  async onEVENT(event) {
    const pubkey = await appSigner.getPubkey()

    if (event.kind !== 24133) {
      return this.send(['OK', event.id, false, 'Only kind 24133 events are accepted'])
    }

    if (!event.tags?.some(t => t[0] === 'p' && t[1] === pubkey)) {
      return this.send(['OK', event.id, false, 'Event must p-tag this relay'])
    }

    const content = await tryCatch(() => decrypt(appSigner, event.pubkey, event.content))

    if (!content) {
      return this.send(['OK', event.id, false, 'Failed to decrypt event content'])
    }

    const request = parseJson(content)

    if (!request) {
      return this.send(['OK', event.id, false, 'Failed to decode event content'])
    }

    const session = await getSession(event.pubkey)

    if (!session) {
      return this.send(['OK', event.id, false, 'No active session found'])
    }

    this.send(['OK', event.id, true, ""])
    this.handleNip46Request(session, request)
  }

  handleNip46Request = async (session, request) => {
    if (LOG_NIP46_MESSAGES) {
      console.log(`signer for ${session.client_pubkey} received:\n`, request)
    }

    const {id, method, params} = request
    const handler = switcher(method, nip46Handlers)

    const respond = async payload => {
      const response = {id, ...payload}
      const event = await makeResponse(session.client_pubkey, response)

      sendEvent(event)

      if (LOG_NIP46_MESSAGES) {
        console.log(`signer for ${session.client_pubkey} sent:\n`, response)
      }
    }

    if (!handler) {
      return respond({error: `Unrecognized request method: ${method}`})
    }

    let response
    try {
      response = await handler(session, ...params)
    } catch (e) {
      console.error(e)
    }

    if (!response) {
      return respond({error: "Internal error"})
    }

    return respond(response)
  }
}

module.exports = {startSession}
