import { Controller, Get, Public, Query } from 'exisjs/decorators'
import { tex } from 'exisjs/validator'

const HelloQuery = tex.object({ name: tex.string({ max: 200 }) })

// Returns client text as a plain string, a classic reflected XSS target
@Controller()
export default class HelloController {
  @Get('/')
  @Public()
  hello(@Query(HelloQuery) query: { name: string }) {
    return `Hello ${query.name}`
  }
}
