const sqlite3 = require('sqlite3')
const {hexToBytes} = require('@noble/hashes/utils')
const nip49 = require('nostr-tools/nip49')
const bcrypt = require('bcrypt')
const {makeSecret, Nip01Signer} = require('@welshman/signer')
const {appSigner} = require('./env')

const db = new sqlite3.Database('burrow.db')

const migrate = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY,
          encrypted_secret TEXT NOT NULL,
          user_ncryptsec TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          confirm_at INTEGER,
          confirm_token TEXT,
          reset_by INTEGER,
          reset_token TEXT
        )
      `)
      db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
          email TEXT NOT NULL,
          client_pubkey TEXT PRIMARY KEY,
          connect_secret TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_used INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (email) REFERENCES users(email) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  })
}

const run = (query, params) =>
  new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      return err ? reject(err) : resolve(this.changes > 0)
    })
  })

const get = (query, params, cb) =>
  new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err)
      } else if (row) {
        resolve(cb ? cb(row) : row)
      } else {
        resolve(undefined)
      }
    })
  })

const decryptSecret = async encrypted_secret =>
  appSigner.nip44.decrypt(await appSigner.getPubkey(), encrypted_secret)

const encryptSecret = async secret =>
  appSigner.nip44.encrypt(await appSigner.getPubkey(), secret)

const getSigner = async encrypted_secret =>
  Nip01Signer.fromSecret(await decryptSecret(encrypted_secret))

const makeSession = async ({client_pubkey, connect_secret, encrypted_secret}) =>
  ({client_pubkey, connect_secret, signer: await getSigner(encrypted_secret)})

// Application methods

const createUser = async ({email, password}) => {
  const secret = makeSecret()
  const encrypted_secret = await encryptSecret(secret)
  const user_ncryptsec = await nip49.encrypt(hexToBytes(secret), password)
  const password_hash = await bcrypt.hash(password, 14)
  const confirm_token = Math.random().toString().slice(2)

  await run(
    `INSERT INTO users (email, encrypted_secret, user_ncryptsec, password_hash, confirm_token)
     VALUES (?, ?, ?, ?, ?)`,
    [email, encrypted_secret, user_ncryptsec, password_hash, confirm_token],
  )

  return confirm_token
}

const authenticateUser = async ({email, password}) =>
  get(
    'SELECT email, confirm_at, confirm_token, encrypted_secret, password_hash FROM users WHERE email = ?',
    [email],
    async ({password_hash, ...user}) => {
      if (await bcrypt.compare(password, password_hash)) {
        return user
      }
    }
  )

const ejectUser = ({email}) =>
  get('DELETE FROM users WHERE email = ? RETURNING user_ncryptsec', [email])

const confirmEmail = ({email, confirm_token}) =>
  run(
    'UPDATE users SET confirm_at = unixepoch() WHERE email = ? AND confirm_token = ?',
    [email, confirm_token],
  )

const requestReset = async ({email}) => {
  const reset_token = Math.random().toString().slice(2)

  const success = await run(
    'UPDATE users SET reset_by = unixepoch(), reset_token = ? WHERE email = ?',
    [reset_token, email],
  )

  return success ? reset_token : undefined
}

const confirmReset = async ({email, password, reset_token}) =>
  get(
    `UPDATE users SET reset_by = null, reset_token = null, password_hash = ?
     WHERE email = ? AND reset_token = ? RETURNING encrypted_secret`,
    [await bcrypt.hash(password, 14), email, reset_token],
    async ({encrypted_secret}) => {
      const secret = await decryptSecret(encrypted_secret)
      const user_ncryptsec = await nip49.encrypt(secret, password)

      return run(
        `UPDATE users SET user_ncryptsec = ? WHERE email = ?`,
        [user_ncryptsec, email],
      )
    }
  )

const createSession = async ({email, client_pubkey, connect_secret, encrypted_secret}) =>
  get(
    `INSERT INTO sessions (email, client_pubkey, connect_secret) VALUES (?, ?, ?) RETURNING *`,
    [email, client_pubkey, connect_secret],
    row => makeSession({...row, encrypted_secret})
  )

const getSession = async (client_pubkey) => {
  const success = await run(
    `UPDATE sessions SET last_used = unixepoch() WHERE client_pubkey = ?`,
    [client_pubkey],
  )

  if (success) {
    return get(
      `SELECT * FROM sessions JOIN users USING(email) WHERE client_pubkey = ?`,
      [client_pubkey],
      makeSession
    )
  }
}

const deleteSession = ({client_pubkey}) =>
  run('DELETE FROM sessions WHERE client_pubkey = ?', [client_pubkey])

module.exports = {migrate, createUser, authenticateUser, ejectUser, createSession, confirmEmail, deleteSession, requestReset, confirmReset, getSession}
