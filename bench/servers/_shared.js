// Shared pieces for every benchmark server, so all frameworks serve exactly
// the same routes, payloads and validation rules.
//
// The runner talks to servers over the IPC channel (no extra HTTP routes):
//   parent -> 'usage'  child -> { type: 'usage', cpu, rss }
//   parent -> 'exit'   child exits cleanly (lets --cpu-prof / --heap-prof flush)
//   child  -> { type: 'ready', backend }

const PORT = Number(process.env.PORT) || 3000

// Response for GET /json (TechEmpower-style JSON test)
const HELLO = { message: 'Hello, World!' }

// Validation rules for POST /users, mirrored in every framework's idiom
const USER_RULES = {
  name: { type: 'string', minLength: 2, maxLength: 64 },
  email: { type: 'string', pattern: '^[^\\s@]+@[^\\s@]+$' },
  age: { type: 'number', minimum: 0, maximum: 150 },
}

function validateUserManually(body) {
  if (!body || typeof body !== 'object') return false
  const { name, email, age } = body
  return (
    typeof name === 'string' &&
    name.length >= 2 &&
    name.length <= 64 &&
    typeof email === 'string' &&
    /^[^\s@]+@[^\s@]+$/.test(email) &&
    typeof age === 'number' &&
    age >= 0 &&
    age <= 150
  )
}

function attachIpc(backend) {
  if (typeof process.send !== 'function') {
    console.log(`listening on ${PORT} (${backend})`)
    return
  }
  process.on('message', (msg) => {
    if (msg === 'usage') {
      const cpu = process.cpuUsage()
      process.send({
        type: 'usage',
        cpu: cpu.user + cpu.system,
        rss: process.memoryUsage().rss,
      })
    } else if (msg === 'exit') {
      process.exit(0)
    }
  })
  process.send({ type: 'ready', backend })
}

module.exports = { PORT, HELLO, USER_RULES, validateUserManually, attachIpc }
