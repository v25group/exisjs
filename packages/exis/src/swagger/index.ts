import type { App } from '../server/app'

export interface SwaggerOptions {
  path?: string
  title?: string
  version?: string
  components?: any
}

export function serveSwagger(app: App, options: SwaggerOptions = {}) {
  const uiPath = options.path || '/docs'
  const jsonPath = `${uiPath}/json`
  const title = options.title || 'API Documentation'
  const version = options.version || '1.0.0'

  // Generate OpenAPI JSON
  app.get(jsonPath, (req, res) => {
    const rawRoutes = app.getRoutes().filter((r) => !r.path.startsWith(uiPath))

    const paths: Record<string, any> = {}

    for (const r of rawRoutes) {
      // Convert /users/:id to /users/{id}
      let oasPath = r.path.replace(/:([a-zA-Z0-9_]+)/g, '{$1}')
      if (r.path.includes('*')) {
        oasPath = oasPath.replace('*', '{wildcard}')
      }

      if (!paths[oasPath]) {
        paths[oasPath] = {}
      }

      const method = r.method.toLowerCase()
      if (method === 'ws' || method === 'all') continue // Skip WS and ALL for now

      const operation: Record<string, any> = {
        responses: {
          '200': {
            description: 'Successful response',
          },
        },
      }

      if (r.schema) {
        if (
          r.schema.response &&
          typeof (r.schema.response as any).toOpenApi === 'function'
        ) {
          operation.responses['200'].content = {
            'application/json': {
              schema: (r.schema.response as any).toOpenApi(),
            },
          }
        }

        if (
          r.schema.body &&
          typeof (r.schema.body as any).toOpenApi === 'function'
        ) {
          operation.requestBody = {
            content: {
              'application/json': {
                schema: (r.schema.body as any).toOpenApi(),
              },
            },
          }
        }

        const parameters = []

        // Path params
        const pathMatches = [...r.path.matchAll(/:([a-zA-Z0-9_]+)/g)]
        for (const match of pathMatches) {
          parameters.push({
            name: match[1],
            in: 'path',
            required: true,
            schema: { type: 'string' },
          })
        }

        // Query params
        if (
          r.schema.query &&
          typeof (r.schema.query as any).toOpenApi === 'function'
        ) {
          const querySchema = (r.schema.query as any).toOpenApi()
          if (querySchema.type === 'object' && querySchema.properties) {
            for (const [key, prop] of Object.entries(querySchema.properties)) {
              parameters.push({
                name: key,
                in: 'query',
                required: querySchema.required
                  ? querySchema.required.includes(key)
                  : false,
                schema: prop,
              })
            }
          }
        }

        if (parameters.length > 0) {
          operation.parameters = parameters
        }

        // Apply cascaded metadata (like tags and security) from Gateway/Route
        if (r.schema.metadata && (r.schema.metadata as any).openapi) {
          Object.assign(operation, (r.schema.metadata as any).openapi)
        }
      }

      paths[oasPath][method] = operation
    }

    for (const key of Object.keys(paths)) {
      if (Object.keys(paths[key]).length === 0) {
        delete paths[key]
      }
    }

    const spec: any = {
      openapi: '3.0.0',
      info: {
        title,
        version,
      },
      paths,
    }

    if (options.components) {
      spec.components = options.components
    }

    res.json(spec)
  })

  // Serve Swagger UI HTML
  app.get(uiPath, (req, res) => {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="SwaggerUI" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
  <style>
    html { box-sizing: border-box; overflow: -moz-scrollbars-vertical; overflow-y: scroll; }
    *, *:before, *:after { box-sizing: inherit; }
    body { margin: 0; background: #fafafa; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '${jsonPath}',
        dom_id: '#swagger-ui',
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        layout: "StandaloneLayout",
      });
    };
  </script>
</body>
</html>`
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(html)
  })
}
