const {PORT} = require('./env')
const {server} = require('./server')
const {migrate} = require('./database')
const {handleUserCreate, handleSessionCreate, handleEmailConfirm, handleResetRequest, handleResetConfirm, handleUserDelete, handleSessionDelete, handleNip11} = require('./handlers')

server.get('/', handleNip11)
server.post('/user', handleUserCreate)
server.delete('/user', handleUserDelete)
server.post('/user/confirm-email', handleEmailConfirm)
server.post('/user/request-reset', handleResetRequest)
server.post('/user/confirm-reset', handleResetConfirm)
server.post('/session', handleSessionCreate)
server.delete('/session', handleSessionDelete)

migrate().then(() => {
  server.listen(PORT, () => {
    console.log('Running on port', PORT)
  })
})

