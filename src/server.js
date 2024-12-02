const cors = require('cors')
const express = require('express')
const {rateLimit} = require('express-rate-limit')
const {CLIENT_DOMAIN} = require('./env')

const server = express()

server.use(rateLimit({limit: 30, windowMs: 5 * 60 * 1000}))
server.use(cors({origin: CLIENT_DOMAIN}))
server.use(express.json())

module.exports = {server}
