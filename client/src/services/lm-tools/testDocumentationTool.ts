/**
 * Create Test Documentation Tool
 * Generate Word documents with test scenarios and screenshots
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../funMessenger';
import { logTelemetry } from '../telemetry';

// ============================================================================
// INTERFACE
// ============================================================================

export interface ICreateTestDocumentationParameters {
  scenarios: Array<{
    scenarioId: number;
    scenarioName: string;
    scenarioDescription: string;
    screenshots: Array<{
      filePath: string;
      description: string;
    }>;
  }>;
  reportTitle?: string;
  testDate?: string;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 📝 CREATE TEST DOCUMENTATION TOOL
 */
export class CreateTestDocumentationTool implements vscode.LanguageModelTool<ICreateTestDocumentationParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ICreateTestDocumentationParameters>,
    _token: vscode.CancellationToken
  ) {
    const { scenarios, reportTitle, testDate } = options.input;
    
    const totalScreenshots = scenarios.reduce((sum, scenario) => sum + scenario.screenshots.length, 0);
    
    const confirmationMessages = {
      title: 'Create Test Documentation',
      message: new vscode.MarkdownString(
        `Create Word document with ${scenarios.length} scenario(s) and ${totalScreenshots} screenshot(s)` +
        (reportTitle ? `\n\n**Title:** ${reportTitle}` : '') +
        (testDate ? `\n**Date:** ${testDate}` : '')
      ),
    };

    return {
      invocationMessage: `Creating test documentation with ${scenarios.length} scenarios...`,
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICreateTestDocumentationParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { scenarios, reportTitle, testDate } = options.input;
    logTelemetry("tool_create_test_documentation_called");

    try {
      const { TestDocumentCreator } = await import('../testDocumentCreator');
      const creator = new TestDocumentCreator();
      
      const documentBuffer = await creator.createDocument({
        scenarios,
        reportTitle,
        testDate
      });
      
      const savedPath = await creator.saveDocument(documentBuffer, reportTitle ? `${reportTitle.replace(/[^a-zA-Z0-9]/g, '_')}.docx` : undefined);
      
      let resultMessage = `✅ Test documentation created successfully`;
      
      if (savedPath) {
        resultMessage += `\n💾 Saved to: ${savedPath}`;
        
        const openFile = 'Open File';
        const action = await window.showInformationMessage(
          `✅ Test documentation saved to: ${savedPath}`,
          openFile
        );
        
        if (action === openFile) {
          await vscode.env.openExternal(vscode.Uri.file(savedPath));
        }
      }
      
      const totalScreenshots = scenarios.reduce((sum, scenario) => sum + scenario.screenshots.length, 0);
      
      const resultText = `**📝 Test Documentation Created Successfully** ✅\n\n` +
        `• **Scenarios:** ${scenarios.length}\n` +
        `• **Total Screenshots:** ${totalScreenshots}\n` +
        `• **Report Title:** ${reportTitle || 'Test Documentation Report'}\n` +
        `• **Test Date:** ${testDate || new Date().toISOString().split('T')[0]}\n` +
        `• **Status:** ${resultMessage}\n\n` +
        `**📊 Scenario Breakdown:**\n` +
        scenarios.map(scenario => 
          `• **Scenario ${scenario.scenarioId}:** ${scenario.scenarioName} (${scenario.screenshots.length} screenshots)`
        ).join('\n');

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(resultText)
      ]);

    } catch (error) {
      let errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('Cannot find module \'docx\'')) {
        errorMessage = 'The docx package is not installed. Please install it by running: npm install docx';
      }

      throw new Error(`Failed to create test documentation: ${errorMessage}`);
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerTestDocumentationTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('create_test_documentation', new CreateTestDocumentationTool())
  );
}
