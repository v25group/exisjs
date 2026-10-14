// ExisJS class-based controllers, same routes and settings as exis.js, so the
// difference between the two targets is the cost of the class layer.
// Decorators are applied by hand because this file is plain JavaScript.
const { exis } = require('exisjs')
const { tex } = require('exisjs/validator')
const {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
} = require('exisjs/decorators')
const { PORT, HELLO, attachIpc } = require('./_shared')

const User = tex.object({
  name: tex.string({ min: 2, max: 64 }),
  email: tex.email(),
  age: tex.number({ min: 0, max: 150 }),
})

class BenchController {
  json() {
    return HELLO
  }
  user(id, fields) {
    return { id, fields: fields ?? null }
  }
  echo(body) {
    return body
  }
  create(body) {
    return body
  }
}

const proto = BenchController.prototype
const method = (decorators, name, params = []) => {
  const descriptor = Object.getOwnPropertyDescriptor(proto, name)
  params.forEach((decorate, index) => decorate(proto, name, index))
  for (const decorate of decorators) decorate(proto, name, descriptor)
}
method([Get('/json')], 'json')
method([Get('/users/:id')], 'user', [Param('id'), Query('fields')])
method([Post('/echo')], 'echo', [Body()])
method([Post('/users', { body: User }), HttpCode(201)], 'create', [Body()])
Controller('/')(BenchController)

exis({
  port: PORT,
  server: 'node',
  env: 'production',
  logger: false,
  helmet: false,
  cors: false,
  async onStart(app) {
    app.registerControllers([BenchController])
  },
})
  .boot()
  .then((app) =>
    app.listen({ port: PORT, onListen: () => attachIpc('exis-class') })
  )
