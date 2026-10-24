import { client, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk"
import type { ClientConnection, ClientContext, InitializeResponse } from "@agentclientprotocol/sdk"
import { ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"

import { AcpClientImpl } from "./AcpClientImpl"
import { FileSystemHandler } from "../handlers/FileSystemHandler"
import { TerminalHandler } from "../handlers/TerminalHandler"
import { PermissionHandler } from "../handlers/PermissionHandler"
import { ElicitationHandler } from "../handlers/ElicitationHandler"
import { SessionUpdateHandler } from "../handlers/SessionUpdateHandler"
import * as vscode from "vscode"
import { log, logError, logTraffic } from "../utils/Logger"

type Stream = ReturnType<typeof ndJsonStream>

function logPipeError(direction: string, e: unknown): void {
  if (e instanceof Error && e.message === "ACP connection closed") return
  logError(`Traffic tap ${direction} pipe error`, e)
}

const extensionVersion: string =
  vscode.extensions.getExtension("murbani.vscode-abap-remote-fs")?.packageJSON?.version ?? "0.0.0"

export interface ConnectionInfo {
  connection: ClientConnection
  agent: ClientContext
  initResponse: InitializeResponse
}

function stripTerminalControlSequences(
  input: ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ""
  let logged = false

  const cleanLine = (line: string): string => {
    const clean = line
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    if (!logged && clean !== line) {
      logged = true
      log("Removed terminal control sequences from agent stdout before ACP parsing")
    }
    return clean
  }

  return input.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true })
        const lines = pending.split("\n")
        pending = lines.pop() || ""
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${cleanLine(line)}\n`))
        }
      },
      flush(controller) {
        pending += decoder.decode()
        if (pending) {
          controller.enqueue(encoder.encode(cleanLine(pending)))
        }
      }
    })
  )
}

/**
 * Manages ACP connections to agent processes.
 * Creates SDK 1.9 ClientApp connections from spawned child processes.
 */
export class ConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map()

  constructor(private readonly sessionUpdateHandler: SessionUpdateHandler) {}

  /**
   * Create an ACP connection from a child process.
   * Sets up streams, creates connection, and performs initialization handshake.
   */
  async connect(agentId: string, process: ChildProcess): Promise<ConnectionInfo> {
    if (!process.stdout || !process.stdin) {
      throw new Error("Agent process missing stdio streams")
    }

    log(`ConnectionManager: connecting to agent ${agentId}`)

    // Create Web Streams from Node.js streams
    const readable = Readable.toWeb(process.stdout) as ReadableStream<Uint8Array>
    const writable = Writable.toWeb(process.stdin) as WritableStream<Uint8Array>

    const stream = ndJsonStream(writable, stripTerminalControlSequences(readable))

    // Wrap the stream to intercept and log all ACP traffic
    const tappedStream = this.tapStream(stream)

    // Create handlers
    const fsHandler = new FileSystemHandler()
    const terminalHandler = new TerminalHandler()
    const permissionHandler = new PermissionHandler()
    const elicitationHandler = new ElicitationHandler()

    // Create client implementation
    const clientHandlers = new AcpClientImpl(
      fsHandler,
      terminalHandler,
      permissionHandler,
      elicitationHandler,
      this.sessionUpdateHandler
    )

    const clientApp = client({ name: "ABAP FS" })
    clientHandlers.register(clientApp)
    const connection = clientApp.connect(tappedStream)

    // Initialize the connection
    log(`ConnectionManager: initializing connection to agent ${agentId}`)
    const initResponse = await connection.agent.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: {
        name: "abap-fs",
        version: extensionVersion
      },
      clientCapabilities: {
        fs: {
          readTextFile: true,
          writeTextFile: true
        },
        terminal: true,
        session: { notices: {}, compaction: {}, configOptions: { boolean: {} } },
        elicitation: { form: {} },
        plan: {},
        subagents: {}
      }
    })

    log(
      `ConnectionManager: initialized. Agent: ${initResponse.agentInfo?.name || "unknown"} v${initResponse.agentInfo?.version || "?"}`
    )

    const info: ConnectionInfo = {
      connection,
      agent: connection.agent,
      initResponse
    }
    this.connections.set(agentId, info)

    return info
  }

  getConnection(agentId: string): ConnectionInfo | undefined {
    return this.connections.get(agentId)
  }

  removeConnection(agentId: string): void {
    this.connections.get(agentId)?.connection.close()
    this.connections.delete(agentId)
  }

  dispose(): void {
    for (const info of this.connections.values()) {
      info.connection.close()
    }
    this.connections.clear()
  }

  /**
   * Wrap a Stream to intercept and log all messages in both directions.
   */
  private tapStream(stream: Stream): Stream {
    // Tap outgoing messages (client → agent)
    const sendTap = new TransformStream({
      transform(chunk: unknown, controller: TransformStreamDefaultController) {
        logTraffic("send", chunk)
        controller.enqueue(chunk)
      }
    })

    // Tap incoming messages (agent → client)
    const recvTap = new TransformStream({
      transform(chunk: unknown, controller: TransformStreamDefaultController) {
        logTraffic("recv", chunk)
        controller.enqueue(chunk)
      }
    })

    // Pipe: sendTap.readable → original writable, original readable → recvTap.writable
    // These run in the background — no need to await
    void sendTap.readable.pipeTo(stream.writable).catch(e => logPipeError("send", e))
    void stream.readable.pipeTo(recvTap.writable).catch(e => logPipeError("recv", e))

    return {
      writable: sendTap.writable,
      readable: recvTap.readable
    }
  }
}
