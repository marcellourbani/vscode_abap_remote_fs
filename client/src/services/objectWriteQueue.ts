import type { Uri } from "vscode"

const queues = new Map<string, Promise<void>>()

export function objectWriteKey(uri: Uri): string {
  return JSON.stringify([uri.authority.toLowerCase(), uri.path])
}

/**
 * Runs writes to the same ABAP object one at a time, in call order.
 * A failed operation does not block the ones queued after it.
 */
export async function serializeObjectWrite<T>(uri: Uri, operation: () => Promise<T>): Promise<T> {
  const key = objectWriteKey(uri)
  const previous = queues.get(key) ?? Promise.resolve()
  const current = previous.then(operation)
  const settled = current.then(
    () => undefined,
    () => undefined
  )
  queues.set(key, settled)
  try {
    return await current
  } finally {
    if (queues.get(key) === settled) queues.delete(key)
  }
}
