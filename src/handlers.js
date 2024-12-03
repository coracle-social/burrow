const {tryCatch} = require('@welshman/lib')
const {appSigner} = require('./env')
const {startSession} = require('./relay')
const {sendConfirmEmail, sendEjectEmail, sendResetEmail} = require('./mailgun')
const {createUser, authenticateUser, createSession, deleteSession, ejectUser, confirmEmail, requestReset, confirmReset} = require('./database')

const _err = (res, status, error) => res.status(status).send({error})

const _ok = (res, status = 200) => res.status(status).send({ok: true})

const handleNip11 = async (req, res) => {
  res.set({'Content-Type': 'application/nostr+json'})

  res.json({
    name: "Burrow",
    icon: "https://pfp.nostr.build/dac9ef793790d3e360ef90f8a4fbbfc92250ef3f4e666bbf2760b40997d2bfbf.jpg",
    description: "A relay/bunker combo for adapting email/password login to nostr keys via NIP 46.",
    pubkey: await appSigner.getPubkey(),
    software: "https://github.com/coracle-social/burrow",
  })
}

const handleUserCreate = async (req, res) => {
  const {email = "", password = ""} = req.body

  if (!email.match('^.+@.+$')) {
    return _err(res, 400, "Please provide a valid email address.")
  }

  if (password.length < 12) {
    return _err(res, 400, "Password must be at least 12 characters.")
  }

  try {
    const confirm_token = await createUser({email, password})

    sendConfirmEmail({email, confirm_token})
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT') {
      return _err(res, 409, 'An account with that email address already exists.')
    } else {
      throw e
    }
  }

  return _ok(res)
}

const handleUserDelete = async (req, res) => {
  const {email, password, eject} = req.body

  const user = await authenticateUser({email, password})

  if (!user) {
    return _err(res, 401, 'Invalid login information, please try again!')
  }

  if (!user.confirmed_at) {
    sendConfirmEmail(user)

    return _err(res, 400, 'Your email has not yet been confirmed. Please check your inbox.')
  }

  const {user_ncryptsec} = await ejectUser({email})

  if (eject && user_ncryptsec) {
    await sendEjectEmail({email, user_ncryptsec})
  }

  return _ok(res)
}

const handleEmailConfirm = async (req, res) => {
  const {email, confirm_token} = req.body

  const confirmed = await confirmEmail({email, confirm_token})

  if (confirmed) {
    return _ok(res)
  } else {
    return _err(res, 400, "It looks like that confirmation code is invalid or has expired.")
  }
}

const handleResetRequest = async (req, res) => {
  const {email} = req.body

  if (!await userExists({email})) {
    return _err(res, 400, "We weren't able to find an account with that email address.")
  }

  const reset_token = await requestReset({email})

  if (reset_token) {
    sendResetEmail({email, reset_token})
  }

  return _ok(res)
}

const handleResetConfirm = async (req, res) => {
  const {email, password, reset_token} = req.body

  if (password.length < 12) {
    return _err(res, 400, "Password must be at least 12 characters.")
  }

  const confirmed = await confirmReset({email, password, reset_token})

  if (confirmed) {
    return _ok(res)
  } else {
    return _err(res, 400, "It looks like that reset code is invalid or has expired.")
  }
}

const handleSessionCreate = async (req, res) => {
  const {email, password, nostrconnect} = req.body

  const user = await authenticateUser({email, password})

  if (!user) {
    return _err(res, 401, 'Invalid login information, please try again!')
  }

  if (!user.confirmed_at) {
    sendConfirmEmail(user)

    return _err(res, 400, 'Your email has not yet been confirmed. Please check your inbox.')
  }

  const url = tryCatch(() => new URL(nostrconnect))

  if (!url) {
    return _err(res, 400, 'Invalid nostrconnect URL.')
  }

  const {encrypted_secret} = user
  const client_pubkey = url.host
  const connect_secret = url.searchParams.get('secret')
  const session = await createSession({email, client_pubkey, connect_secret, encrypted_secret})

  await startSession(session)

  return _ok(res)
}

const handleSessionDelete = async (req, res) => {
  const {client_pubkey, connect_secret} = req.body

  await deleteSession({client_pubkey, connect_secret})

  return _ok(res)
}

module.exports = {handleSessionCreate, handleUserCreate, handleSessionDelete, handleUserDelete, handleEmailConfirm, handleResetRequest, handleResetConfirm, handleNip11}
