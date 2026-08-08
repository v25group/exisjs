import { parentPort } from 'node:worker_threads'

// In development, tsx handles on-the-fly compilation for imports.
// In production, we import .js files directly.

if (parentPort) {
  parentPort.on('message', async (msg) => {
    try {
      const { id, filePath, payload } = msg

      // 1. Dynamically import the job file
      const mod = await import(filePath)
      const jobDef = mod.default || mod

      if (!jobDef || typeof jobDef.handler !== 'function') {
        throw new Error(
          `Job file ${filePath} must export a default defineJob() or an object with a handler function.`
        )
      }

      // 2. Validate payload if schema is present
      const finalPayload = payload
      if (jobDef.schema && finalPayload.data) {
        finalPayload.data = jobDef.schema.parse(finalPayload.data)
      }

      // 3. Execute the handler!
      const result = await jobDef.handler(finalPayload)

      // 4. Return success
      parentPort!.postMessage({ id, status: 'success', result })
    } catch (err: any) {
      parentPort!.postMessage({
        id: msg.id,
        status: 'error',
        error: {
          message: err.message,
          stack: err.stack,
        },
      })
    }
  })
}
