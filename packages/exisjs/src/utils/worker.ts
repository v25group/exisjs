import { Worker } from 'node:worker_threads'

/**
 * Offloads a CPU-heavy function to a worker thread to prevent blocking the main event loop.
 *
 * Note: The function cannot access variables outside its scope (closures), as it is
 * serialized and executed in a separate V8 isolate. Pass any required variables via `data`.
 * Any imports needed must be `require()`d inside the function body.
 *
 * @example
 * const hash = await runInWorker({ pass: 'secret', salt: 'salt' }, (data) => {
 *   const crypto = require('crypto')
 *   return crypto.pbkdf2Sync(data.pass, data.salt, 100000, 64, 'sha512').toString('hex')
 * })
 */
export function runInWorker<T, U>(data: T, fn: (data: T) => U): Promise<U> {
  return new Promise((resolve, reject) => {
    const code = `
      const { parentPort, workerData } = require('node:worker_threads');
      try {
        const fn = ${fn.toString()};
        const result = fn(workerData);
        if (result instanceof Promise) {
          result.then(res => parentPort.postMessage({ type: 'success', data: res }))
                .catch(err => parentPort.postMessage({ type: 'error', error: err.message || err }));
        } else {
          parentPort.postMessage({ type: 'success', data: result });
        }
      } catch (err) {
        parentPort.postMessage({ type: 'error', error: err.message || err });
      }
    `
    const worker = new Worker(code, { eval: true, workerData: data })

    worker.on('message', (msg) => {
      if (msg.type === 'success') resolve(msg.data)
      else reject(new Error(msg.error))
      worker.terminate()
    })

    worker.on('error', reject)
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`))
    })
  })
}
