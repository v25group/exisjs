import { describe, it, expect } from '../src/testing'
import { App } from '../src/server/app'
import { ProcessLifecycle } from '../src/server/lifecycle'

describe('ProcessLifecycle & App.close Cleanup', () => {
  it('tracks and automatically unregisters process event listeners upon cleanup', () => {
    ProcessLifecycle.startTracking()

    let customEventFired = false
    const dummyHandler = () => {
      customEventFired = true
    }

    process.on('warning', dummyHandler)
    expect(process.listeners('warning').includes(dummyHandler)).toBe(true)

    ProcessLifecycle.cleanup()
    expect(process.listeners('warning').includes(dummyHandler)).toBe(false)
    ProcessLifecycle.restore()
  })

  it('tracks and clears background interval timers upon cleanup', () => {
    ProcessLifecycle.startTracking()

    let count = 0
    setInterval(() => {
      count++
    }, 10)

    ProcessLifecycle.cleanup()
    ProcessLifecycle.restore()
  })

  it('runs onClose hooks and awaits them with timeout during app.close()', async () => {
    const app = new App({ port: 0 })
    let hook1Called = false
    let hook2Called = false

    app.onClose(async () => {
      hook1Called = true
    })

    app.onCloseHook = async () => {
      hook2Called = true
    }

    const server = app.listen()
    expect(server).toBeDefined()

    await app.close()

    expect(hook1Called).toBe(true)
    expect(hook2Called).toBe(true)
  })

  it('does not hang if an individual onClose hook throws or rejects', async () => {
    const app = new App({ port: 0 })
    let subsequentHookCalled = false

    app.onClose(async () => {
      throw new Error('Database pool disconnect failed')
    })

    app.onClose(async () => {
      subsequentHookCalled = true
    })

    app.listen()
    await app.close(1000)

    expect(subsequentHookCalled).toBe(true)
  })
})
