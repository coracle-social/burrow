const mailgun = require('mailgun-js')
const {MAILGUN_API_KEY, MAILGUN_DOMAIN, CLIENT_NAME, CLIENT_DOMAIN} = require('./env')

const mg = mailgun({apiKey: MAILGUN_API_KEY, domain: MAILGUN_DOMAIN})

const send = (data) => {
  if (MAILGUN_DOMAIN.startsWith('sandbox')) {
    console.log(data)
  } else {
    mg.messages().send(data)
  }
}

const sendConfirmEmail = ({email, confirm_token}) => {
  const href = `${CLIENT_DOMAIN}/confirm-email?email=${encodeURIComponent(email)}&confirm_token=${confirm_token}`

  send({
    from: `${CLIENT_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'Confirm your email',
    html: `
      <h3>Welcome to ${CLIENT_NAME}!</h3>
      <p>Please confirm your email address by clicking the link below:</p>
      <p><a href="${href}">Confirm Email</a></p>
    `,
    text: `Please confirm your email address by visiting: ${href}`
  })
}

const sendResetEmail = ({email, reset_token}) => {
  const href = `${CLIENT_DOMAIN}/reset-password?email=${encodeURIComponent(email)}&reset_token=${reset_token}`

  send({
    from: `${CLIENT_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'Reset your password',
    html: `
      <h3>Thanks for using ${CLIENT_NAME}!</h3>
      <p>
        Someone has requested a password reset for ${email}. If this wasn't you, please ignore this email.
        Otherwise, please click below to continue.
      </p>
      <p><a href="${href}">Reset Password</a></p>
    `,
    text: `
      Thanks for using ${CLIENT_NAME}!\n
      Someone has requested a password reset for ${email}. If this wasn't you, please ignore this email. Otherwise, please follow the link below to continue.\n
      ${href}`
  })
}

const sendEjectEmail = ({email, user_ncryptsec}) => {
  send({
    from: `${CLIENT_NAME} <noreply@${MAILGUN_DOMAIN}>`,
    to: email,
    subject: 'Your nostr key',
    html: `
      <h3>Thanks for using ${CLIENT_NAME}!</h3>
      <p>Please see below for your nostr private key:</p>
      <p>${user_ncryptsec}</p>
      <p>Note that this key is encrypted using the password you used to log in to ${CLIENT_NAME}.</p>
      <p>You will no longer be able to log in using your email and password. Instead, store your key securely and log in using a nostr signer app.</p>
    `,
    text: `
      Thanks for using ${CLIENT_NAME}!\n
      Please see below for your nostr private key:\n
      ${user_ncryptsec}\n
      Note that this key is encrypted using the password you used to log in to ${CLIENT_NAME}.\n
      You will no longer be able to log in using your email and password. Instead, store your key securely and log in using a nostr signer app.
    `
  })
}

module.exports = {sendConfirmEmail, sendResetEmail, sendEjectEmail}
