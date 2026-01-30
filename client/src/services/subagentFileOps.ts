/**
 * Subagent File Operations
 * 
 * Handles all file system operations for subagent configuration:
 * - Loading templates
 * - Writing/updating agent files
 * - Disabling/restoring agent folders
 * - Validating agent files
 */

import * as vscode from 'vscode';
import * as path from 'path';
import {
    AgentMeta,
    AGENT_REGISTRY,
    EnableResult,
    DisableResult,
    getSubagentSettings,
    getWorkspaceFolder,
    getExtensionId,
    buildFullToolName
} from './subagentRegistry';

// ============================================================================
// TEMPLATE OPERATIONS
// ============================================================================

/**
 * Get the templates directory path
 */
function getTemplatesDir(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'client', 'media', 'subagent-templates');
}

/**
 * Get the dist templates directory path (for webpack bundled version)
 */
function getDistTemplatesDir(context: vscode.ExtensionContext): string {
    return path.join(context.extensionPath, 'client', 'dist', 'media', 'subagent-templates');
}

/**
 * Load template content from file
 */
export async function loadTemplate(context: vscode.ExtensionContext, templateFile: string): Promise<string> {
    const distPath = path.join(getDistTemplatesDir(context), templateFile);
    const devPath = path.join(getTemplatesDir(context), templateFile);
    
    try {
        const distUri = vscode.Uri.file(distPath);
        const content = await vscode.workspace.fs.readFile(distUri);
        return Buffer.from(content).toString('utf8');
    } catch {
        try {
            const devUri = vscode.Uri.file(devPath);
            const content = await vscode.workspace.fs.readFile(devUri);
            return Buffer.from(content).toString('utf8');
        } catch (error) {
            throw new Error(`Could not load template ${templateFile}: ${error}`);
        }
    }
}

/**
 * Process template content - replace placeholders with actual values
 */
export function processTemplate(templateContent: string, model: string, tools: string[] | null, extensionId: string): string {
    let content = templateContent;
    
    // Replace model placeholder
    if (model) {
        content = content.replace(/\{\{MODEL\}\}/g, model);
    } else {
        content = content.replace(/^model:\s*['"]?\{\{MODEL\}\}['"]?\n?/m, '');
    }
    
    // Replace tools placeholder if present
    if (tools) {
        const fullToolNames = tools.map(t => `'${buildFullToolName(extensionId, t)}'`);
        content = content.replace(/\{\{TOOLS\}\}/g, fullToolNames.join(', '));
    } else {
        content = content.replace(/^tools:\s*\[\{\{TOOLS\}\}\]\n?/m, '');
    }
    
    return content;
}

// ============================================================================
// FILE OPERATIONS
// ============================================================================

/**
 * Refresh the file explorer to show folder changes
 */
export async function refreshExplorer(): Promise<void> {
    try {
        await new Promise(resolve => setTimeout(resolve, 500));
        await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
    } catch {
        // Command might not be available
    }
}

/**
 * Close any open editors for agent files to prevent ghost references
 */
export async function closeAgentEditors(workspaceUri: vscode.Uri): Promise<void> {
    for (const tabGroup of vscode.window.tabGroups.all) {
        for (const tab of tabGroup.tabs) {
            if (tab.input instanceof vscode.TabInputText) {
                const uri = tab.input.uri;
                const filePath = uri.fsPath;
                if (filePath.includes('.github\\agents\\') || filePath.includes('.github/agents/') ||
                    filePath.includes('.github\\agents_disabled\\') || filePath.includes('.github/agents_disabled/')) {
                    try {
                        await vscode.window.tabGroups.close(tab);
                    } catch {
                        // Tab might already be closed
                    }
                }
            }
        }
    }
}

/**
 * Write or update agent file, preserving user customizations (like tools)
 * Only updates the model line, leaves everything else intact
 */
export async function writeAgentFile(
    context: vscode.ExtensionContext,
    workspaceUri: vscode.Uri,
    agent: AgentMeta,
    model: string,
    extensionId: string
): Promise<{ created: boolean; updated: boolean; path: string }> {
    const agentsDir = vscode.Uri.joinPath(workspaceUri, '.github', 'agents');
    const filePath = vscode.Uri.joinPath(agentsDir, `${agent.id}.agent.md`);
    
    try {
        await vscode.workspace.fs.createDirectory(agentsDir);
    } catch {
        // Directory might already exist
    }
    
    let created = false;
    let updated = false;
    
    try {
        const existingContent = await vscode.workspace.fs.readFile(filePath);
        const existingText = Buffer.from(existingContent).toString('utf8');
        
        // Only update model line (preserve user's tool customizations)
        let newContent = existingText;
        const modelRegex = /^model:\s*['"]?[^'"}\n]+['"]?$/m;
        if (modelRegex.test(newContent)) {
            newContent = newContent.replace(modelRegex, `model: '${model}'`);
        }
        
        if (newContent !== existingText) {
            await vscode.workspace.fs.writeFile(filePath, Buffer.from(newContent, 'utf8'));
            updated = true;
        }
    } catch {
        // File doesn't exist - create from template
        const templateContent = await loadTemplate(context, agent.templateFile);
        const content = processTemplate(templateContent, model, agent.tools, extensionId);
        await vscode.workspace.fs.writeFile(filePath, Buffer.from(content, 'utf8'));
        created = true;
    }
    
    return { created, updated, path: filePath.fsPath };
}

/**
 * Disable agent files by renaming agents folder to agents_disabled
 */
export async function disableAgentFiles(workspaceUri: vscode.Uri): Promise<boolean> {
    const agentsDir = vscode.Uri.joinPath(workspaceUri, '.github', 'agents');
    const disabledDir = vscode.Uri.joinPath(workspaceUri, '.github', 'agents_disabled');
    
    try {
        await vscode.workspace.fs.stat(agentsDir);
        await closeAgentEditors(workspaceUri);
        
        try {
            await vscode.workspace.fs.delete(disabledDir, { recursive: true });
        } catch {
            // Doesn't exist, that's fine
        }
        
        await vscode.workspace.fs.rename(agentsDir, disabledDir);
        await refreshExplorer();
        return true;
    } catch {
        return false;
    }
}

/**
 * Check if disabled agents folder exists
 */
export async function hasDisabledAgentFiles(workspaceUri: vscode.Uri): Promise<boolean> {
    const disabledDir = vscode.Uri.joinPath(workspaceUri, '.github', 'agents_disabled');
    try {
        await vscode.workspace.fs.stat(disabledDir);
        return true;
    } catch {
        return false;
    }
}

/**
 * Restore agent files from agents_disabled folder and update model names
 */
export async function restoreAgentFiles(
    context: vscode.ExtensionContext,
    workspaceUri: vscode.Uri,
    settings: { models: Record<string, string> }
): Promise<{ restored: number; created: number }> {
    const agentsDir = vscode.Uri.joinPath(workspaceUri, '.github', 'agents');
    const disabledDir = vscode.Uri.joinPath(workspaceUri, '.github', 'agents_disabled');
    const extensionId = getExtensionId(context);
    
    let restored = 0;
    let created = 0;
    
    try {
        await vscode.workspace.fs.stat(disabledDir);
        await vscode.workspace.fs.rename(disabledDir, agentsDir);
        restored = AGENT_REGISTRY.length;
        
        for (const agent of AGENT_REGISTRY) {
            const model = settings.models[agent.id];
            if (model) {
                try {
                    await writeAgentFile(context, workspaceUri, agent, model, extensionId);
                } catch {
                    // File might be corrupted
                }
            }
        }
    } catch {
        for (const agent of AGENT_REGISTRY) {
            const model = settings.models[agent.id];
            if (model) {
                try {
                    const result = await writeAgentFile(context, workspaceUri, agent, model, extensionId);
                    if (result.created) created++;
                } catch {
                    // Template might not be available
                }
            }
        }
    }
    
    await refreshExplorer();
    return { restored, created };
}

/**
 * Validate agent .md files for errors (e.g., unknown model)
 */
export async function validateAgentFiles(workspaceUri: vscode.Uri): Promise<Array<{ agentId: string; errors: string[] }>> {
    const agentsDir = vscode.Uri.joinPath(workspaceUri, '.github', 'agents');
    const fileErrors: Array<{ agentId: string; errors: string[] }> = [];
    
    for (const agent of AGENT_REGISTRY) {
        const filePath = vscode.Uri.joinPath(agentsDir, `${agent.id}.agent.md`);
        try {
            await vscode.workspace.fs.stat(filePath);
            await vscode.workspace.openTextDocument(filePath);
        } catch {
            // File doesn't exist
        }
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    for (const agent of AGENT_REGISTRY) {
        const filePath = vscode.Uri.joinPath(agentsDir, `${agent.id}.agent.md`);
        const diagnostics = vscode.languages.getDiagnostics(filePath);
        
        if (diagnostics.length > 0) {
            const significantIssues = diagnostics.filter(
                d => d.severity === vscode.DiagnosticSeverity.Error || 
                     d.severity === vscode.DiagnosticSeverity.Warning
            );
            
            if (significantIssues.length > 0) {
                const errors = significantIssues.map(d => 
                    `Line ${d.range.start.line + 1}: ${d.message}`
                );
                fileErrors.push({ agentId: agent.id, errors });
            }
        }
    }
    
    return fileErrors;
}

// ============================================================================
// CORE ENABLE/DISABLE LOGIC
// ============================================================================

/**
 * Core logic for enabling subagents
 */
export async function enableSubagentsCore(context: vscode.ExtensionContext): Promise<EnableResult> {
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
        return { success: false, error: 'no_workspace' };
    }
    
    const settings = getSubagentSettings();
    
    const agentsWithoutModels: string[] = [];
    for (const agent of AGENT_REGISTRY) {
        if (!settings.models[agent.id]) {
            agentsWithoutModels.push(agent.id);
        }
    }
    
    if (agentsWithoutModels.length > 0) {
        return { success: false, error: 'missing_models', missingModels: agentsWithoutModels };
    }
    
    const config = vscode.workspace.getConfiguration('abapfs.subagents');
    await config.update('enabled', true, vscode.ConfigurationTarget.Workspace);
    
    const hasDisabled = await hasDisabledAgentFiles(workspaceFolder);
    const restoreResult = await restoreAgentFiles(context, workspaceFolder, settings);
    
    let fileStatus: string;
    if (hasDisabled && restoreResult.restored > 0) {
        fileStatus = `Restored ${restoreResult.restored} agent files from agents_disabled folder (with updated model configurations).`;
    } else {
        fileStatus = `Created ${restoreResult.created} new agent files.`;
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    const fileErrors = await validateAgentFiles(workspaceFolder);
    
    if (fileErrors.length > 0) {
        await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
        await disableAgentFiles(workspaceFolder);
        return { success: false, error: 'validation_failed', fileErrors };
    }
    
    // Check if customAgentInSubagent is enabled
    const chatConfig = vscode.workspace.getConfiguration('chat');
    const customAgentEnabled = chatConfig.get<boolean>('customAgentInSubagent.enabled', false);
    
    if (!customAgentEnabled) {
        const action = await vscode.window.showWarningMessage(
            'CRITICAL:Subagents enabled, but "chat.customAgentInSubagent.enabled" is not set. ' +
            'This setting is required for Copilot to use your custom agents when delegating tasks.',
            'Enable Setting',
            'Dismiss'
        );
        
        if (action === 'Enable Setting') {
            await chatConfig.update('customAgentInSubagent.enabled', true, vscode.ConfigurationTarget.Global);
            vscode.window.showInformationMessage('Setting enabled! Restart VS Code and then custom agents will be used for task delegation.');
        }
    }
    
    return { success: true, fileStatus };
}

/**
 * Core logic for disabling subagents
 */
export async function disableSubagentsCore(): Promise<DisableResult> {
    const workspaceFolder = getWorkspaceFolder();
    
    const config = vscode.workspace.getConfiguration('abapfs.subagents');
    await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
    
    let preserved = false;
    if (workspaceFolder) {
        preserved = await disableAgentFiles(workspaceFolder);
    }
    
    return { success: true, preserved };
}
