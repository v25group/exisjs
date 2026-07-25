const express = require('express')
const app = express()

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Hello from Express!' })
})

const port = process.env.PORT || 3001
app.listen(port, () => {
  console.log(`Express listening on ${port}`)
})
