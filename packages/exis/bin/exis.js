#!/usr/bin/env node
// The exisjs package doesn't export its bin, so find it next to its package.json
const path = require('node:path')
require(
  path.join(
    path.dirname(require.resolve('exisjs/package.json')),
    'bin',
    'exis.js'
  )
)
