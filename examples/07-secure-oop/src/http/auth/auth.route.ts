import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Public,
  RateLimit,
  Req,
  Res,
} from 'exisjs/decorators'
import { revokeSession } from '@/common/session'
import { SESSION_COOKIE, sessionCookieOptions } from '@/common/session-cookie'
import { loginBody, registerBody } from './auth.schema'
import * as auth from './auth.service'

@Controller()
export default class AuthController {
  @Get('/csrf')
  @Public()
  csrf(@Req() req: any) {
    return { csrfToken: req.csrfToken }
  }

  @Post('/register')
  @Public()
  @HttpCode(201)
  register(@Body(registerBody) body: any) {
    return auth.register(body)
  }

  @Post('/login')
  @Public()
  @RateLimit({ windowMs: 60_000, max: 10 })
  async login(@Body(loginBody) body: any, @Res() res: any) {
    const token = await auth.login(body.email, body.password)
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions)
    return { ok: true }
  }

  @Post('/logout')
  async logout(@Req() req: any, @Res() res: any) {
    await revokeSession(req.cookies[SESSION_COOKIE])
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions)
    return { ok: true }
  }

  @Get('/me')
  me(@Req() req: any) {
    return req.user
  }
}
