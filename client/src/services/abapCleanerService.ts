/**
 * ABAP Cleaner Service
 * 
 * Integration with SAP's ABAP Cleaner tool for automatic code formatting
 * https://github.com/SAP/abap-cleaner
 */

import * as vscode from 'vscode';
import { funWindow as window } from './funMessenger';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { logTelemetry } from './telemetry';
import { exec } from 'child_process';
import { log } from '../lib';

const execAsync = promisify(exec);

export interface CleanerConfig {
  enabled: boolean;
  executablePath: string;
  profilePath?: string;
  targetRelease: string;
  showStatistics: boolean;
  showAppliedRules: boolean;
  cleanOnSave: boolean;
  lineRange?: {
    enabled: boolean;
    expandRange: boolean;
  };
  timeout: number;
}

export interface CleanerResult {
  success: boolean;
  cleanedCode?: string;
  statistics?: string;
  appliedRules?: string[];
  error?: string;
  changed: boolean;
}

export class ABAPCleanerService {
  private static instance: ABAPCleanerService;
  private config: CleanerConfig;
  private tempFileCounter = 0;

  private constructor() {
    this.config = this.loadConfiguration();
    
    // Watch configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('abapfs.cleaner')) {
        this.config = this.loadConfiguration();
        this.updateContext();
        log('🔧 ABAP Cleaner configuration updated');
      }
    });

    this.updateContext();
  }

  public static getInstance(): ABAPCleanerService {
    if (!ABAPCleanerService.instance) {
      ABAPCleanerService.instance = new ABAPCleanerService();
    }
    return ABAPCleanerService.instance;
  }

  private loadConfiguration(): CleanerConfig {
    const config = vscode.workspace.getConfiguration('abapfs.cleaner');
    return {
      enabled: config.get('enabled', false),
      executablePath: config.get('executablePath', ''),
      profilePath: config.get('profilePath', ''),
      targetRelease: config.get('targetRelease', 'latest'),
      showStatistics: config.get('showStatistics', true),
      showAppliedRules: config.get('showAppliedRules', false),
      cleanOnSave: config.get('cleanOnSave', false),
      lineRange: config.get('lineRange', { enabled: false, expandRange: true }),
      timeout: config.get('timeout', 30000)
    };
  }

  private updateContext(): void {
    const isAvailable = this.isAvailable();
    vscode.commands.executeCommand('setContext', 'abapfs.cleanerAvailable', isAvailable);
  }

  public isAvailable(): boolean {
    return this.config.enabled && this.isExecutableValid();
  }

  public isExecutableValid(): boolean {
    if (!this.config.executablePath) {
      return false;
    }

    try {
      return fs.existsSync(this.config.executablePath);
    } catch (error) {
      log(`❌ Error checking cleaner executable: ${error}`);
      return false;
    }
  }

  /**
   * Validate and sanitize file paths to prevent command injection
   */
  private validatePath(filePath: string, description: string): void {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error(`${description} path is required`);
    }
    
    // Prevent path traversal and command injection
    if (filePath.includes('..') || filePath.includes(';') || filePath.includes('&') || 
        filePath.includes('|') || filePath.includes('`') || filePath.includes('$')) {
      throw new Error(`${description} path contains invalid characters`);
    }
    
    // Ensure path is absolute to prevent relative path attacks
    if (!path.isAbsolute(filePath)) {
      throw new Error(`${description} path must be absolute`);
    }
  }

  /**
   * Clean ABAP code using the configured cleaner
   */
  public async cleanCode(
    code: string, 
    options?: { 
      startLine?: number; 
      endLine?: number; 
      fileName?: string 
    }
  ): Promise<CleanerResult> {
    if (!this.isAvailable()) {
      return {
        success: false,
        error: 'ABAP Cleaner is not available. Please check configuration.',
        changed: false
      };
    }

    // Validate executable path before use
    try {
      this.validatePath(this.config.executablePath, 'Executable');
      if (this.config.profilePath) {
        this.validatePath(this.config.profilePath, 'Profile');
      }
    } catch (error) {
      return {
        success: false,
        error: `Security validation failed: ${error}`,
        changed: false
      };
    }

    try {
      log('🧹 Starting ABAP code cleaning...');
      
      // Create temporary files
      const tempInputFile = await this.createTempFile(code, 'input.abap');
      const tempOutputFile = await this.createTempFile('', 'output.abap');
      
      // Validate temp file paths
      this.validatePath(tempInputFile, 'Temporary input file');
      this.validatePath(tempOutputFile, 'Temporary output file');

      try {
        // Build command
        const command = await this.buildCleanCommand(tempInputFile, tempOutputFile, options);

        // Execute cleaner
        const { stdout, stderr } = await execAsync(command, {
          timeout: this.config.timeout,
          cwd: path.dirname(this.config.executablePath)
        });

        // Read cleaned code
        const cleanedCode = await this.readTempFile(tempOutputFile);
        const changed = cleanedCode !== code;

        const result: CleanerResult = {
          success: true,
          cleanedCode,
          changed,
          statistics: this.config.showStatistics ? this.extractStatistics(stdout) : undefined,
          appliedRules: this.config.showAppliedRules ? this.extractAppliedRules(stdout) : undefined
        };

        if (changed) {
        } else {
          log(`✅ ABAP code processed. No changes needed.`);
        }

        if (stderr && stderr.trim()) {
          log(`⚠️ Cleaner warnings: ${stderr}`);
        }

        return result;

      } finally {
        // Cleanup temp files
        await this.deleteTempFile(tempInputFile);
        await this.deleteTempFile(tempOutputFile);
      }

    } catch (error) {
      log(`❌ ABAP Cleaner error: ${error}`);
      return {
        success: false,
        error: `ABAP Cleaner failed: ${error}`,
        changed: false
      };
    }
  }

  /**
   * Clean the current active editor
   */
  public async cleanActiveEditor(): Promise<boolean> {
    const editor = window.activeTextEditor;
    logTelemetry("command_cleaner_called", { activeEditor: editor });
    
    if (!editor) {
      window.showWarningMessage('No active editor found');
      return false;
    }

    if (editor.document.languageId !== 'abap') {
      window.showWarningMessage('Current file is not an ABAP file');
      return false;
    }

    const document = editor.document;
    const selection = editor.selection;
    
    // Determine what to clean
    let textToClean: string;
    let startLine: number | undefined;
    let endLine: number | undefined;
    let range: vscode.Range;

    if (!selection.isEmpty && this.config.lineRange?.enabled) {
      // Clean selection
      range = new vscode.Range(selection.start, selection.end);
      textToClean = document.getText(range);
      startLine = selection.start.line + 1; // Convert to 1-based
      endLine = selection.end.line + 1;
      log(`🎯 Cleaning selected lines ${startLine}-${endLine}`);
    } else {
      // Clean entire document
      range = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      textToClean = document.getText();
    }

    // Show progress
    return window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'ABAP Cleaner',
      cancellable: false
    }, async (progress) => {
      progress.report({ message: 'Cleaning ABAP code...' });

      const result = await this.cleanCode(textToClean, {
        startLine,
        endLine,
        fileName: document.fileName
      });

      if (!result.success) {
        window.showErrorMessage(`ABAP Cleaner failed: ${result.error}`);
        return false;
      }

      if (!result.changed) {
        window.showInformationMessage('✨ ABAP code is already clean - no changes needed');
        return true;
      }

      if (result.cleanedCode) {
        // Apply changes
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, range, result.cleanedCode);
        
        const applied = await vscode.workspace.applyEdit(edit);
        
        if (applied) {
          // Show statistics if available
          let message = '✨ ABAP code cleaned successfully';
          if (result.statistics) {
            message += `\n${result.statistics}`;
          }
          
          window.showInformationMessage(message);
          
          if (result.appliedRules && result.appliedRules.length > 0) {
            const rules = result.appliedRules.slice(0, 5).join(', ');
            const moreRules = result.appliedRules.length > 5 ? ` and ${result.appliedRules.length - 5} more` : '';
          }
          
          return true;
        } else {
          window.showErrorMessage('Failed to apply ABAP Cleaner changes');
          return false;
        }
      }

      return false;
    });
  }

  /**
   * Setup wizard for ABAP Cleaner configuration
   */
  public async setupWizard(): Promise<void> {
    logTelemetry("command_setup_abap_cleaner_integration_called") // No context available
    try {

      // Step 1: Check if already configured
      if (this.isAvailable()) {
        const reconfigure = await window.showQuickPick(
          ['Keep current configuration', 'Reconfigure ABAP Cleaner'],
          {
            placeHolder: 'ABAP Cleaner is already configured. What would you like to do?',
            ignoreFocusOut: true
          }
        );

        if (reconfigure !== 'Reconfigure ABAP Cleaner') {
          return;
        }
      }

      // Step 2: Select executable
      const executablePath = await this.selectExecutable();
      if (!executablePath) {
        return;
      }

      // Step 3: Test executable with the newly selected path
      const testResult = await window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'ABAP Cleaner Setup',
        cancellable: false
      }, async (progress) => {
        progress.report({ message: 'Testing ABAP Cleaner executable...' });
        return await this.testExecutable(executablePath);
      });

      if (!testResult.success) {
        window.showErrorMessage(`ABAP Cleaner test failed: ${testResult.error}`);
        return;
      }

      // Step 4: Optional profile selection
      const profilePath = await this.selectProfile();

      // Step 5: Target release selection
      const targetRelease = await this.selectTargetRelease();
      if (!targetRelease) {
        return;
      }

      // Step 6: Additional options
      const options = await this.selectOptions();
      if (!options) {
        return;
      }

      // Step 7: Save configuration
      await this.saveConfiguration({
        enabled: true,
        executablePath,
        profilePath,
        targetRelease,
        ...options
      });

      window.showInformationMessage(
        '✅ ABAP Cleaner configured successfully! You can now use the clean code icon in the toolbar.'
      );

      log('✅ AbapFs ABAP Cleaner setup completed successfully');

    } catch (error) {
      log(`❌ Setup wizard error: ${error}`);
      window.showErrorMessage(`Setup failed: ${error}`);
    }
  }

  private async selectExecutable(): Promise<string | undefined> {
    const options: vscode.QuickPickItem[] = [
      {
        label: '📁 Browse for executable',
        description: 'Select abap-cleanerc.exe file manually'
      },
      {
        label: '🔗 Download ABAP Cleaner',
        description: 'Open GitHub releases page to download'
      }
    ];

    const selection = await window.showQuickPick(options, {
      placeHolder: 'How would you like to set up ABAP Cleaner?',
      ignoreFocusOut: true
    });

    if (!selection) {
      return undefined;
    }

    if (selection.label.includes('Download')) {
      vscode.env.openExternal(vscode.Uri.parse('https://github.com/SAP/abap-cleaner/releases'));
      window.showInformationMessage(
        'Please download abap-cleaner, extract it, and then run the setup wizard again.'
      );
      return undefined;
    }

    // Browse for file - Force local filesystem by using file:// URI
    // Get user's home directory as default starting point
    const os = require('os');
    const homeDir = os.homedir();
    const defaultUri = vscode.Uri.file(homeDir);

    const result = await window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      defaultUri: defaultUri, // Start in user's home directory
      filters: {
        'ABAP Cleaner Executable': ['exe'],
        'All Files': ['*']
      },
      title: 'Select abap-cleanerc.exe (command line version) from your LOCAL computer',
      openLabel: 'Select ABAP Cleaner Executable'
    });

    if (result && result[0]) {
      const selectedPath = result[0].fsPath;
      
      // Validate it's a local file (not from ABAP filesystem)
      if (selectedPath.includes('adt://')) {
        window.showErrorMessage(
          'Please select the ABAP Cleaner executable from your local computer, not from the ABAP system.'
        );
        return undefined;
      }
      
      // Validate it's the right executable
      if (!selectedPath.toLowerCase().includes('cleaner')) {
        const proceed = await window.showWarningMessage(
          'The selected file does not appear to be ABAP Cleaner. Continue anyway?',
          'Yes', 'No'
        );
        if (proceed !== 'Yes') {
          return undefined;
        }
      }

      log(`📁 Selected ABAP Cleaner executable: ${selectedPath}`);
      return selectedPath;
    }

    return undefined;
  }

  private async testExecutable(executablePath: string): Promise<{ success: boolean; error?: string }> {
    try {
      
      // Test with a simple ABAP code snippet
      const testCode = 'DATA: lv_test TYPE string.\nlv_test = \'Hello World\'.';
      const tempFile = await this.createTempFile(testCode, 'test.abap');
      
      try {
        const command = `"${executablePath}" --sourcefile "${tempFile}" --overwrite`;
        
        // Retry mechanism for the first test failure issue
        let lastError: any;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            log(`🔄 Test attempt ${attempt}/3`);
            
            // Ensure file is fully written and accessible
            await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
            
            // Verify temp file exists and is readable
            if (!fs.existsSync(tempFile)) {
              throw new Error(`Temp file ${tempFile} does not exist`);
            }
            
            await execAsync(command, { 
              timeout: 15000,  // Increased timeout
              cwd: path.dirname(executablePath) 
            });
            
            log(`✅ ABAP Cleaner test successful on attempt ${attempt}`);
            return { success: true };
            
          } catch (error) {
            lastError = error;
            log(`⚠️ Test attempt ${attempt} failed: ${error}`);
            
            if (attempt < 3) {
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        
        // All attempts failed
        throw lastError;
        
      } finally {
        await this.deleteTempFile(tempFile);
      }
    } catch (error) {
      log(`❌ ABAP Cleaner test failed: ${error}`);
      return { success: false, error: `${error}` };
    }
  }

  private async selectProfile(): Promise<string | undefined> {
    const useProfile = await window.showQuickPick(
      ['Use default profile', 'Select custom profile'],
      {
        placeHolder: 'Which cleanup profile would you like to use?',
        ignoreFocusOut: true
      }
    );

    if (useProfile === 'Select custom profile') {
      // Force local filesystem by starting from home directory
      const os = require('os');
      const homeDir = os.homedir();
      const defaultUri = vscode.Uri.file(homeDir);

      const result = await window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        defaultUri: defaultUri, // Start in user's home directory
        filters: {
          'ABAP Cleaner Profile': ['cfj'],
          'All Files': ['*']
        },
        title: 'Select ABAP Cleaner profile (.cfj file) from your LOCAL computer',
        openLabel: 'Select Profile'
      });

      if (result && result[0]) {
        const selectedPath = result[0].fsPath;
        
        // Validate it's a local file (not from ABAP filesystem)
        if (selectedPath.includes('adt://')) {
          window.showErrorMessage(
            'Please select the profile file from your local computer, not from the ABAP system.'
          );
          return undefined;
        }
        
        return selectedPath;
      }
    }

    return undefined;
  }

  private async selectTargetRelease(): Promise<string | undefined> {
    const releases = [
      { label: 'Latest', description: 'Use the latest ABAP features', value: 'latest' },
      { label: 'ABAP 7.57', description: 'SAP NetWeaver 7.57', value: '7.57' },
      { label: 'ABAP 7.56', description: 'SAP NetWeaver 7.56', value: '7.56' },
      { label: 'ABAP 7.55', description: 'SAP NetWeaver 7.55', value: '7.55' },
      { label: 'ABAP 7.54', description: 'SAP NetWeaver 7.54', value: '7.54' },
      { label: 'ABAP 7.53', description: 'SAP NetWeaver 7.53', value: '7.53' },
      { label: 'ABAP 7.52', description: 'SAP NetWeaver 7.52', value: '7.52' },
      { label: 'ABAP 7.51', description: 'SAP NetWeaver 7.51', value: '7.51' },
      { label: 'ABAP 7.50', description: 'SAP NetWeaver 7.50', value: '7.50' },
      { label: 'ABAP 7.40', description: 'SAP NetWeaver 7.40', value: '7.40' },
      { label: 'ABAP 7.03', description: 'SAP NetWeaver 7.03', value: '7.03' },
      { label: 'ABAP 7.02', description: 'SAP NetWeaver 7.02', value: '7.02' }
    ];

    const selection = await window.showQuickPick(releases, {
      placeHolder: 'Select target ABAP release',
      ignoreFocusOut: true
    });

    return selection?.value;
  }

  private async selectOptions(): Promise<any> {
    const options = await window.showQuickPick(
      [
        { label: 'Show statistics after cleaning', picked: true },
        { label: 'Show applied rules (verbose)', picked: false },
        { label: 'Clean code automatically on save', picked: false }
      ],
      {
        placeHolder: 'Select additional options (use space to toggle)',
        canPickMany: true,
        ignoreFocusOut: true
      }
    );

    if (!options) {
      return undefined;
    }

    return {
      showStatistics: options.some(o => o.label.includes('statistics')),
      showAppliedRules: options.some(o => o.label.includes('applied rules')),
      cleanOnSave: options.some(o => o.label.includes('on save'))
    };
  }

  private async saveConfiguration(config: Partial<CleanerConfig>): Promise<void> {
    try {
      // Get current cleaner configuration
      const currentConfig = vscode.workspace.getConfiguration('abapfs').get('cleaner', {});
      
      // Merge with new configuration
      const updatedConfig = { ...currentConfig, ...config };
      
      // Save the entire cleaner configuration object at once
      await vscode.workspace.getConfiguration('abapfs').update('cleaner', updatedConfig, vscode.ConfigurationTarget.Global);
      
      log(`✅ Saved ABAP Cleaner configuration successfully`);
      
      // Force reload configuration after saving
      this.config = this.loadConfiguration();
      this.updateContext();
      log(`🔄 Configuration reloaded and context updated`);
    } catch (error) {
      log(`❌ Failed to save ABAP Cleaner configuration: ${error}`);
      throw error;
    }
  }

  private async buildCleanCommand(
    inputFile: string, 
    outputFile: string, 
    options?: { startLine?: number; endLine?: number }
  ): Promise<string> {
    let command = `"${this.config.executablePath}" --sourcefile "${inputFile}" --targetfile "${outputFile}" --overwrite`;

    // Add profile if configured
    if (this.config.profilePath) {
      command += ` --profile "${this.config.profilePath}"`;
    }

    // Add target release
    if (this.config.targetRelease && this.config.targetRelease !== 'latest') {
      command += ` --release ${this.config.targetRelease}`;
    }

    // Add line range if specified
    if (options?.startLine && options?.endLine && this.config.lineRange?.enabled) {
      command += ` --linerange ${options.startLine}-${options.endLine}`;
    }

    // Add statistics flag
    if (this.config.showStatistics) {
      command += ` --stats`;
    }

    // Add used rules flag
    if (this.config.showAppliedRules) {
      command += ` --usedrules`;
    }

    return command;
  }

  private async createTempFile(content: string, suffix: string): Promise<string> {
    const tempDir = require('os').tmpdir();
    const tempFile = path.join(tempDir, `abap-cleaner-${Date.now()}-${this.tempFileCounter++}-${suffix}`);
    
    // Write file with explicit sync to ensure it's flushed to disk
    await promisify(fs.writeFile)(tempFile, content, { encoding: 'utf8', flag: 'w' });
    
    // Performance optimization: Only verify file exists, not content
    // Content verification was causing unnecessary I/O overhead
    try {
      await promisify(fs.access)(tempFile, fs.constants.F_OK);
    } catch (error) {
      throw new Error(`Failed to create temp file ${tempFile}: ${error}`);
    }
    
    log(`📝 Created temp file: ${tempFile}`);
    return tempFile;
  }

  private async readTempFile(filePath: string): Promise<string> {
    return promisify(fs.readFile)(filePath, 'utf8');
  }

  private async deleteTempFile(filePath: string): Promise<void> {
    try {
      await promisify(fs.unlink)(filePath);
    } catch (error) {
      // Ignore cleanup errors
      log(`⚠️ Failed to delete temp file ${filePath}: ${error}`);
    }
  }

  private extractStatistics(output: string): string | undefined {
    // Extract statistics from cleaner output
    const lines = output.split('\n');
    const statsLine = lines.find(line => 
      line.includes('changed') || 
      line.includes('rule') || 
      line.includes('statement')
    );
    return statsLine?.trim();
  }

  private extractAppliedRules(output: string): string[] | undefined {
    // Extract applied rules from cleaner output
    const lines = output.split('\n');
    const rules: string[] = [];
    
    let inRulesSection = false;
    for (const line of lines) {
      if (line.includes('Applied rules:') || line.includes('Rules used:')) {
        inRulesSection = true;
        continue;
      }
      
      if (inRulesSection && line.trim()) {
        if (line.startsWith('  ') || line.startsWith('\t')) {
          rules.push(line.trim());
        } else {
          break;
        }
      }
    }
    
    return rules.length > 0 ? rules : undefined;
  }

  /**
   * Get configuration for auto-clean on save
   */
  public shouldCleanOnSave(): boolean {
    return this.config.cleanOnSave && this.isAvailable();
  }
}
