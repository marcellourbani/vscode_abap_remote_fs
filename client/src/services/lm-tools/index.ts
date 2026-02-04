/**
 * Language Model Tools Index
 * Central registration point for all ABAP FS LM tools
 */

import * as vscode from "vscode"
import { registerMermaidTools } from "./mermaidTools"
import { registerDumpAnalysisTool } from "./dumpAnalysisTool"
import { registerTraceAnalysisTool } from "./traceAnalysisTool"
import { registerWhereUsedTool } from "./whereUsedTool"
import { registerSearchObjectsTool } from "./searchObjectsTool"
import { registerGetObjectLinesTool } from "./getObjectLinesTool"
import { registerSearchObjectLinesTool } from "./searchObjectLinesTool"
import { registerGetObjectInfoTool } from "./getObjectInfoTool"
import { registerGetBatchLinesTool } from "./getBatchLinesTool"
import { registerGetObjectByUriTool } from "./getObjectByUriTool"
import { registerCreateObjectTool } from "./createObjectTool"
import { registerOpenObjectTool } from "./openObjectTool"
import { registerGetWorkspaceUriTool } from "./getWorkspaceUriTool"
import { registerGetObjectUrlTool } from "./getObjectUrlTool"
import { registerUnitTestTools } from "./unitTestTools"
import { registerAtcTools } from "./atcTools"
import { registerTransportTool } from "./transportTool"
import { registerDataQueryTool } from "./dataQueryTool"
import { registerSqlSyntaxTool } from "./sqlSyntaxTool"
import { registerTestDocumentationTool } from "./testDocumentationTool"
import { ManageTextElementsTool } from "./textElementsTools"
import { registerSAPSystemInfoTool } from "./sapSystemInfoTool"
import { registerConnectedSystemsTool } from "./connectedSystemsTool"
import {
  ABAPDebugSessionTool,
  ABAPBreakpointTool,
  ABAPDebugStepTool,
  ABAPDebugVariableTool,
  ABAPDebugStackTool,
  ABAPDebugStatusTool
} from "./abapDebuggerTool"
import { registerVersionHistoryTool } from "./versionHistoryTool"
import { registerSubagentConfigTool } from "./subagentConfigTool"
import { WebviewManager } from "../webviewManager"

/**
 * Register all language model tools
 */
export async function registerAllTools(context: vscode.ExtensionContext): Promise<void> {
  // Shared utilities (no registration needed - just exports)
  // Already available via: import { ... } from './lm-tools/shared'

  // 1. Mermaid Tools (4 tools)
  registerMermaidTools(context)

  // 2. Analysis Tools
  registerDumpAnalysisTool(context)
  registerTraceAnalysisTool(context)
  registerWhereUsedTool(context)

  // 3. Core Object Tools
  registerSearchObjectsTool(context)
  registerGetObjectLinesTool(context)
  registerSearchObjectLinesTool(context)
  registerGetObjectInfoTool(context)
  registerGetBatchLinesTool(context)
  registerGetObjectByUriTool(context)
  registerCreateObjectTool(context)
  registerOpenObjectTool(context)
  registerGetWorkspaceUriTool(context)
  registerGetObjectUrlTool(context)

  // 4. Unit Test Tools
  registerUnitTestTools(context)

  // 5. ATC Tools
  registerAtcTools(context)

  // 6. Transport Tool
  registerTransportTool(context)

  // 8. Data Query Tool
  registerDataQueryTool(context)

  // 9. SQL Syntax Tool
  registerSqlSyntaxTool(context)

  // 10. Test Documentation Tool
  registerTestDocumentationTool(context)

  // 11. Text Elements
  context.subscriptions.push(
    vscode.lm.registerTool("manage_text_elements", new ManageTextElementsTool())
  )

  // 12. SAP System Info Tool
  registerSAPSystemInfoTool(context)

  // 13. Connected Systems Tool (for MCP clients to discover available connections)
  registerConnectedSystemsTool(context)

  // 14. Debugger Tools (6 tools)
  context.subscriptions.push(
    vscode.lm.registerTool("abap_debug_session", new ABAPDebugSessionTool())
  )
  context.subscriptions.push(
    vscode.lm.registerTool("abap_debug_breakpoint", new ABAPBreakpointTool())
  )
  context.subscriptions.push(vscode.lm.registerTool("abap_debug_step", new ABAPDebugStepTool()))
  context.subscriptions.push(
    vscode.lm.registerTool("abap_debug_variable", new ABAPDebugVariableTool())
  )
  context.subscriptions.push(vscode.lm.registerTool("abap_debug_stack", new ABAPDebugStackTool()))
  context.subscriptions.push(vscode.lm.registerTool("abap_debug_status", new ABAPDebugStatusTool()))

  // 15. Version History Tool
  registerVersionHistoryTool(context)

  // 16. Subagent Configuration Tool
  registerSubagentConfigTool(context)

  // 17. Heartbeat Tool (OpenClaw-style periodic LLM monitoring)
  const { registerHeartbeatTool, initializeHeartbeatService } = await import("../heartbeat")
  registerHeartbeatTool(context)

  // Initialize heartbeat service (will auto-start if enabled in config)
  const heartbeatService = initializeHeartbeatService(context)
  const heartbeatConfig = vscode.workspace.getConfiguration("abapfs.heartbeat")
  if (heartbeatConfig.get("enabled", false)) {
    heartbeatService.start()
  }
  // Initialize WebviewManager singleton (required for data query tool)
  WebviewManager.getInstance(context)
}
