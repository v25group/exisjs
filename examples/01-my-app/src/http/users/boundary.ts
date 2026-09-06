import { defineBoundary } from 'exisjs/router'

// Imagine this is a complex external plugin or shared module we are importing
// import { StripeModule } from '@plugins/stripe'

// We define a local service to be provided ONLY to the users routes
class UsersService {
  getWelcomeMessage(name: string) {
    return `Hello ${name}, welcome to the Modular Architecture!`
  }
}

export const config = defineBoundary({
  // imports: [StripeModule],
  providers: [['UsersService', { useClass: UsersService }]],
})
