import { App } from '../src/server/app'
import { definePlugin } from '../src/exports/plugin'
import { createTestApp } from '../src/testing/client'
import { describe, expect, it } from '../src/testing'

describe('Plugin System', () => {
  it('registers a plugin via definePlugin with exact type inference', async () => {
    const app = new App()

    interface MyPluginOptions {
      headerName: string
      headerValue: string
    }

    const testPlugin = definePlugin<MyPluginOptions>({
      name: 'test-plugin',
      register: (pluginApp, options) => {
        pluginApp.use((req: any, res: any, next: any) => {
          if (options) {
            res.set(options.headerName, options.headerValue)
          }
          next()
        })

        pluginApp.get('/plugin-route', (req: any, res: any) => {
          res.json({ fromPlugin: true })
        })
      },
    })

    await app.register(testPlugin, {
      headerName: 'X-Plugin-Test',
      headerValue: 'Success',
    })

    const res = await createTestApp(app).get('/plugin-route')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ fromPlugin: true })
    expect(res.headers['x-plugin-test']).toBe('Success')
  })
})
