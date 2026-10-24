// Relays MCP traffic between an agent speaking stdio and the local ABAP FS MCP HTTP server, for
// ACP agents that only accept stdio MCP servers. stdout carries protocol messages only.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const BRIDGE_TOKEN_ENV = "ABAPFS_MCP_TOKEN"

function fail(message: string): never {
  process.stderr.write(`abap-fs mcp bridge: ${message}\n`)
  process.exit(1)
}

async function main() {
  const url = process.argv[2]
  if (!url) fail("missing MCP server url argument")
  const token = process.env[BRIDGE_TOKEN_ENV]
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

  const agent = new StdioServerTransport()
  const server = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } })

  const report = (error: unknown): void => {
    process.stderr.write(`abap-fs mcp bridge: ${error}\n`)
  }
  // the HTTP session id arrives with the initialize response; later messages must wait for it
  let initialized: Promise<void> | undefined
  agent.onmessage = message => {
    if (!initialized) {
      initialized = server.send(message).catch(report)
      return
    }
    void initialized.then(() => server.send(message)).catch(report)
  }
  server.onmessage = message => {
    agent.send(message).catch(error => process.stderr.write(`abap-fs mcp bridge: ${error}\n`))
  }
  agent.onclose = () => void server.close().finally(() => process.exit(0))
  server.onclose = () => void agent.close().finally(() => process.exit(0))
  agent.onerror = error => process.stderr.write(`abap-fs mcp bridge: ${error}\n`)
  server.onerror = error => process.stderr.write(`abap-fs mcp bridge: ${error}\n`)

  await server.start()
  await agent.start()
}

main().catch(error => fail(String(error)))
