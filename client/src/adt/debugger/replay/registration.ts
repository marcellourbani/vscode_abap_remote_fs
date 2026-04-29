import { commands, debug, DebugConfigurationProviderTriggerKind, ExtensionContext, Uri } from "vscode"
import { ReplayAdapterFactory, ReplayConfigurationProvider, REPLAY_DEBUG_TYPE } from "./replayAdapterFactory"
import { DEBUGTYPE } from "../abapConfigurationProvider"
import { AbapDebugSession } from "../abapDebugSession"
import { saveRecording, saveRecordingCompressed, loadRecordingFromUri, compressRecording, decompressRecording } from "./recordingIO"
import { funWindow as window } from "../../../services/funMessenger"
import { log } from "../../../lib"
import { DebugListener } from "../debugListener"
import { logTelemetry } from "../../../services/telemetry"

/**
 * Registers the replay debugger adapter, configuration provider, and commands.
 */
export function registerReplayDebugger(context: ExtensionContext) {
  const factory = ReplayAdapterFactory.instance
  const provider = new ReplayConfigurationProvider()

  const factoryReg = debug.registerDebugAdapterDescriptorFactory(REPLAY_DEBUG_TYPE, factory)
  const providerReg = debug.registerDebugConfigurationProvider(
    REPLAY_DEBUG_TYPE,
    provider,
    DebugConfigurationProviderTriggerKind.Dynamic
  )

  context.subscriptions.push(
    factoryReg,
    providerReg,
    commands.registerCommand("abapfs.startRecording", startRecordingCommand),
    commands.registerCommand("abapfs.stopRecording", stopRecordingCommand),
    commands.registerCommand("abapfs.replaySession", replaySessionCommand),
    commands.registerCommand("abapfs.compressRecording", compressRecordingCommand),
    commands.registerCommand("abapfs.decompressRecording", decompressRecordingCommand),
    // Safety net: auto-stop recording when ABAP debug session terminates
    // Primary auto-stop is in AbapDebugSession.logOut(), but disconnectRequest
    // may not always fire (e.g., VS Code force-closes the session)
    debug.onDidTerminateDebugSession(session => {
      if (session.type !== DEBUGTYPE) return
      const connId = session.configuration?.connId
      if (!connId) return
      const abapSession = AbapDebugSession.byConnection(connId)
      // Check if there's still a recording listener for this connection
      if (abapSession?.debugListener?.isRecording) {
        log(`onDidTerminateDebugSession: auto-stopping recording for ${connId}`)
        autoStopRecording(abapSession.debugListener)
      }
    })
  )
}

async function startRecordingCommand() {
  logTelemetry("command_start_recording_called")
  // Find the active ABAP debug session
  const session = debug.activeDebugSession
  if (!session || session.type !== DEBUGTYPE) {
    window.showErrorMessage("No active ABAP debug session. Start debugging first.")
    return
  }

  const connId = session.configuration.connId
  if (!connId) {
    window.showErrorMessage("Cannot determine connection ID from debug session")
    return
  }

  const abapSession = AbapDebugSession.byConnection(connId)
  if (!abapSession) {
    window.showErrorMessage("Cannot find ABAP debug session")
    return
  }

  const listener = abapSession.debugListener
  if (listener.isRecording) {
    window.showInformationMessage("Already recording")
    return
  }

  listener.startRecording()
  window.showInformationMessage("⏺ Recording started")
}

async function stopRecordingCommand() {
  logTelemetry("command_stop_recording_called")
  const listener = findRecordingListener()
  if (!listener) {
    window.showInformationMessage("No active recording")
    return
  }

  const recording = await listener.stopRecording()

  if (!recording) {
    window.showInformationMessage("No steps recorded")
    return
  }

  const action = await window.showInformationMessage(
    `Recording complete: ${recording.totalSteps} steps. Save?`,
    "Save",
    "Compress & Save",
    "Discard"
  )
  if (action === "Save") {
    await saveRecording(recording)
  } else if (action === "Compress & Save") {
    await saveRecordingCompressed(recording)
  }
}

async function replaySessionCommand(fileUri?: Uri) {
  logTelemetry("command_replay_session_called")
  let recording
  if (fileUri) {
    recording = await loadRecordingFromUri(fileUri)
    if (!recording) return // load failed, error already shown
  }

  if (recording) {
    ReplayAdapterFactory.instance.setPendingRecording(recording)
  }

  const started = await debug.startDebugging(undefined, {
    type: REPLAY_DEBUG_TYPE,
    request: "launch",
    name: "Replay ABAP Recording"
  })
  if (!started) {
    ReplayAdapterFactory.instance.clearPendingRecording()
  }
}

async function compressRecordingCommand() {
  logTelemetry("command_compress_recording_called")
  await compressRecording()
}

async function decompressRecordingCommand() {
  logTelemetry("command_decompress_recording_called")
  await decompressRecording()
}

/** Find the DebugListener that is currently recording (if any) */
function findRecordingListener(): DebugListener | undefined {
  // Try active session first
  const session = debug.activeDebugSession
  if (session?.type === DEBUGTYPE) {
    const connId = session.configuration?.connId
    if (connId) {
      const abapSession = AbapDebugSession.byConnection(connId)
      if (abapSession?.debugListener?.isRecording) return abapSession.debugListener
    }
  }
  // Fall back: scan all sessions
  for (const s of AbapDebugSession.allSessions()) {
    if (s.debugListener?.isRecording) return s.debugListener
  }
  return undefined
}

async function autoStopRecording(listener: DebugListener) {
  try {
    const recording = await listener.stopRecording()
    if (!recording) return
    const action = await window.showInformationMessage(
      `Debug session ended. Save recording (${recording.totalSteps} steps)?`,
      "Save",
      "Compress & Save",
      "Discard"
    )
    if (action === "Save") {
      await saveRecording(recording)
    } else if (action === "Compress & Save") {
      await saveRecordingCompressed(recording)
    }
  } catch (e) {
    log(`autoStopRecording failed: ${e}`)
  }
}
