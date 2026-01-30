/**
 * Subagent Configuration Tool
 * 
 * Allows Copilot to configure AI subagents through natural conversation.
 * Users can enable/disable subagents, set models, and view current configuration.
 * 
 * This is the main tool class that uses:
 * - subagentRegistry.ts for agent metadata and types
 * - subagentFileOps.ts for file operations
 */

import * as vscode from 'vscode';
import {
    AGENT_REGISTRY,
    getSubagentSettings,
    getWorkspaceFolder,
    getAvailableModels,
    getExtensionId,
    validateModelConfiguration,
    buildFullToolName
} from '../subagentRegistry';
import {
    enableSubagentsCore,
    disableSubagentsCore,
    disableAgentFiles,
    writeAgentFile,
    refreshExplorer
} from '../subagentFileOps';

// ============================================================================
// TOOL IMPLEMENTATION
// ============================================================================

interface SubagentConfigInput {
    action: 'enable' | 'disable' | 'get_status' | 'list_models' | 'list_agents' | 'list_tools' | 'configure' | 'validate' | 'regenerate';
    configurations?: Array<{ agentId: string; model: string }>;
}

class SubagentConfigTool implements vscode.LanguageModelTool<SubagentConfigInput> {
    private context: vscode.ExtensionContext;
    
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }
    
    async invoke(
        options: vscode.LanguageModelToolInvocationOptions<SubagentConfigInput>,
        _token: vscode.CancellationToken
    ): Promise<vscode.LanguageModelToolResult> {
        const { action, configurations } = options.input;
        
        switch (action) {
            case 'enable':
                return this.enableSubagents();
            
            case 'disable':
                return this.disableSubagents();
            
            case 'get_status':
                return this.getStatus();
            
            case 'list_models':
                return this.listModels();
            
            case 'list_agents':
                return this.listAgents();
            
            case 'list_tools':
                return this.listTools();
            
            case 'configure':
                return this.configureModels(configurations || []);
            
            case 'validate':
                return this.validateConfiguration();
            
            case 'regenerate':
                return this.regenerateAgentFiles();
            
            default:
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`Unknown action: ${action}. Valid actions: enable, disable, get_status, list_models, list_agents, list_tools, configure, validate, regenerate`)
                ]);
        }
    }
    
    private async enableSubagents(): Promise<vscode.LanguageModelToolResult> {
        const result = await enableSubagentsCore(this.context);
        
        if (!result.success) {
            if (result.error === 'no_workspace') {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart('Error: No workspace folder found. Open a folder first.')
                ]);
            }
            
            if (result.error === 'missing_models') {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`❌ CANNOT ENABLE SUBAGENTS - Missing Model Configurations

All subagents MUST have a model assigned before enabling. The following ${result.missingModels!.length} agent(s) have no model configured:

${result.missingModels!.map(id => `  • ${id}`).join('\n')}

To fix this:
1. Use "list_models" action to see available models (use model NAMES like "Claude Sonnet 4", "GPT-4o")
2. Use "configure" action to assign models to ALL agents
3. Then try "enable" again

Example configuration:
{
  "action": "configure",
  "configurations": [
    {"agentId": "abap-orchestrator", "model": "Claude Sonnet 4"},
    {"agentId": "abap-code-reviewer", "model": "Claude Sonnet 4"},
    {"agentId": "abap-discoverer", "model": "Claude Haiku 4.5"},
    ... (all 13 agents must be configured)
  ]
}`)
                ]);
            }
            
            if (result.error === 'validation_failed') {
                let errorDetails = '';
                for (const fileError of result.fileErrors!) {
                    errorDetails += `\n${fileError.agentId}:\n`;
                    for (const error of fileError.errors) {
                        errorDetails += `  • ${error}\n`;
                    }
                }
                
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(`❌ SUBAGENTS AUTO-DISABLED - Invalid Agent Files

${result.fileErrors!.length} agent file(s) have validation errors (likely invalid model names):
${errorDetails}

PROBABLE CAUSE: The model names you configured are not actually valid for GitHub Copilot agents, even though they appeared in the available models list.

TO FIX:
1. Use "list_models" to see available models
2. Choose DIFFERENT models (avoid ones that show errors)
3. Use "configure" to set new models for the affected agents: ${result.fileErrors!.map(e => e.agentId).join(', ')}
4. Try "enable" again

Common issue: "GPT-4o mini" appears in list but isn't valid - try "GPT-4o" or "Claude Haiku 4.5" instead.`)
                ]);
            }
        }
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Subagents ENABLED for this workspace.

${result.fileStatus}

The agents are now available for use. They will help optimize your ABAP development by delegating specialized tasks to cheaper/faster models.

Tier structure:
- Tier 1 (Fast/Cheap): discoverer, reader, creator, visualizer, documenter
- Tier 2 (Analysis): usage-analyzer, quality-checker, historian, debugger, troubleshooter, data-analyst
- Tier 3 (Premium): orchestrator, code-reviewer

Use "list_agents" action to see details, or "configure" to change models.`)
        ]);
    }
    
    private async disableSubagents(): Promise<vscode.LanguageModelToolResult> {
        const result = await disableSubagentsCore();
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`Subagents DISABLED.

${result.preserved ? 'Agent files preserved in agents_disabled folder (will be restored when you re-enable).' : 'No agent files to preserve.'}

All ABAP tasks will now be handled by the main model directly.`)
        ]);
    }
    
    private async getStatus(): Promise<vscode.LanguageModelToolResult> {
        const settings = getSubagentSettings();
        const workspaceFolder = getWorkspaceFolder();
        const validation = await validateModelConfiguration();
        
        const unavailableModels = validation.filter(v => v.configuredModel && !v.available);
        const unconfiguredAgents = AGENT_REGISTRY.filter(a => !settings.models[a.id]);
        
        let status = `SUBAGENT STATUS
===============

Enabled: ${settings.enabled ? 'YES ✓' : 'NO ✗'}
Workspace: ${workspaceFolder?.fsPath || 'None'}
`;

        if (unconfiguredAgents.length > 0) {
            status += `
❌ ${unconfiguredAgents.length} agent(s) need model configuration before subagents can be enabled.
Use "configure" action to assign models to all agents.
`;
        } else {
            status += `
✓ All agents have models configured.
`;
        }

        status += `
AGENT CONFIGURATIONS:
`;
        
        for (const agent of AGENT_REGISTRY) {
            const configuredModel = settings.models[agent.id];
            const validationResult = validation.find(v => v.agentId === agent.id);
            const available = validationResult?.available ?? true;
            
            const modelDisplay = configuredModel 
                ? `${configuredModel}${available ? '' : ' ⚠️ NOT AVAILABLE'}`
                : '❌ NOT CONFIGURED (required)';
            
            status += `\n${agent.id}:
  Model: ${modelDisplay}
  Tier: ${agent.tier}
  Description: ${agent.description}`;
        }
        
        if (unavailableModels.length > 0) {
            status += `\n\n⚠️ WARNING: ${unavailableModels.length} agent(s) have models that are not currently available.
Use "configure" action to set different models.`;
        }
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(status)
        ]);
    }
    
    private async listModels(): Promise<vscode.LanguageModelToolResult> {
        const models = await getAvailableModels();
        
        if (models.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('No language models available. Make sure GitHub Copilot is installed and active.')
            ]);
        }
        
        let result = `AVAILABLE LANGUAGE MODELS
========================

IMPORTANT: Use the model NAME (e.g., "Claude Sonnet 4") when configuring agents.

`;
        
        const byVendor = new Map<string, typeof models>();
        for (const model of models) {
            const existing = byVendor.get(model.vendor) || [];
            existing.push(model);
            byVendor.set(model.vendor, existing);
        }
        
        for (const [vendor, vendorModels] of byVendor) {
            result += `${vendor}:\n`;
            for (const model of vendorModels) {
                result += `  - ${model.name}\n    Family: ${model.family}\n`;
            }
            result += '\n';
        }
        
        result += `\nTo use a model for an agent, use the "configure" action with the model NAME (e.g., "Claude Sonnet 4", "GPT-4o").`;
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(result)
        ]);
    }
    
    private async listAgents(): Promise<vscode.LanguageModelToolResult> {
        const settings = getSubagentSettings();
        const unconfiguredCount = AGENT_REGISTRY.filter(a => !settings.models[a.id]).length;
        
        let result = `AVAILABLE SUBAGENTS
==================
`;

        if (unconfiguredCount > 0) {
            result += `
❌ ${unconfiguredCount} agent(s) need model configuration.
All agents MUST have a model assigned before subagents can be enabled.

`;
        } else {
            result += `
✓ All agents configured and ready.

`;
        }
        
        const tiers = [
            { tier: 3, name: 'Tier 3 - Premium (Complex Reasoning)', color: '🔴' },
            { tier: 2, name: 'Tier 2 - Analysis & Understanding', color: '🟡' },
            { tier: 1, name: 'Tier 1 - Fast & Cheap', color: '🟢' }
        ];
        
        for (const tierInfo of tiers) {
            const tierAgents = AGENT_REGISTRY.filter(a => a.tier === tierInfo.tier);
            result += `${tierInfo.color} ${tierInfo.name}\n${'─'.repeat(50)}\n`;
            
            for (const agent of tierAgents) {
                const configuredModel = settings.models[agent.id];
                const modelDisplay = configuredModel ? configuredModel : '❌ NOT CONFIGURED';
                result += `
${agent.id}
  ${agent.description}
  Model: ${modelDisplay}
  Tools: ${agent.tools ? agent.tools.length + ' specific tools' : 'All tools'}
`;
            }
            result += '\n';
        }
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(result)
        ]);
    }
    
    private async listTools(): Promise<vscode.LanguageModelToolResult> {
        const extensionId = getExtensionId(this.context);
        
        let result = `AVAILABLE TOOLS FOR SUBAGENTS
=============================

These are the tool reference names you can use in agent .md files.
Tools are defined with the full extension prefix: ${extensionId}/<tool-name>

DEFAULT TOOL ASSIGNMENTS:
`;

        for (const agent of AGENT_REGISTRY) {
            if (agent.tools) {
                result += `\n${agent.id}:\n`;
                for (const tool of agent.tools) {
                    result += `  - ${buildFullToolName(extensionId, tool)}\n`;
                }
            } else {
                result += `\n${agent.id}: (all tools - no restriction)\n`;
            }
        }

        result += `
CUSTOMIZING TOOLS:
To customize tools for an agent, edit the agent's .md file directly in:
  .github/agents/<agent-id>.agent.md

Change the 'tools:' line to include only the tools you want that agent to use.
Example:
  tools: ['${extensionId}/abap-search', '${extensionId}/abap-info']

ALL AVAILABLE TOOL NAMES:
`;

        // Collect all unique tool names from registry
        const allTools = new Set<string>();
        for (const agent of AGENT_REGISTRY) {
            if (agent.tools) {
                for (const tool of agent.tools) {
                    allTools.add(tool);
                }
            }
        }

        const sortedTools = Array.from(allTools).sort();
        for (const tool of sortedTools) {
            result += `  - ${tool} → ${buildFullToolName(extensionId, tool)}\n`;
        }

        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(result)
        ]);
    }
    
    private async configureModels(configurations: Array<{ agentId: string; model: string }>): Promise<vscode.LanguageModelToolResult> {
        if (!configurations || configurations.length === 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`No configurations provided. 

Usage: Provide an array of {agentId, model} objects.

Available agent IDs:
${AGENT_REGISTRY.map(a => `- ${a.id}`).join('\n')}

Use "list_models" action to see available models.`)
            ]);
        }
        
        const settings = getSubagentSettings();
        const currentModels = { ...settings.models };
        const availableModels = await getAvailableModels();
        const availableNames = new Set(availableModels.map(m => m.name));
        const agentIds = new Set(AGENT_REGISTRY.map(a => a.id));
        
        const results: string[] = [];
        const warnings: string[] = [];
        
        for (const config of configurations) {
            if (!agentIds.has(config.agentId)) {
                warnings.push(`Unknown agent: ${config.agentId}`);
                continue;
            }
            
            if (!availableNames.has(config.model)) {
                warnings.push(`Model "${config.model}" not available for ${config.agentId} - setting anyway`);
            }
            
            currentModels[config.agentId] = config.model;
            results.push(`✓ ${config.agentId} → ${config.model}`);
        }
        
        const vsConfig = vscode.workspace.getConfiguration('abapfs.subagents');
        await vsConfig.update('models', currentModels, vscode.ConfigurationTarget.Workspace);
        
        const workspaceFolder = getWorkspaceFolder();
        if (settings.enabled && workspaceFolder) {
            const extensionId = getExtensionId(this.context);
            for (const config of configurations) {
                const agent = AGENT_REGISTRY.find(a => a.id === config.agentId);
                if (agent) {
                    await writeAgentFile(this.context, workspaceFolder, agent, config.model, extensionId);
                }
            }
        }
        
        let response = `MODEL CONFIGURATION UPDATED

${results.join('\n')}`;
        
        if (warnings.length > 0) {
            response += `\n\n⚠️ WARNINGS:\n${warnings.join('\n')}`;
        }
        
        if (settings.enabled && workspaceFolder) {
            response += '\n\nAgent files have been updated.';
        } else if (!settings.enabled) {
            response += '\n\nNote: Subagents are currently disabled. Use "enable" action to activate.';
        }
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(response)
        ]);
    }
    
    private async validateConfiguration(): Promise<vscode.LanguageModelToolResult> {
        const validation = await validateModelConfiguration();
        const settings = getSubagentSettings();
        
        const unavailable = validation.filter(v => v.configuredModel && !v.available);
        const unconfigured = validation.filter(v => !v.configuredModel);
        
        if (unconfigured.length > 0) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(`❌ INCOMPLETE CONFIGURATION

${unconfigured.length} agent(s) have no model assigned:

${unconfigured.map(u => `  • ${u.agentId}`).join('\n')}

⚠️ Subagents CANNOT be enabled until ALL agents have models configured.

Use "configure" action to assign models to all agents, then "enable".
Use "list_models" to see available model names.`)
            ]);
        }
        
        if (unavailable.length === 0) {
            const readyMessage = settings.enabled 
                ? `✓ All ${AGENT_REGISTRY.length} agents are configured and ready to use.`
                : `✓ All ${AGENT_REGISTRY.length} agents are configured. Use "enable" action to activate subagents.`;
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(readyMessage)
            ]);
        }
        
        let result = `⚠️ MODEL AVAILABILITY ISSUES

${unavailable.length} agent(s) have unavailable models:

`;
        
        for (const item of unavailable) {
            result += `${item.agentId}:
  Configured: ${item.configuredModel} (NOT AVAILABLE)
  
`;
        }
        
        result += `\nUse "configure" action to set different models (use model NAMES like "Claude Sonnet 4").
Use "list_models" action to see available model names.`;
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(result)
        ]);
    }
    
    private async regenerateAgentFiles(): Promise<vscode.LanguageModelToolResult> {
        const settings = getSubagentSettings();
        
        if (!settings.enabled) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Subagents are not enabled. Use "enable" action first.')
            ]);
        }
        
        const workspaceFolder = getWorkspaceFolder();
        if (!workspaceFolder) {
            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart('Error: No workspace folder found.')
            ]);
        }
        
        const extensionId = getExtensionId(this.context);
        const results: string[] = [];
        
        for (const agent of AGENT_REGISTRY) {
            const model = settings.models[agent.id] || '';
            try {
                const result = await writeAgentFile(this.context, workspaceFolder, agent, model, extensionId);
                if (result.created) {
                    results.push(`✓ Created ${agent.id}.agent.md`);
                } else if (result.updated) {
                    results.push(`✓ Updated ${agent.id}.agent.md`);
                } else {
                    results.push(`- ${agent.id}.agent.md (no changes needed)`);
                }
            } catch (error) {
                results.push(`✗ Failed ${agent.id}: ${error}`);
            }
        }
        
        return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(`AGENT FILES REGENERATED

${results.join('\n')}

Files are in: ${workspaceFolder.fsPath}/.github/agents/`)
        ]);
    }
}

// ============================================================================
// REGISTRATION & EVENT HANDLERS
// ============================================================================

let isHandlingConfigChange = false;

export function registerSubagentConfigTool(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.lm.registerTool('manage_subagents', new SubagentConfigTool(context))
    );
    
    context.subscriptions.push(
        vscode.lm.onDidChangeChatModels(async () => {
            await handleModelChange(context);
        })
    );
    
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
            if (isHandlingConfigChange) {
                return;
            }
            
            if (e.affectsConfiguration('abapfs.subagents.enabled')) {
                isHandlingConfigChange = true;
                try {
                    await handleManualSettingsChange(context);
                } finally {
                    isHandlingConfigChange = false;
                }
            } else if (e.affectsConfiguration('abapfs.subagents.models')) {
                await handleManualModelChange(context);
            }
        })
    );
}

async function handleManualModelChange(context: vscode.ExtensionContext): Promise<void> {
    const settings = getSubagentSettings();
    
    if (!settings.enabled) {
        return;
    }
    
    const workspaceFolder = getWorkspaceFolder();
    if (!workspaceFolder) {
        return;
    }
    
    const extensionId = getExtensionId(context);
    let updated = 0;
    
    for (const agent of AGENT_REGISTRY) {
        const model = settings.models[agent.id];
        if (model) {
            try {
                const result = await writeAgentFile(context, workspaceFolder, agent, model, extensionId);
                if (result.updated) updated++;
            } catch {
                // Ignore errors
            }
        }
    }
    
    if (updated > 0) {
        await refreshExplorer();
        vscode.window.showInformationMessage(`Updated ${updated} agent file(s) with new model configurations.`);
    }
}

async function handleManualSettingsChange(context: vscode.ExtensionContext): Promise<void> {
    const settings = getSubagentSettings();
    
    if (settings.enabled) {
        const result = await enableSubagentsCore(context);
        
        if (!result.success) {
            if (result.error === 'no_workspace') {
                vscode.window.showErrorMessage('Cannot enable subagents: No workspace folder found.');
            } else if (result.error === 'missing_models') {
                vscode.window.showErrorMessage(
                    `Cannot enable subagents: ${result.missingModels!.length} agent(s) have no model configured. ` +
                    `Ask Copilot to "configure subagent models" first.`
                );
            } else if (result.error === 'validation_failed') {
                const agents = result.fileErrors!.map(e => e.agentId).join(', ');
                vscode.window.showErrorMessage(
                    `Subagents auto-disabled: Invalid model names detected for: ${agents}. ` +
                    `Ask Copilot to "configure subagent models" with valid models.`
                );
            }
        } else {
            vscode.window.showInformationMessage(`Subagents enabled. ${result.fileStatus}`);
        }
    } else {
        const result = await disableSubagentsCore();
        if (result.preserved) {
            vscode.window.showInformationMessage('Subagents disabled. Agent files preserved in agents_disabled folder.');
        }
    }
}

async function handleModelChange(context: vscode.ExtensionContext): Promise<void> {
    const settings = getSubagentSettings();
    
    if (!settings.enabled) {
        return;
    }
    
    const validation = await validateModelConfiguration();
    const unavailable = validation.filter(v => !v.available);
    
    if (unavailable.length > 0) {
        const config = vscode.workspace.getConfiguration('abapfs.subagents');
        await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
        
        const workspaceFolder = getWorkspaceFolder();
        if (workspaceFolder) {
            await disableAgentFiles(workspaceFolder);
        }
        
        const invalidModels = unavailable.filter(u => u.configuredModel);
        const modelNames = invalidModels.map(u => u.configuredModel).join(', ');
        
        vscode.window.showWarningMessage(
            `Subagents AUTO-DISABLED: Model(s) no longer available: ${modelNames}. Agent files preserved in agents_disabled folder.`,
            'OK'
        );
    }
}

// ============================================================================
// STARTUP VALIDATION
// ============================================================================

export async function validateSubagentsOnStartup(context: vscode.ExtensionContext): Promise<void> {
    const settings = getSubagentSettings();
    
    if (!settings.enabled) {
        return;
    }
    
    const validation = await validateModelConfiguration();
    const unavailable = validation.filter(v => !v.available);
    
    if (unavailable.length > 0) {
        const config = vscode.workspace.getConfiguration('abapfs.subagents');
        await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
        
        const workspaceFolder = getWorkspaceFolder();
        if (workspaceFolder) {
            await disableAgentFiles(workspaceFolder);
        }
        
        const missing = unavailable.filter(u => !u.configuredModel);
        const invalidModels = unavailable.filter(u => u.configuredModel);
        
        let details = '';
        if (missing.length > 0) {
            details += `Missing model configuration:\n${missing.map(u => `  • ${u.agentId}`).join('\n')}\n\n`;
        }
        if (invalidModels.length > 0) {
            details += `Unavailable models:\n${invalidModels.map(u => `  • ${u.agentId}: ${u.configuredModel}`).join('\n')}\n\n`;
        }
        
        const message = `Subagents have been DISABLED: ${unavailable.length} agent(s) have invalid/missing models.`;
        
        const action = await vscode.window.showWarningMessage(
            message,
            'View Details',
            'Dismiss'
        );
        
        if (action === 'View Details') {
            vscode.window.showInformationMessage(
                `${details}To re-enable subagents:\n1. Ask Copilot to "list models" to see available models\n2. Ask Copilot to "configure subagent models"\n3. Ask Copilot to "enable subagents"`
            );
        }
        return;
    }
    
    const workspaceFolder = getWorkspaceFolder();
    if (workspaceFolder) {
        const extensionId = getExtensionId(context);
        for (const agent of AGENT_REGISTRY) {
            const model = settings.models[agent.id];
            if (model) {
                try {
                    await writeAgentFile(context, workspaceFolder, agent, model, extensionId);
                } catch {
                    // Silently fail on startup
                }
            }
        }
    }
}
