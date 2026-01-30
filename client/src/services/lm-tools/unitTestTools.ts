/**
 * ABAP Unit Test Tools
 * Create test includes and run unit tests
 */

import * as vscode from 'vscode';
import { getSearchService } from '../abapSearchService';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACES
// ============================================================================

export interface ICreateTestIncludeParameters {
  className: string;
  connectionId: string;
}

export interface IRunUnitTestsParameters {
  objectName: string;
  connectionId: string;
}

// ============================================================================
// TOOL CLASSES
// ============================================================================

/**
 * 🧪 CREATE TEST INCLUDE TOOL
 */
export class CreateTestIncludeTool implements vscode.LanguageModelTool<ICreateTestIncludeParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ICreateTestIncludeParameters>,
    _token: vscode.CancellationToken
  ) {
    const { className, connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Create Test Include',
      message: new vscode.MarkdownString(
        `Creating test include for ABAP class` +
        (className ? `\n\n**Class:** ${className}` : ' (using active editor)') +
        (connectionId ? `\n**Connection:** ${connectionId}` : '')
      ),
    };

    return {
      invocationMessage: `Creating test include${className ? ` for ${className}` : ''}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICreateTestIncludeParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    let { className, connectionId } = options.input;
    logTelemetry("tool_create_test_include_called", { connectionId });

    try {
      const searcher = getSearchService(connectionId.toLowerCase());
      const searchResults = await searcher.searchObjects(className, ['CLAS/OC'], 1);
      
      if (!searchResults || searchResults.length === 0) {
        throw new Error(`Could not find ABAP class: ${className}. Please check the class name and ensure it exists.`);
      }
      
      const classInfo = searchResults[0];
      if (!classInfo.uri) {
        throw new Error(`Could not get URI for ABAP class: ${className}.`);
      }

      const { getOrCreateRoot } = await import('../../adt/conections');
      const root = await getOrCreateRoot(connectionId.toLowerCase());
      const result = await root.findByAdtUri(classInfo.uri, true);
      
      if (!result || !result.path) {
        throw new Error(`Could not resolve workspace path for class: ${className}`);
      }
      
      const workspaceUri = vscode.Uri.parse(`adt://${connectionId.toLowerCase()}${result.path}`);

      const { uriAbapFile } = await import('../../adt/operations/AdtObjectFinder');
      const { isAbapClass } = await import('abapobject');
      const abapFile = uriAbapFile(workspaceUri);
      if (abapFile?.object?.parent && isAbapClass(abapFile.object.parent)) {
        if (!abapFile.object.parent.structure) {
          await abapFile.object.parent.loadStructure();
        }
        
        if (abapFile.object.parent.findInclude("testclasses")) {
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`ℹ️ Test include already exists for class ${className}. No action needed.`)
          ]);
        }
      }

      await vscode.commands.executeCommand('abapfs.createtestinclude', workspaceUri);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`✅ Test include created successfully for class ${className}! The test include is now available in the class structure and has been opened in the editor.`)
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to create test include: ${errorMessage}`)
      ]);
    }
  }
}

/**
 * 🧪 RUN UNIT TESTS TOOL
 */
export class RunUnitTestsTool implements vscode.LanguageModelTool<IRunUnitTestsParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IRunUnitTestsParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, connectionId } = options.input;
    
    const confirmationMessages = {
      title: 'Run ABAP Unit Tests',
      message: new vscode.MarkdownString(
        `Running unit tests for ABAP object:\n\n` +
        `**Object:** ${objectName}\n` +
        `**Connection:** ${connectionId}\n\n` +
        `Results will be displayed in the Testing view.`
      ),
    };

    return {
      invocationMessage: `Running unit tests for ${objectName}`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IRunUnitTestsParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { objectName, connectionId } = options.input;
    logTelemetry("tool_run_unit_tests_called", { connectionId });

    try {
      const searcher = getSearchService(connectionId.toLowerCase());
      const searchResults = await searcher.searchObjects(objectName, undefined, 1);
      
      if (!searchResults || searchResults.length === 0) {
        throw new Error(`Could not find ABAP object: ${objectName}. Please check the object name and ensure it exists.`);
      }
      
      const objectInfo = searchResults[0];
      if (!objectInfo.uri) {
        throw new Error(`Could not get URI for ABAP object: ${objectName}.`);
      }

      const { getOrCreateRoot } = await import('../../adt/conections');
      const root = await getOrCreateRoot(connectionId.toLowerCase());
      const result = await root.findByAdtUri(objectInfo.uri, true);
      
      if (!result || !result.path) {
        throw new Error(`Could not resolve workspace path for object: ${objectName}`);
      }
      
      const workspaceUri = vscode.Uri.parse(`adt://${connectionId.toLowerCase()}${result.path}`);

      // Use the new method that returns results
      const { UnitTestRunner } = await import('../../adt/operations/UnitTestRunner');
      const testResults = await UnitTestRunner.get(connectionId.toLowerCase()).addResultsWithReturn(workspaceUri);
      
      // Format results for Copilot
      const resultText = this.formatTestResults(testResults);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to run unit tests: ${errorMessage}`)
      ]);
    }
  }

  private formatTestResults(results: import('../../adt/operations/UnitTestRunner').UnitTestResults): string {
    const icon = results.allPassed ? '✅' : '❌';
    const status = results.allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED';
    
    let output = `${icon} **Unit Test Results for ${results.objectName}**\n\n`;
    output += `**Status:** ${status}\n`;
    output += `**Total Tests:** ${results.totalTests}\n`;
    output += `**Passed:** ${results.passed} | **Failed:** ${results.failed}\n`;
    output += `**Total Time:** ${results.totalTime.toFixed(3)}s\n\n`;
    
    if (results.classes.length > 0) {
      output += `**Test Classes:**\n`;
      
      for (const testClass of results.classes) {
        const classIcon = testClass.passed ? '✅' : '❌';
        output += `\n${classIcon} **${testClass.name}**\n`;
        
        // Show class-level alerts if any
        if (testClass.alerts.length > 0) {
          for (const alert of testClass.alerts) {
            output += `  ⚠️ ${alert.title}\n`;
          }
        }
        
        // Show methods
        for (const method of testClass.methods) {
          const methodIcon = method.passed ? '✅' : '❌';
          output += `  ${methodIcon} ${method.name} (${method.executionTime.toFixed(3)}s)\n`;
          
          // Show method alerts (failures)
          if (!method.passed && method.alerts.length > 0) {
            for (const alert of method.alerts) {
              output += `     ⚠️ ${alert.title}\n`;
              if (alert.details.length > 0) {
                output += `        ${alert.details.join('\n        ')}\n`;
              }
            }
          }
        }
      }
    } else {
      output += `⚠️ No test classes found in this object.\n`;
    }
    
    output += `\n📊 Results are also displayed in the VS Code Testing view.`;
    
    return output;
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerUnitTestTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('create_test_include', new CreateTestIncludeTool())
  );
  context.subscriptions.push(
    vscode.lm.registerTool('run_unit_tests', new RunUnitTestsTool())
  );
}
