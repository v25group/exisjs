import type { ListenOptions } from '../../types'

export interface HttpEngine {
  readonly name: string

  /**
   * Start the server and listen on the given port and host.
   */
  listen(
    port: number,
    host: string,
    options: ListenOptions,
    onListen: (address: { port: number; host: string }) => void
  ): Promise<any> | any

  /**
   * Close the server gracefully.
   */
  close(): Promise<void> | void
}
