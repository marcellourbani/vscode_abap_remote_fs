/**
 * Language Model Tools Index
 * Central registration point for all ABAP FS LM tools
 */

import * as vscode from 'vscode';

/**
 * Register all language model tools
 */
export async function registerAllTools(context: vscode.ExtensionContext): Promise<void> {
  // Shared utilities (no registration needed - just exports)
  // Already available via: import { ... } from './lm-tools/shared'
  
  // 1. Mermaid Tools (4 tools)
  const { registerMermaidTools } = await import('./mermaidTools');
  registerMermaidTools(context);
  
  // 2. Analysis Tools
  const { registerDumpAnalysisTool } = await import('./dumpAnalysisTool');
  const { registerTraceAnalysisTool } = await import('./traceAnalysisTool');
  const { registerWhereUsedTool } = await import('./whereUsedTool');
  registerDumpAnalysisTool(context);
  registerTraceAnalysisTool(context);
  registerWhereUsedTool(context);
  
  // 3. Core Object Tools
  const { registerSearchObjectsTool } = await import('./searchObjectsTool');
  const { registerGetObjectLinesTool } = await import('./getObjectLinesTool');
  const { registerSearchObjectLinesTool } = await import('./searchObjectLinesTool');
  const { registerGetObjectInfoTool } = await import('./getObjectInfoTool');
  const { registerGetBatchLinesTool } = await import('./getBatchLinesTool');
  const { registerGetObjectByUriTool } = await import('./getObjectByUriTool');
  const { registerCreateObjectTool } = await import('./createObjectTool');
  const { registerOpenObjectTool } = await import('./openObjectTool');
  const { registerGetWorkspaceUriTool } = await import('./getWorkspaceUriTool');
  const { registerGetObjectUrlTool } = await import('./getObjectUrlTool');
  registerSearchObjectsTool(context);
  registerGetObjectLinesTool(context);
  registerSearchObjectLinesTool(context);
  registerGetObjectInfoTool(context);
  registerGetBatchLinesTool(context);
  registerGetObjectByUriTool(context);
  registerCreateObjectTool(context);
  registerOpenObjectTool(context);
  registerGetWorkspaceUriTool(context);
  registerGetObjectUrlTool(context);
  
  // 4. Unit Test Tools
  const { registerUnitTestTools } = await import('./unitTestTools');
  registerUnitTestTools(context);
  
  // 5. ATC Tools
  const { registerAtcTools } = await import('./atcTools');
  registerAtcTools(context);
  
  // 6. Transport Tool
  const { registerTransportTool } = await import('./transportTool');
  registerTransportTool(context);
  
  // 8. Data Query Tool
  const { registerDataQueryTool } = await import('./dataQueryTool');
  registerDataQueryTool(context);
  
  // 9. SQL Syntax Tool
  const { registerSqlSyntaxTool } = await import('./sqlSyntaxTool');
  registerSqlSyntaxTool(context);
  
  // 10. Test Documentation Tool
  const { registerTestDocumentationTool } = await import('./testDocumentationTool');
  registerTestDocumentationTool(context);
  
  // 11. Text Elements
  const { ManageTextElementsTool } = await import('./textElementsTools');
  context.subscriptions.push(
    vscode.lm.registerTool('manage_text_elements', new ManageTextElementsTool())
  );
  
  // 12. SAP System Info Tool
  const { registerSAPSystemInfoTool } = await import('./sapSystemInfoTool');
  registerSAPSystemInfoTool(context);
  
  // 13. Connected Systems Tool (for MCP clients to discover available connections)
  const { registerConnectedSystemsTool } = await import('./connectedSystemsTool');
  registerConnectedSystemsTool(context);
  
  // 14. Debugger Tools (6 tools)
  const { 
    ABAPDebugSessionTool, 
    ABAPBreakpointTool,
    ABAPDebugStepTool,
    ABAPDebugVariableTool,
    ABAPDebugStackTool,
    ABAPDebugStatusTool
  } = await import('./abapDebuggerTool');
  context.subscriptions.push(
    vscode.lm.registerTool('abap_debug_session', new ABAPDebugSessionTool())
  );
  context.subscriptions.push(
    vscode.lm.registerTool('abap_debug_breakpoint', new ABAPBreakpointTool())
  );
  context.subscriptions.push(
    vscode.lm.registerTool('abap_debug_step', new ABAPDebugStepTool())
  );
  context.subscriptions.push(
    vscode.lm.registerTool('abap_debug_variable', new ABAPDebugVariableTool())
  );
  context.subscriptions.push(
    vscode.lm.registerTool('abap_debug_stack', new ABAPDebugStackTool())
  );
  context.subscriptions.push(
    vscode.lm.registerTool('abap_debug_status', new ABAPDebugStatusTool())
  );

  // 15. Version History Tool
  const { registerVersionHistoryTool } = await import('./versionHistoryTool');
  registerVersionHistoryTool(context);

  // Initialize WebviewManager singleton (required for data query tool)
  const { WebviewManager } = await import('../webviewManager');
  WebviewManager.getInstance(context);
}
