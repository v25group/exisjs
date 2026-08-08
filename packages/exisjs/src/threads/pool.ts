import { Worker } from 'node:worker_threads'
import path from 'node:path'
import os from 'node:os'

interface Task {
  id: string
  filePath: string
  payload: any
  resolve: (value: any) => void
  reject: (error: Error) => void
}

export class ThreadPool {
  private workers: Worker[] = []
  private idleWorkers: Worker[] = []
  private queue: Task[] = []
  private taskCallbacks = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: any) => void }
  >()
  private runnerPath: string
  private execArgv: string[]

  constructor(poolSize = Math.max(1, os.cpus().length - 1)) {
    // Determine path based on environment
    const normalizedDir = __dirname.replace(/\\/g, '/')
    const isCompiled = normalizedDir.endsWith('dist/threads')
    const ext = isCompiled ? '.js' : '.ts'
    this.runnerPath = path.join(__dirname, `worker-runner${ext}`)

    // Handle TS execution in dev via tsx if needed (tsx registers automatically on the main process,
    // but workers spawn fresh node instances, so we pass the tsx/cli loader if running ts)
    this.execArgv = ext === '.ts' ? ['--import', 'tsx'] : []

    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(this.runnerPath, { execArgv: this.execArgv })
      this.setupWorker(worker)
      this.workers.push(worker)
      this.idleWorkers.push(worker)
    }
  }

  private setupWorker(worker: Worker) {
    worker.on('message', (msg) => {
      const { id, status, result, error } = msg
      const callbacks = this.taskCallbacks.get(id)

      if (callbacks) {
        if (status === 'success') {
          callbacks.resolve(result)
        } else {
          const err = new Error(error.message)
          err.stack = error.stack
          callbacks.reject(err)
        }
        this.taskCallbacks.delete(id)
      }

      // Worker is now idle, assign next task if available
      this.idleWorkers.push(worker)
      this.processNext()
    })

    worker.on('error', (err) => {
      console.error('[ThreadPool Worker Error]', err)
      // Remove dead worker and spawn a new one
      this.workers = this.workers.filter((w) => w !== worker)
      this.idleWorkers = this.idleWorkers.filter((w) => w !== worker)

      const newWorker = new Worker(this.runnerPath, { execArgv: this.execArgv })
      this.setupWorker(newWorker)
      this.workers.push(newWorker)
      this.idleWorkers.push(newWorker)
      this.processNext()
    })
  }

  private processNext() {
    if (this.queue.length === 0 || this.idleWorkers.length === 0) return

    const task = this.queue.shift()!
    const worker = this.idleWorkers.pop()!

    this.taskCallbacks.set(task.id, {
      resolve: task.resolve,
      reject: task.reject,
    })

    worker.postMessage({
      id: task.id,
      filePath: task.filePath,
      payload: task.payload,
    })
  }

  runJob(filePath: string, payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id =
        Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9)
      this.queue.push({ id, filePath, payload, resolve, reject })
      this.processNext()
    })
  }

  async close() {
    for (const worker of this.workers) {
      await worker.terminate()
    }
    this.workers = []
    this.idleWorkers = []
  }
}
