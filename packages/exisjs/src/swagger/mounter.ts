import type { App } from '../server/app'
import type { SwaggerConfig, OpenApiSpec } from './types'
import { generateOpenApiSpec } from './generator'
import { renderDocumentationHtml } from './ui'

/**
 * Mounts interactive Swagger/Scalar documentation UI and OpenAPI 3.1 JSON endpoints onto an ExisJS App.
 */
export function mountDocumentation(
  app: App<any>,
  options: SwaggerConfig = {}
): void {
  const docsPath = (options.path || '/docs').replace(/\/+$/, '')
  const specPath = options.specPath || `${docsPath}/json`
  const resolvedConfig: SwaggerConfig = {
    ...options,
    path: docsPath,
    specPath,
  }

  let cachedHtml: string | null = null
  let cachedSpec: OpenApiSpec | null = null

  const getHtml = (): string => {
    if (!cachedHtml) {
      cachedHtml = renderDocumentationHtml(resolvedConfig)
    }
    return cachedHtml
  }

  const getSpec = (): OpenApiSpec => {
    if (!cachedSpec) {
      const routes = app.getRouter().getRoutes() || []
      cachedSpec = generateOpenApiSpec(routes, resolvedConfig)
    }
    return cachedSpec
  }

  // Raw OpenAPI Specification Endpoint (JSON)
  app.get(specPath, { excludeFromDocs: true } as any, (_req, res) => {
    const spec = getSpec()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.send(JSON.stringify(spec))
  })

  // Secondary spec alias (/docs/openapi.json)
  if (specPath !== `${docsPath}/openapi.json`) {
    app.get(
      `${docsPath}/openapi.json`,
      { excludeFromDocs: true } as any,
      (_req, res) => {
        const spec = getSpec()
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        return res.send(JSON.stringify(spec))
      }
    )
  }

  // Interactive HTML Documentation UI Endpoints
  const htmlHandler = (_req: any, res: any) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.send(getHtml())
  }

  app.get(docsPath || '/', { excludeFromDocs: true } as any, htmlHandler)
  if (docsPath) {
    app.get(`${docsPath}/`, { excludeFromDocs: true } as any, htmlHandler)
  }
}
