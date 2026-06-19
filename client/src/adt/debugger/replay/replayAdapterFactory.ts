import {
  CancellationToken, DebugAdapterDescriptor, DebugAdapterDescriptorFactory,
  DebugAdapterInlineImplementation, DebugConfigurationProvider,
  DebugSession, Uri, WorkspaceFolder
} from "vscode"
import { DebugRecording, REPLAY_DEBUG_TYPE } from "./types"
import { ReplayDebugSession } from "./replayDebugSession"
import { loadRecording, loadRecordingFromUri } from "./recordingIO"
import { funWindow as window } from "../../../services/funMessenger"

export { REPLAY_DEBUG_TYPE }

interface ReplayLaunchConfig {
  type: string
  name: string
  request: string
  recordingPath?: string
}

/**
 * Provides debug configuration for the abap-replay adapter type.
 */
export class ReplayConfigurationProvider implements DebugConfigurationProvider {
  provideDebugConfigurations(): ReplayLaunchConfig[] {
    return [{
      type: REPLAY_DEBUG_TYPE,
      request: "launch",
      name: "Replay ABAP Recording"
    }]
  }

  resolveDebugConfiguration(
    _folder: WorkspaceFolder | undefined,
    config: ReplayLaunchConfig,
    _token?: CancellationToken
  ): ReplayLaunchConfig {
    return {
      ...config,
      type: REPLAY_DEBUG_TYPE,
      request: "launch",
      name: config.name || "Replay ABAP Recording"
    }
  }
}

/**
 * Factory that creates ReplayDebugSession instances.
 * Loads the recording from a file and passes it to the session.
 */
export class ReplayAdapterFactory implements DebugAdapterDescriptorFactory {
  private static _instance: ReplayAdapterFactory
  private pendingRecording: DebugRecording | undefined

  private constructor() {}

  /** Set a recording for the next factory call. Overwrites any previous. */
  setPendingRecording(recording: DebugRecording) {
    this.pendingRecording = recording
  }

  /** Clear any pending recording (e.g., if session launch failed) */
  clearPendingRecording() {
    this.pendingRecording = undefined
  }

  async createDebugAdapterDescriptor(
    session: DebugSession
  ): Promise<DebugAdapterDescriptor | undefined> {
    let recording = this.pendingRecording
    this.pendingRecording = undefined

    if (!recording) {
      const config = session.configuration as ReplayLaunchConfig
      if (config.recordingPath) {
        recording = await loadRecordingFromUri(Uri.file(config.recordingPath))
      } else {
        recording = await loadRecording()
      }
    }

    if (!recording) {
      window.showErrorMessage("No recording loaded")
      return undefined
    }

    const replaySession = new ReplayDebugSession(recording)
    return new DebugAdapterInlineImplementation(replaySession)
  }

  static get instance(): ReplayAdapterFactory {
    if (!this._instance) {
      this._instance = new ReplayAdapterFactory()
    }
    return this._instance
  }
}
