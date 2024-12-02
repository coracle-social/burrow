const dotenv = require('dotenv')
const {Nip01Signer} = require('@welshman/signer')

dotenv.config({path: ".env.local"})
dotenv.config({path: ".env"})

if (!process.env.SECRET) throw new Error('SECRET is not defined.')
if (!process.env.CLIENT_DOMAIN) throw new Error('CLIENT_DOMAIN is not defined.')
if (!process.env.CLIENT_NAME) throw new Error('CLIENT_NAME is not defined.')
if (!process.env.MAILGUN_API_KEY) throw new Error('MAILGUN_API_KEY is not defined.')
if (!process.env.MAILGUN_DOMAIN) throw new Error('MAILGUN_DOMAIN is not defined.')
if (!process.env.PORT) throw new Error('PORT is not defined.')

module.exports = {
  signer: Nip01Signer.fromSecret(process.env.SECRET),
  CLIENT_DOMAIN: process.env.CLIENT_DOMAIN,
  CLIENT_NAME: process.env.CLIENT_NAME,
  MAILGUN_API_KEY: process.env.MAILGUN_API_KEY,
  MAILGUN_DOMAIN: process.env.MAILGUN_DOMAIN,
  PORT: process.env.PORT,
}