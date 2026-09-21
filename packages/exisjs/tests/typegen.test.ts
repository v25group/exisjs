import { describe, expect, it } from '../src/testing'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { generateManifest } from '../src/cli/manifest'
import { route, controller, createRouter } from '../src/router'
import { createTempDir, cleanupTempDir, writeTempFile } from './helpers'

describe('Type-Safe Client Route Manifest Contract (AppRouter Generation)', () => {
  it('preserves inferred return types and DTO input types in RouteDefinition', () => {
    interface UserDto {
      id: string
      email: string
      role: 'admin' | 'user'
    }

    interface CreateUserBody {
      email: string
      name: string
    }

    const getUserRoute = route.get('/users/:id', {
      handle({ params }) {
        return {
          id: params.id,
          email: 'user@example.com',
          role: 'admin' as const,
        }
      },
    })

    const createUserRoute = route.post('/users', {
      handle({ body }: { body: CreateUserBody }) {
        return {
          created: true,
          userId: 'usr_99',
        }
      },
    })

    // Assert that RouteDefinition carries exact types on __type
    type GetUserType = NonNullable<typeof getUserRoute.__type>
    type GetUserReturn = GetUserType['return']
    type CreateUserType = NonNullable<typeof createUserRoute.__type>

    const mockUser: GetUserReturn = {
      id: '123',
      email: 'test@example.com',
      role: 'admin',
    }
    expect(mockUser.id).toBe('123')
    expect(mockUser.role).toBe('admin')

    expect(getUserRoute.method).toBe('get')
    expect(getUserRoute.path).toBe('/users/:id')
    expect(createUserRoute.method).toBe('post')
  })

  it('preserves return types across createRouter with custom context', () => {
    interface CustomCtx {
      tenantId: string
    }

    const { route: customRoute } = createRouter<CustomCtx>()

    const customGet = customRoute.get('/tenant/metrics', {
      handle({ tenantId }) {
        return {
          tenant: tenantId,
          cpuUsage: 45.2,
          activeSockets: 120,
        }
      },
    })

    type MetricsReturn = NonNullable<typeof customGet.__type>['return']
    const metrics: MetricsReturn = {
      tenant: 't_1',
      cpuUsage: 50.0,
      activeSockets: 10,
    }
    expect(metrics.tenant).toBe('t_1')
    expect(customGet.method).toBe('get')
  })

  it('generates hierarchical AppRouter and types in .exis/types.d.ts and .exis/types/index.d.ts', async () => {
    const tmpDir = createTempDir('exis-typegen-')

    try {
      const httpDir = path.join(tmpDir, 'src', 'http')
      fs.mkdirSync(httpDir, { recursive: true })

      // 1. Root route: /
      writeTempFile(
        tmpDir,
        'src/http/route.ts',
        `import { route } from 'exisjs/router'
export default route.get('/', {
  handle() {
    return { status: 'healthy', timestamp: Date.now() }
  }
})`
      )

      // 2. Users route: /users
      writeTempFile(
        tmpDir,
        'src/http/users/route.ts',
        `import { route, controller } from 'exisjs/router'
export default controller({
  list: route.get('/', {
    handle() {
      return { users: [{ id: '1', name: 'Alice' }] }
    }
  }),
  create: route.post('/', {
    handle() {
      return { id: '2', success: true }
    }
  })
})`
      )

      // 3. Nested user by id: /users/:id
      writeTempFile(
        tmpDir,
        'src/http/users/[id]/route.ts',
        `import { route } from 'exisjs/router'
export default route.get('/:id', {
  handle({ params }) {
    return { id: params.id, name: 'Alice', found: true }
  }
})`
      )

      // 4. Deeply nested auth route: /auth/login
      writeTempFile(
        tmpDir,
        'src/http/auth/login/route.ts',
        `import { route } from 'exisjs/router'
export const POST = route.post('/login', {
  handle() {
    return { token: 'jwt_mock_token' }
  }
})`
      )

      // Run generateManifest in dev mode
      await generateManifest(tmpDir, '', true)

      const typesPath = path.join(tmpDir, '.exis', 'types.d.ts')
      const typesIndexPath = path.join(tmpDir, '.exis', 'types', 'index.d.ts')
      const devStatusPath = path.join(tmpDir, '.exis', 'dev-status.json')
      const exisEnvPath = path.join(tmpDir, 'exis.d.ts')

      expect(fs.existsSync(typesPath)).toBe(true)
      expect(fs.existsSync(typesIndexPath)).toBe(true)
      expect(fs.existsSync(devStatusPath)).toBe(true)

      const typesContent = fs.readFileSync(typesPath, 'utf8')

      // Verify flat paths index
      expect(typesContent).toContain('export interface AppRouterPaths {')
      expect(typesContent).toContain("'/': InferRoute<typeof Route")
      expect(typesContent).toContain("'/users': InferRoute<typeof Route")
      expect(typesContent).toContain("'/users/:id': InferRoute<typeof Route")
      expect(typesContent).toContain("'/auth/login': InferRoute<typeof Route")

      // Verify hierarchical AST tree
      expect(typesContent).toContain('export type AppRouterTree =')
      expect(typesContent).toContain('users:')
      expect(typesContent).toContain("':id':")
      expect(typesContent).toContain('auth:')
      expect(typesContent).toContain('login:')

      // Verify AppRouter combining flat and tree
      expect(typesContent).toContain(
        'export type AppRouter = AppRouterPaths & AppRouterTree'
      )

      // Verify dev-status.json contains active route list
      const devStatus = JSON.parse(fs.readFileSync(devStatusPath, 'utf8'))
      expect(devStatus.routeCount).toBe(4)
      const scannedPaths = devStatus.routes.map((r: any) => r.path)
      expect(scannedPaths).toContain('/')
      expect(scannedPaths).toContain('/users')
      expect(scannedPaths).toContain('/users/:id')
      expect(scannedPaths).toContain('/auth/login')
    } finally {
      cleanupTempDir(tmpDir)
    }
  })

  it('automatically syncs types on route deletion and file rename without restart', async () => {
    const tmpDir = createTempDir('exis-typegen-sync-')

    try {
      const httpDir = path.join(tmpDir, 'src', 'http')
      fs.mkdirSync(httpDir, { recursive: true })

      writeTempFile(
        tmpDir,
        'src/http/users/route.ts',
        `import { route } from 'exisjs/router'; export default route.get('/users', { handle() { return [] } })`
      )

      writeTempFile(
        tmpDir,
        'src/http/posts/route.ts',
        `import { route } from 'exisjs/router'; export default route.get('/posts', { handle() { return [] } })`
      )

      await generateManifest(tmpDir, '', true)

      let types = fs.readFileSync(
        path.join(tmpDir, '.exis', 'types.d.ts'),
        'utf8'
      )
      expect(types).toContain("'/users'")
      expect(types).toContain("'/posts'")

      // Simulate deleting posts/route.ts and renaming users to accounts
      fs.rmSync(path.join(tmpDir, 'src', 'http', 'posts'), {
        recursive: true,
        force: true,
      })
      fs.renameSync(
        path.join(tmpDir, 'src', 'http', 'users'),
        path.join(tmpDir, 'src', 'http', 'accounts')
      )

      // Re-run manifest sync (as watcher would trigger)
      await generateManifest(tmpDir, '', true)

      types = fs.readFileSync(path.join(tmpDir, '.exis', 'types.d.ts'), 'utf8')
      expect(types).not.toContain("'/posts'")
      expect(types).not.toContain("'/users'")
      expect(types).toContain("'/accounts'")

      const devStatus = JSON.parse(
        fs.readFileSync(path.join(tmpDir, '.exis', 'dev-status.json'), 'utf8')
      )
      expect(devStatus.routeCount).toBe(1)
      expect(devStatus.routes[0].path).toBe('/accounts')
    } finally {
      cleanupTempDir(tmpDir)
    }
  })
})
