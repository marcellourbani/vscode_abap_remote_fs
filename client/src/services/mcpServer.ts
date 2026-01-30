/**
 * MCP Server for ABAP FS - Exposes tools via Model Context Protocol
 * 
 * This dynamically wraps all VS Code Language Model tools registered by ABAP FS
 * and exposes them as MCP tools for external AI clients (Cursor, Claude Desktop, etc.)
 * 
 * Usage in other AI tools config:
 * {
 *   "mcpServers": {
 *     "abap-fs": {
 *       "url": "http://localhost:<port>/mcp"
 *     }
 *   }
 * }
 */

import * as vscode from 'vscode';
import * as http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';

// ============================================================================
// TYPES
// ============================================================================

interface McpServerState {
  httpServer: http.Server | null;
  isRunning: boolean;
  port: number;
}

// Map to store transports by session ID
const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

// ============================================================================
// STATE & SETTINGS
// ============================================================================

const state: McpServerState = {
  httpServer: null,
  isRunning: false,
  port: 4847,
};

/**
 * Get MCP server settings from VS Code configuration
 */
function getMcpSettings(): { autoStart: boolean; port: number } {
  const config = vscode.workspace.getConfiguration('abapfs.mcpServer');
  return {
    autoStart: config.get<boolean>('autoStart', false),
    port: config.get<number>('port', 4847),
  };
}

// ============================================================================
// JSON SCHEMA TO ZOD CONVERTER
// ============================================================================

/**
 * Convert a JSON Schema property to a Zod schema.
 * This is a simplified converter that handles the most common cases.
 */
function jsonSchemaPropertyToZod(propSchema: Record<string, unknown>, isRequired: boolean): z.ZodTypeAny {
  const type = propSchema.type as string | undefined;
  const description = propSchema.description as string | undefined;
  
  let zodType: z.ZodTypeAny;
  
  switch (type) {
    case 'string':
      if (propSchema.enum && Array.isArray(propSchema.enum)) {
        // Handle enum strings
        const enumValues = propSchema.enum as [string, ...string[]];
        zodType = z.enum(enumValues);
      } else {
        zodType = z.string();
      }
      break;
    case 'number':
    case 'integer':
      zodType = z.number();
      break;
    case 'boolean':
      zodType = z.boolean();
      break;
    case 'array':
      const itemsSchema = propSchema.items as Record<string, unknown> | undefined;
      if (itemsSchema) {
        zodType = z.array(jsonSchemaPropertyToZod(itemsSchema, true));
      } else {
        zodType = z.array(z.unknown());
      }
      break;
    case 'object':
      const objProperties = propSchema.properties as Record<string, Record<string, unknown>> | undefined;
      const objRequired = (propSchema.required as string[]) || [];
      if (objProperties) {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const [key, value] of Object.entries(objProperties)) {
          shape[key] = jsonSchemaPropertyToZod(value, objRequired.includes(key));
        }
        zodType = z.object(shape);
      } else {
        zodType = z.record(z.string(), z.unknown());
      }
      break;
    default:
      // Unknown or missing type - accept anything
      zodType = z.unknown();
  }
  
  // Add description if present
  if (description) {
    zodType = zodType.describe(description);
  }
  
  // Make optional if not required
  if (!isRequired) {
    zodType = zodType.optional();
  }
  
  return zodType;
}

/**
 * Convert a full JSON Schema (with properties) to a Zod object schema.
 */
function jsonSchemaToZod(jsonSchema: Record<string, unknown> | undefined): Record<string, z.ZodTypeAny> {
  if (!jsonSchema) {
    return {};
  }
  
  const properties = jsonSchema.properties as Record<string, Record<string, unknown>> | undefined;
  const required = (jsonSchema.required as string[]) || [];
  
  if (!properties) {
    return {};
  }
  
  const zodShape: Record<string, z.ZodTypeAny> = {};
  
  for (const [propName, propSchema] of Object.entries(properties)) {
    zodShape[propName] = jsonSchemaPropertyToZod(propSchema, required.includes(propName));
  }
  
  return zodShape;
}

// ============================================================================
// DYNAMIC TOOL WRAPPER
// ============================================================================

// Tag used to identify ABAP FS tools
const ABAP_FS_TAG = 'abap-fs';

/**
 * Create an MCP server that dynamically wraps all VS Code LM tools
 */
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'abap-fs',
    version: '1.0.0',
  });

  // Get all registered LM tools and filter to only ABAP FS tools
  const allTools = vscode.lm.tools;
  const abapTools = allTools.filter(tool => tool.tags.includes(ABAP_FS_TAG));

  for (const tool of abapTools) {
    const toolName = tool.name;
    const toolDescription = tool.description || `ABAP FS tool: ${toolName}`;
    const inputSchema = tool.inputSchema as Record<string, unknown> | undefined;

    // Convert JSON Schema to Zod schema
    const zodSchema = jsonSchemaToZod(inputSchema);

    // Register each LM tool as an MCP tool
    server.registerTool(
      toolName,
      {
        title: toolName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description: toolDescription,
        inputSchema: zodSchema,
      },
      async (args: Record<string, unknown>) => {
        try {
          // Create a cancellation token (MCP doesn't provide one, so we create a dummy)
          const tokenSource = new vscode.CancellationTokenSource();
          
          // Invoke the VS Code LM tool
          // toolInvocationToken can be undefined when invoked outside of chat context
          const result = await vscode.lm.invokeTool(
            toolName,
            { 
              input: args,
              toolInvocationToken: undefined 
            },
            tokenSource.token
          );

          // Convert LanguageModelToolResult to MCP tool result
          // The LM result contains content parts that we need to serialize
          const textParts: string[] = [];
          
          for await (const part of result.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
              textParts.push(part.value);
            } else if (typeof part === 'object' && part !== null && 'value' in part) {
              const partWithValue = part as { value: unknown };
              if (typeof partWithValue.value === 'string') {
                textParts.push(partWithValue.value);
              } else {
                textParts.push(JSON.stringify(partWithValue.value));
              }
            } else {
              // For other part types, try to JSON stringify them
              textParts.push(JSON.stringify(part));
            }
          }

          const resultText = textParts.join('\n');

          return {
            content: [
              {
                type: 'text' as const,
                text: resultText,
              },
            ],
          };

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          return {
            content: [
              {
                type: 'text' as const,
                text: `❌ Error invoking ${toolName}: ${errorMessage}`,
              },
            ],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

// ============================================================================
// HTTP SERVER WITH STREAMABLE HTTP TRANSPORT (Per-Session)
// ============================================================================

/**
 * Parse JSON body from incoming request
 */
async function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function startHttpServer(): Promise<void> {
  if (state.isRunning) {
    return;
  }

  // Get configured port from settings
  const settings = getMcpSettings();
  state.port = settings.port;

  state.httpServer = http.createServer(async (req, res) => {
    // CORS headers for cross-origin requests
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://localhost:${state.port}`);

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'abap-fs-mcp' }));
      return;
    }

    // MCP endpoint - handles all MCP protocol messages
    if (url.pathname === '/mcp') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // Handle POST requests (JSON-RPC messages)
      if (req.method === 'POST') {
        try {
          const body = await parseJsonBody(req);

          let transport: StreamableHTTPServerTransport;

          if (sessionId && transports[sessionId]) {
            // Reuse existing transport for this session
            transport = transports[sessionId];
          } else if (!sessionId && isInitializeRequest(body)) {
            // New initialization request - create new transport and server
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: (newSessionId: string) => {
                transports[newSessionId] = transport;
              },
            });

            // Clean up on close
            transport.onclose = () => {
              const sid = transport.sessionId;
              if (sid && transports[sid]) {
                delete transports[sid];
              }
            };

            // Create a new MCP server instance and connect it to this transport
            const server = createMcpServer();
            await server.connect(transport);

            // Handle the initialization request
            await transport.handleRequest(req, res, body);
            return;
          } else {
            // Invalid request - no session ID and not an initialization request
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Bad Request: No valid session ID provided',
              },
              id: null,
            }));
            return;
          }

          // Handle the request with existing transport
          await transport.handleRequest(req, res, body);
        } catch {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              error: { code: -32603, message: 'Internal server error' },
              id: null,
            }));
          }
        }
        return;
      }

      // Handle GET requests for SSE streams
      if (req.method === 'GET') {
        if (!sessionId || !transports[sessionId]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
          return;
        }
        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
        return;
      }

      // Handle DELETE requests for session termination
      if (req.method === 'DELETE') {
        if (!sessionId || !transports[sessionId]) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid or missing session ID' }));
          return;
        }
        const transport = transports[sessionId];
        await transport.handleRequest(req, res);
        return;
      }
    }

    // Root endpoint with info
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'ABAP FS MCP Server',
        version: '1.0.0',
        description: 'MCP server exposing ABAP FS tools for external AI clients',
        endpoints: {
          mcp: '/mcp - Streamable HTTP endpoint for MCP connection',
          health: '/health - Health check endpoint',
        },
        usage: {
          cursor: `Add to MCP config: { "url": "http://localhost:${state.port}/mcp" }`,
        },
        activeSessions: Object.keys(transports).length,
      }));
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  // Try to start the server, incrementing port if busy
  const startWithRetry = (port: number, maxRetries: number = 10): Promise<number> => {
    return new Promise((resolve, reject) => {
      state.httpServer!.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && maxRetries > 0) {
          resolve(startWithRetry(port + 1, maxRetries - 1));
        } else {
          reject(err);
        }
      });

      state.httpServer!.listen(port, () => {
        resolve(port);
      });
    });
  };

  try {
    const actualPort = await startWithRetry(state.port);
    state.port = actualPort;
    state.isRunning = true;
    
    // Show notification to user
    vscode.window.showInformationMessage(
      `🔌 ABAP MCP Server running on port ${actualPort}. External AI clients can connect to http://localhost:${actualPort}/mcp`
    );

  } catch (error) {
    throw error;
  }
}

function stopServer(): void {
  // Close all active transports
  for (const sessionId of Object.keys(transports)) {
    try {
      transports[sessionId].close();
      delete transports[sessionId];
    } catch {
      // Ignore errors during cleanup
    }
  }
  
  if (state.httpServer) {
    state.httpServer.close();
    state.httpServer = null;
  }
  state.isRunning = false;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Initialize and start the MCP server based on settings
 * Call this from extension.ts during activation
 */
export async function initializeMcpServer(context: vscode.ExtensionContext): Promise<void> {
  const settings = getMcpSettings();
  
  if (!settings.autoStart) {
    return; // Don't start if autoStart is disabled
  }

  try {
    await startHttpServer();
    
    // Register cleanup on extension deactivation
    context.subscriptions.push({
      dispose: () => {
        stopServer();
      },
    });
    
  } catch (error) {
    // Don't throw - MCP server is optional, extension should still work
    vscode.window.showWarningMessage(
      `MCP Server failed to start: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get the current MCP server status
 */
export function getMcpServerStatus(): { isRunning: boolean; port: number; url: string } {
  return {
    isRunning: state.isRunning,
    port: state.port,
    url: state.isRunning ? `http://localhost:${state.port}/mcp` : '',
  };
}
