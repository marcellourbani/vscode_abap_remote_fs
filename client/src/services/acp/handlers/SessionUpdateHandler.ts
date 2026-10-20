import { logError } from "../utils/Logger"

import type { SessionNotification } from "@agentclientprotocol/sdk"

export type SessionUpdateListener = (update: SessionNotification) => void

/**
 * Routes session/update notifications to registered listeners.
 * The ChatWebviewProvider registers as a listener to forward updates to the webview.
 */
export class SessionUpdateHandler {
  private listeners: Set<SessionUpdateListener> = new Set()

  addListener(listener: SessionUpdateListener): void {
    this.listeners.add(listener)
  }

  removeListener(listener: SessionUpdateListener): void {
    this.listeners.delete(listener)
  }

  handleUpdate(update: SessionNotification): void {
    for (const listener of this.listeners) {
      try {
        listener(update)
      } catch (e) {
        logError("Error in session update listener", e)
      }
    }
  }

  dispose(): void {
    this.listeners.clear()
  }
}
