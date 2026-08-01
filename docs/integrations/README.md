# ExisJS Integrations Blueprint

This directory contains the documentation for integrating third-party services and tools with ExisJS. This `README.md` acts as a **blueprint** to help you understand what each integration guide covers.

## 🗄️ Databases & Storage
*   **`mongo.mdx`**: Connecting to MongoDB using Mongoose, leveraging the DI container, and data modeling.
*   **`postgres.mdx`**: Connecting to PostgreSQL databases (e.g., via Prisma or Drizzle ORM) in a type-safe manner.
*   **`redis.mdx`**: Using Redis for high-speed caching, rate limiting, and powering ExisJS queues.
*   **`s3.mdx`**: Integrating with AWS S3 (or compatible services like Cloudflare R2) for file uploads and object storage.

## 🔐 Auth & Security
*   **`jwt.mdx`**: Implementing JSON Web Token (JWT) authentication, signing, and protecting routes via middleware.

## 🤖 Artificial Intelligence
*   **`openai.mdx`**: Integrating the OpenAI SDK, streaming LLM responses using ExisJS SSE (Server-Sent Events), and managing API keys securely.

## 📧 Communications
*   **`resend.mdx`**: Sending transactional emails (like password resets or welcome emails) using the Resend API, ideally triggered via background Queues.

## 📊 Analytics & Observability
*   **`posthog.mdx`**: Capturing user events, feature flags, and product analytics using PostHog inside your ExisJS controllers.
*   **`observability.mdx`**: Setting up advanced monitoring, tracing (OpenTelemetry), and logging infrastructure.
*   **`swagger.mdx`**: Automatic OpenAPI/Swagger generation for your endpoints based on your validation schemas and route definitions.
