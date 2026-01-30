/**
 * Execute Data Query Tool
 * Jarvis-like SAP Data Access with Dynamic Webviews
 */

import * as vscode from 'vscode';
import { logTelemetry } from '../telemetry';
import { WebviewManager, RowRange, SortColumn, ColumnFilter } from '../webviewManager';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IExecuteDataQueryParameters {
  sql?: string;
  data?: {
    columns: Array<{
      name: string;
      type: string;
      description?: string;
    }>;
    values: Array<Record<string, any>>;
  };
  displayMode: 'internal' | 'ui';
  webviewId?: string;
  connectionId?: string;
  title?: string;
  maxRows?: number;
  rowRange?: {
    start: number;
    end: number;
  };
  sortColumns?: Array<{
    column: string;
    direction: 'asc' | 'desc';
  }>;
  filters?: Array<{
    column: string;
    value: string;
  }>;
  resetSorting?: boolean;
  resetFilters?: boolean;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 🔍 EXECUTE DATA QUERY TOOL - Jarvis-like SAP Data Access with Dynamic Webviews
 */
export class ExecuteDataQueryTool implements vscode.LanguageModelTool<IExecuteDataQueryParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IExecuteDataQueryParameters>,
    _token: vscode.CancellationToken
  ) {
    const { sql, data, displayMode, webviewId, connectionId, title, maxRows, rowRange, sortColumns, filters, resetSorting, resetFilters } = options.input;
    
    if (!displayMode || !['internal', 'ui'].includes(displayMode)) {
      throw new Error('displayMode must be either "internal" or "ui"');
    }
    
    if (displayMode === 'internal' && webviewId) {
      throw new Error('❌ LOGICAL CONFLICT: displayMode "internal" is for data processing without UI, but webviewId was provided. Use displayMode "ui" to work with existing webviews, or remove webviewId for internal processing.');
    }
    
    if (!webviewId && !sql && !data) {
      throw new Error('Either SQL query, direct data, or existing webviewId must be provided');
    }
    
    if (sql && data) {
      throw new Error('Cannot provide both SQL query and direct data - choose one');
    }
    
    if (sql) {
      if (typeof sql !== 'string' || sql.trim().length === 0) {
      throw new Error('SQL query must be a non-empty string if provided');
      }
      
      const upperSQL = sql.toUpperCase().trim();
      const dangerousPatterns = [
        /\bDROP\s+/i,
        /\bDELETE\s+(?!.*\bFROM\s+@)/i,
        /\bINSERT\s+/i,
        /\bUPDATE\s+/i,
        /\bALTER\s+/i,
        /\bCREATE\s+/i,
        /\bTRUNCATE\s+/i,
        /;\s*(?!$)/i,
        /--/i,
        /\/\*/i,
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(upperSQL)) {
          throw new Error(`SQL query contains dangerous operation. Only SELECT and WITH statements are allowed.`);
        }
      }

      if (!upperSQL.startsWith('SELECT') && !upperSQL.startsWith('WITH')) {
        throw new Error('Only SELECT and WITH statements are allowed');
      }
    }
    
    if (data) {
      if (!data.columns || !Array.isArray(data.columns) || data.columns.length === 0) {
        throw new Error('data.columns must be a non-empty array');
      }
      if (!data.values || !Array.isArray(data.values)) {
        throw new Error('data.values must be an array');
      }
      for (const col of data.columns) {
        if (!col.name || typeof col.name !== 'string') {
          throw new Error('Each column must have a name (string)');
        }
        if (!col.type || typeof col.type !== 'string') {
          throw new Error('Each column must have a type (string)');
        }
      }
    }
    
    if (displayMode === 'internal' && !rowRange) {
      throw new Error('❌ CRITICAL: rowRange is MANDATORY for internal mode to prevent accidental large data transfers that could overwhelm the system. You MUST specify start and end rows (e.g., {start: 0, end: 10}) to analyze specific data ranges.');
    }
    
    if (maxRows !== undefined && (typeof maxRows !== 'number' || maxRows < 1 || maxRows > 50000)) {
      throw new Error('maxRows must be a number between 1 and 50000 (safety limit, not added to SQL)');
    }
    
    if (rowRange) {
      if (typeof rowRange.start !== 'number' || typeof rowRange.end !== 'number' || 
          rowRange.start < 0 || rowRange.end <= rowRange.start) {
        throw new Error('rowRange must have valid start and end numbers with end > start >= 0');
      }
      
      const rowRangeSize = rowRange.end - rowRange.start;
      if (displayMode === 'internal' && rowRangeSize > 1000) {
        throw new Error(`❌ SAFETY LIMIT: Internal mode rowRange cannot exceed 1000 rows. Requested: ${rowRangeSize} rows (${rowRange.start} to ${rowRange.end}). Break large analysis into smaller chunks.`);
      }
    }
    
    if (sortColumns && !Array.isArray(sortColumns)) {
      throw new Error('sortColumns must be an array');
    }
    
    if (filters && !Array.isArray(filters)) {
      throw new Error('filters must be an array');
    }
    
    const action = webviewId ? 'manipulating existing data' : (data ? 'displaying provided data' : 'executing new query');
    return {
      invocationMessage: displayMode === 'ui' 
        ? `${action} and displaying results in ${webviewId ? 'existing' : 'new'} webview...`
        : `${action} and returning specific rows internally...`
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IExecuteDataQueryParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      let { sql, data, displayMode, webviewId, connectionId, title, maxRows, rowRange, sortColumns, filters, resetSorting, resetFilters } = options.input;
      logTelemetry("tool_execute_data_query_called", { connectionId });
      
      if (connectionId) {
        connectionId = connectionId.toLowerCase();
      }

      // ========================================================================
      // PRODUCTION SYSTEM GUARD
      // Only check in internal mode - that's when data is sent back to Copilot
      // UI mode is fine - user sees data directly, not sent to Copilot
      // ========================================================================
      let switchedToUiMode = false;
      if (sql && connectionId && displayMode === 'internal') {
        const guardResult = await this.checkProductionGuard(sql, connectionId);
        if (guardResult.action === 'cancel') {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart('Query cancelled by user. The system is a production system and user chose not to run the query.')
          ]);
        }
        if (guardResult.action === 'ui_only') {
          displayMode = 'ui';
          switchedToUiMode = true;
          // Adjust rowRange since UI mode doesn't require it
          rowRange = undefined;
        }
        // action === 'proceed' means continue as normal
      }

      const isNewData = !webviewId || !!sql || !!data;

      if (displayMode === 'internal') {
        const webviewManager = WebviewManager.getInstance();
        
        if (isNewData && (sql || data)) {
          const tempWebviewResult = await webviewManager.createOrUpdateWebview(
            data || await (async () => {
              let targetConnectionId = connectionId || 'default';
              const { getClient } = await import('../../adt/conections');
              const client = getClient(targetConnectionId);
              if (!client) {
                throw new Error(`No client found for connection: ${targetConnectionId}`);
              }
              return client;
            })(),
            data ? 'DATA_INPUT' : sql!,
            data ? '' : (connectionId || 'default'),
            undefined,
            title,
            maxRows,
            undefined,
            sortColumns as SortColumn[],
            filters as ColumnFilter[],
            resetSorting,
            resetFilters
          );
          
          const processedData = await webviewManager.getWebviewData(tempWebviewResult.webviewId, rowRange as RowRange);
          
          if (!webviewId) {
            webviewManager.closeWebview(tempWebviewResult.webviewId);
          }
          
          const rowCount = processedData?.values?.length || 0;
          const columnCount = processedData?.columns?.length || 0;
          const totalRows = tempWebviewResult.state?.totalRows || 0;

          const response = {
            data: processedData,
            state: {
              totalRows,
              returnedRows: rowCount,
              appliedSorting: sortColumns || [],
              appliedFilters: filters || [],
              webviewId: webviewId || null,
              isNewData,
              rowRange
            }
          };

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Query processed successfully. Returned ${rowCount} of ${totalRows} total rows with ${columnCount} columns.`),
            new vscode.LanguageModelTextPart(`State: ${sortColumns?.length || 0} sort(s), ${filters?.length || 0} filter(s) applied.`),
            new vscode.LanguageModelTextPart(JSON.stringify(response, null, 2))
          ]);
          
        } else {
          const result = await webviewManager.manipulateWebview(
            webviewId!,
            rowRange as RowRange,
            sortColumns as SortColumn[],
            filters as ColumnFilter[],
            resetSorting,
            resetFilters
          );
          
          const rowCount = result.data?.values?.length || 0;
          const columnCount = result.data?.columns?.length || 0;
          const totalRows = result.state?.totalRows || 0;

          const response = {
            data: result.data,
            state: {
              totalRows,
              returnedRows: rowCount,
              appliedSorting: sortColumns || [],
              appliedFilters: filters || [],
              webviewId,
              isNewData: false,
              rowRange
            }
          };

          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Query processed successfully. Returned ${rowCount} of ${totalRows} total rows with ${columnCount} columns.`),
            new vscode.LanguageModelTextPart(`State: ${sortColumns?.length || 0} sort(s), ${filters?.length || 0} filter(s) applied.`),
            new vscode.LanguageModelTextPart(JSON.stringify(response, null, 2))
          ]);
        }

      } else {
        const webviewManager = WebviewManager.getInstance();
        
        let result;
        if (isNewData && (sql || data)) {
          if (data) {
            result = await webviewManager.createOrUpdateWebview(
              data,
              'DATA_INPUT',
              '',
              webviewId,
              title,
              maxRows,
              rowRange as RowRange,
              sortColumns as SortColumn[],
              filters as ColumnFilter[],
              resetSorting,
              resetFilters
            );
            
          } else if (sql) {
            let targetConnectionId = connectionId || 'default';
            const { getClient } = await import('../../adt/conections');
            const client = getClient(targetConnectionId);
            if (!client) {
              throw new Error(`No client found for connection: ${targetConnectionId}`);
            }

            result = await webviewManager.createOrUpdateWebview(
              client,
              sql,
              targetConnectionId,
              webviewId,
              title,
              maxRows,
              rowRange as RowRange,
              sortColumns as SortColumn[],
              filters as ColumnFilter[],
              resetSorting,
              resetFilters
            );
          } else {
            throw new Error('Either SQL or data must be provided for new data');
          }
        } else {
          result = await webviewManager.manipulateWebview(
            webviewId!,
            rowRange as RowRange,
            sortColumns as SortColumn[],
            filters as ColumnFilter[],
            resetSorting,
            resetFilters
          );
        }

        const rowCount = result.data?.values?.length || 0;
        const columnCount = result.data?.columns?.length || 0;
        const action = webviewId && !sql ? 'manipulated' : (webviewId ? 'updated' : 'created');

        const response = {
          webviewId: result.webviewId,
          action,
          state: result.state || {
            returnedRows: rowCount,
            totalRows: rowCount,
            appliedSorting: sortColumns || [],
            appliedFilters: filters || []
          }
        };

        // If user chose "UI only" due to production guard, inform Copilot
        const guardNote = switchedToUiMode 
          ? `\n\n⚠️ PRODUCTION SYSTEM: User chose to view results in UI only. Data was NOT sent back to you for security reasons. The user can see the results in the webview.`
          : '';

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Webview ${action} successfully (ID: ${result.webviewId}). ` +
            `Displaying ${rowCount} rows with ${columnCount} columns.${guardNote}`
          ),
          new vscode.LanguageModelTextPart(
            `Current state: ${(sortColumns || []).length} sort(s), ${(filters || []).length} filter(s) applied.`
          ),
          new vscode.LanguageModelTextPart(JSON.stringify(response, null, 2))
        ]);
      }

    } catch (error: any) {
      const errorMsg = error?.localizedMessage || error?.message || String(error);
      const webviewId = error?.webviewId;
      
      const errorWithWebviewId = webviewId 
        ? `Failed to execute data query: ${errorMsg} (webviewId: ${webviewId})`
        : `Failed to execute data query: ${errorMsg}`;
      
      throw new Error(errorWithWebviewId);
    }
  }

  /**
   * Check if running SQL on a production system and prompt user for action
   * Only called for internal mode (when data is sent back to Copilot)
   * Returns: 'proceed' | 'ui_only' | 'cancel'
   */
  private async checkProductionGuard(
    sql: string,
    connectionId: string
  ): Promise<{ action: 'proceed' | 'ui_only' | 'cancel' }> {
    try {
      // Get system info (cached, so fast)
      const { getSAPSystemInfo } = await import('../sapSystemInfo');
      
      const systemInfo = await getSAPSystemInfo(connectionId);
      
      // Check if production (category 'P' or contains 'Production')
      const isProduction = systemInfo.currentClient?.category === 'Production' ||
                          systemInfo.currentClient?.category?.startsWith('P');
      
      if (!isProduction) {
        return { action: 'proceed' }; // Not production, allow
      }
      
      // Production system detected - show dialog
      const clientInfo = systemInfo.currentClient 
        ? `${connectionId.toUpperCase()} (Client ${systemInfo.currentClient.clientNumber}: ${systemInfo.currentClient.clientName})`
        : connectionId.toUpperCase();
      
      const sqlPreview = sql.length > 100 ? sql.substring(0, 100) + '...' : sql;
      
      const choice = await vscode.window.showWarningMessage(
        `⚠️ PRODUCTION SYSTEM DETECTED\n\n` +
        `Copilot wants to run SQL on: ${clientInfo}\n\n` +
        `Query: ${sqlPreview}`,
        { modal: true },
        { title: 'Run & Send results to Copilot', action: 'proceed' },
        { title: 'Run & Show in UI Only', action: 'ui_only' },
        { title: 'Cancel', action: 'cancel', isCloseAffordance: true }
      );
      
      if (!choice || choice.action === 'cancel') {
        return { action: 'cancel' };
      }
      
      return { action: choice.action as 'proceed' | 'ui_only' };
      
    } catch (error) {
      // If check fails, allow query to proceed (don't block on errors)
      console.warn('Production guard check failed:', error);
      return { action: 'proceed' };
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerDataQueryTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('execute_data_query', new ExecuteDataQueryTool())
  );
}
