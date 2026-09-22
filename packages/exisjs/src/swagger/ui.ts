import type { SwaggerConfig } from './types'

/**
 * Generates the HTML markup for interactive Swagger UI or Scalar API documentation.
 */
export function renderDocumentationHtml(config: SwaggerConfig): string {
  const uiEngine = config.ui || 'swagger-ui'
  const title = config.title || 'ExisJS API Documentation'
  const specPath = config.specPath || '/docs/json'
  const customCss = config.customCss || ''
  const customFavicon =
    config.customFavicon ||
    'https://raw.githubusercontent.com/swagger-api/swagger-ui/master/dist/favicon-32x32.png'

  if (uiEngine === 'scalar') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/png" href="${escapeHtml(customFavicon)}">
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    ${customCss}
  </style>
</head>
<body>
  <script
    id="api-reference"
    data-url="${escapeHtml(specPath)}"
    data-configuration='{"theme":"purple","layout":"modern"}'
    src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.25.105/dist/browser/standalone.min.js">
  </script>
</body>
</html>`
  }

  // Default: Swagger UI
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" type="image/png" href="${escapeHtml(customFavicon)}">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui.css">
  <style>
    html {
      box-sizing: border-box;
      overflow: -moz-scrollbars-vertical;
      overflow-y: scroll;
    }
    *, *:before, *:after {
      box-sizing: inherit;
    }
    body {
      margin: 0;
      background: #fafafa;
    }
    .topbar {
      display: none !important;
    }
    .swagger-ui .info {
      margin: 25px 0 20px 0;
    }
    .swagger-ui .info .title {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-weight: 700;
      color: #1e293b;
    }
    .swagger-ui .btn.authorize {
      background-color: #7c3aed;
      border-color: #7c3aed;
      color: #fff;
    }
    .swagger-ui .btn.authorize svg {
      fill: #fff;
    }
    ${customCss}
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.18.2/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "${escapeHtml(specPath)}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout",
        displayRequestDuration: true,
        docExpansion: "list",
        filter: true,
        showExtensions: true,
        showCommonExtensions: true
      });
    };
  </script>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
