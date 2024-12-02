const sqlite3 = require('sqlite3')
const {hexToBytes, bytesToHex} = require('@noble/hashes/utils')
const nip49 = require('nostr-tools/nip49')
const bcrypt = require('bcrypt')
const {omit} = require('@welshman/lib')
const {makeSecret, Nip01Signer} = require('@welshman/signer')

const db = new sqlite3.Database('burrow.db')

const migrate = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          email TEXT PRIMARY KEY,
          ncryptsec TEXT NOT NULL,
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
          ncryptsec TEXT NOT NULL,
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

const createUser = async ({email, password}) => {
  const private_key = makeSecret()
  const ncryptsec = await nip49.encrypt(hexToBytes(private_key), password)
  const password_hash = await bcrypt.hash(password, 14)
  const confirm_token = Math.random().toString().slice(2)

  return new Promise((resolve, reject) => {
    db.get(
      `INSERT INTO users (email, ncryptsec, password_hash, confirm_token)
       VALUES (?, ?, ?, ?)`,
      [email, ncryptsec, password_hash, confirm_token],
      (err, row) => {
        if (err) return reject(err)
        if (!row) return resolve(undefined)

        resolve(confirm_token)
      }
    )
  })
}

const authenticateUser = async ({email, password}) => {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT email, confirm_at, confirm_token, ncryptsec, password_hash FROM users WHERE email = ?',
      [email],
      async (err, row) => {
        if (err) return reject(err)
        if (!row) return resolve(undefined)
        if (!await bcrypt.compare(password, row.password_hash)) return resolve(undefined)

        resolve(omit(['password_hash'], row))
      }
    )
  })
}

const ejectUser = ({email}) => {
  return new Promise((resolve, reject) => {
    db.get('DELETE FROM users WHERE email = ? RETURNING ncryptsec', [email], (err, row) => {
      if (err) reject(err)
      else resolve(row?.ncryptsec)
    })
  })
}

const confirmEmail = ({email, confirm_token}) => {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET confirm_at = unixepoch() WHERE email = ? AND confirm_token = ?',
      [email, confirm_token],
      function(err) {
        if (err) reject(err)
        else resolve(this.changes > 0)
      }
    )
  })
}

const requestReset = ({email}) => {
  const reset_token = Math.random().toString().slice(2)

  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET reset_by = unixepoch(), reset_token = ? WHERE email = ?',
      [reset_token, email],
      function(err) {
        if (err) reject(err)
        else resolve(this.changes > 0 ? reset_token : undefined)
      }
    )
  })
}

const confirmReset = async ({email, password, reset_token}) => {
  const password_hash = await bcrypt.hash(password, 14)

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET reset_by = null, reset_token = null, password_hash = ?
       WHERE email = ? AND reset_token = ?`,
      [password_hash, email, reset_token],
      function(err) {
        if (err) reject(err)
        else resolve(this.changes > 0)
      }
    )
  })
}

const createSession = async ({email, password, client_pubkey, connect_secret, user_ncryptsec}) => {
  const key = client_pubkey + connect_secret
  const private_key = await nip49.decrypt(user_ncryptsec, password)
  const ncryptsec = await nip49.encrypt(private_key, key)
  const signer = Nip01Signer.fromSecret(private_key)

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO sessions (email, client_pubkey, connect_secret, ncryptsec) VALUES (?, ?, ?, ?)`,
      [email, client_pubkey, connect_secret, ncryptsec],
      (err) => {
        if (err) reject(err)
        else resolve({client_pubkey, connect_secret, signer})
      }
    )
  })
}

const getSession = async (client_pubkey) => {
  return new Promise((resolve, reject) => {
    db.get(
      `UPDATE sessions SET last_used = unixepoch() WHERE client_pubkey = ? RETURNING *`,
      [client_pubkey],
      async (err, row) => {
        if (err) return reject(err)
        if (!row) return resolve(undefined)

        const {client_pubkey, connect_secret, ncryptsec} = row
        const key = client_pubkey + connect_secret
        const private_key = bytesToHex(await nip49.decrypt(ncryptsec, key))
        const signer = Nip01Signer.fromSecret(private_key)

        resolve({client_pubkey, connect_secret, signer})
      }
    )
  })
}

const deleteSession = ({client_pubkey, connect_secret}) => {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM sessions WHERE client_pubkey = ? AND connect_secret = ?',
      [client_pubkey, connect_secret],
      (err) => {
        if (err) reject(err)
        else resolve()
      }
    )
  })
}

module.exports = {migrate, createUser, authenticateUser, ejectUser, createSession, confirmEmail, deleteSession, requestReset, confirmReset, getSession}
