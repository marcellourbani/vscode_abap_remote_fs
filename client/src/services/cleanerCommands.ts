/**
 * ABAP Cleaner Commands
 * Commands for the ABAP Cleaner integration
 */

import * as vscode from 'vscode';
import { funWindow as window } from './funMessenger';
import { ABAPCleanerService } from './abapCleanerService';
import { log } from '../lib';
import { logTelemetry } from './telemetry';

/**
 * Register all ABAP Cleaner-related commands
 */
export function registerCleanerCommands(context: vscode.ExtensionContext): void {
  const cleanerService = ABAPCleanerService.getInstance();

  // Main clean code command - can be called from icon or context menu
  const cleanCodeCommand = vscode.commands.registerCommand('abapfs.cleanCode', async () => {
   // log('🧹 AbapFs Clean Code command triggered');
    
    if (!cleanerService.isAvailable()) {
      const setup = await window.showInformationMessage(
        'ABAP Cleaner is not configured. Would you like to set it up now?',
        'Setup Now', 'Cancel'
      );
      
      if (setup === 'Setup Now') {
        await cleanerService.setupWizard();
      }
      return;
    }

    await cleanerService.cleanActiveEditor();
  });

  // Setup wizard command
  const setupCleanerCommand = vscode.commands.registerCommand('abapfs.setupCleaner', async () => {
   // log('⚙️ AbapFs Setup ABAP Cleaner command triggered');
    await cleanerService.setupWizard();
  });

  // Register auto-clean on save if enabled
  const onSaveListener = vscode.workspace.onWillSaveTextDocument(async (event) => {
    if (cleanerService.shouldCleanOnSave() && 
        event.document.languageId === 'abap' &&
        event.document.uri.scheme === 'adt') {
      
      log('💾 Auto-cleaning ABAP code on save...');
      
      // Note: This is a simplified version. For production, you'd want to
      // integrate this more carefully with the document save pipeline
      const editor = window.visibleTextEditors.find(
        e => e.document === event.document
      );
      
      if (editor) {
        // We can't directly modify the document during onWillSave,
        // so we'll show a message instead
        window.showInformationMessage(
          '💡 Tip: Use the clean code icon to format before saving'
        );
      }
    }
  });

  context.subscriptions.push(
    cleanCodeCommand, 
    setupCleanerCommand, 
    onSaveListener
  );
  
  log('✅ ABAP Cleaner commands registered successfully');
}

/**
 * Update editor context for showing/hiding ABAP Cleaner commands
 * Note: Called from main activeTextEditorChangedListener for efficiency
 */
export function updateCleanerContext(): void {
  const cleanerService = ABAPCleanerService.getInstance();
  const isAvailable = cleanerService.isAvailable();
  
  // Set context for when clause in package.json
  vscode.commands.executeCommand('setContext', 'abapfs.cleanerAvailable', isAvailable);
}

/**
 * Setup cleaner context monitoring
 * Note: Editor change monitoring is handled by main listener for performance
 */
export function setupCleanerContextMonitoring(context: vscode.ExtensionContext): void {
  // Update context when configuration changes
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('abapfs.cleaner')) {
      updateCleanerContext();
    }
  });

  context.subscriptions.push(configChangeListener);
  
  // Initial context update
  updateCleanerContext();
  
  log('✅ ABAP Cleaner context monitoring setup complete');
}
