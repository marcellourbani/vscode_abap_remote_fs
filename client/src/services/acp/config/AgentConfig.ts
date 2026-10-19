import * as vscode from 'vscode';
import { unconfiguredPresets } from './agentPresets';

/** ACP agent process configuration. */
export interface AgentConfigEntry {
  /** Executable to run. */
  command: string;
  /** Command-line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Display name */
  displayName?: string;
}

export const ACP_CONFIG_SECTION = 'abapfs.acp';

/**
 * Read agent configurations from VS Code settings.
 * Returns a map of agent name → config, skipping entries without a command.
 */
export function getAgentConfigs(): Record<string, AgentConfigEntry> {
  const config = vscode.workspace.getConfiguration(ACP_CONFIG_SECTION);
  const configuredAgents = config.get<Record<string, AgentConfigEntry>>('agents', {});
  return Object.fromEntries(
    Object.entries(configuredAgents).filter(([, entry]) => !!entry?.command),
  );
}

/**
 * Get the list of agent names available.
 */
export function getAgentNames(): string[] {
  return Object.keys(getAgentConfigs());
}

/**
 * Get a specific agent config by name.
 */
export function getAgentConfig(name: string): AgentConfigEntry | undefined {
  return getAgentConfigs()[name];
}

/** Agents are personal tooling, so they are stored in user settings unless defined per workspace */
async function saveAgentConfigs(agents: Record<string, AgentConfigEntry>): Promise<void> {
  const config = vscode.workspace.getConfiguration(ACP_CONFIG_SECTION);
  const inspected = config.inspect<Record<string, AgentConfigEntry>>('agents');
  const target = inspected?.workspaceValue !== undefined
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update('agents', agents, target);
}

/** Split a command line into executable and arguments, honouring single and double quotes */
export function parseCommandLine(commandLine: string): string[] {
  const parts = commandLine.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  return parts.map(p => p.replace(/^(["'])(.*)\1$/, '$2'));
}

function parseEnv(text: string): Record<string, string> {
  const pairs = text.split(/[;\n]/).map(p => p.trim()).filter(Boolean);
  return Object.fromEntries(pairs.map(p => {
    const index = p.indexOf('=');
    return index < 0 ? [p, ''] : [p.slice(0, index).trim(), p.slice(index + 1)];
  }));
}

const CUSTOM_AGENT = '$(edit) Custom agent...';

/**
 * Offer the built-in presets plus a custom entry, and store the chosen agent.
 * Returns the agent name, or undefined when the user cancelled.
 */
export async function addAgentInteractive(): Promise<string | undefined> {
  const presets = unconfiguredPresets(Object.keys(readRawAgents()));
  if (!presets.length) { return addCustomAgent(); }
  const picked = await vscode.window.showQuickPick(
    [
      ...presets.map(([label, entry]) => ({ label, entry, detail: [entry.command, ...entry.args ?? []].join(' ') })),
      { label: CUSTOM_AGENT, entry: undefined, detail: 'Enter the command that starts your agent in ACP mode' },
    ],
    { title: 'Add ACP Agent', placeHolder: 'Built-in agents start through npx and are downloaded from npm on first use' },
  );
  if (!picked) { return; }
  if (!picked.entry) { return addCustomAgent(); }
  await saveAgentConfigs({ ...readRawAgents(), [picked.label]: picked.entry });
  return picked.label;
}

/** Ask for name, command line and environment of a new ACP agent and store it */
async function addCustomAgent(): Promise<string | undefined> {
  const existing = getAgentConfigs();
  const name = await vscode.window.showInputBox({
    title: 'Add ACP Agent (1/3)',
    prompt: 'Display name of the agent',
    placeHolder: 'e.g. Claude Code',
    ignoreFocusOut: true,
    validateInput: v => !v.trim() ? 'Name is required'
      : existing[v.trim()] ? 'An agent with this name already exists' : undefined,
  });
  if (!name) { return; }

  const commandLine = await vscode.window.showInputBox({
    title: 'Add ACP Agent (2/3)',
    prompt: 'Command line that starts the agent in ACP mode',
    placeHolder: 'e.g. npx <acp-adapter-package>   or   gemini --experimental-acp',
    ignoreFocusOut: true,
    validateInput: v => v.trim() ? undefined : 'Command is required',
  });
  if (!commandLine) { return; }

  const envText = await vscode.window.showInputBox({
    title: 'Add ACP Agent (3/3)',
    prompt: 'Optional environment variables, as NAME=value separated by ;',
    placeHolder: 'Leave empty for none',
    ignoreFocusOut: true,
  });
  if (envText === undefined) { return; }

  const [command, ...args] = parseCommandLine(commandLine.trim());
  const entry: AgentConfigEntry = { command, args, env: parseEnv(envText) };
  await saveAgentConfigs({ ...readRawAgents(), [name.trim()]: entry });
  return name.trim();
}

/** Ask which configured agent to remove and delete it from settings */
export async function removeAgentInteractive(): Promise<string | undefined> {
  const names = getAgentNames();
  if (!names.length) {
    vscode.window.showInformationMessage('No ACP agents configured.');
    return;
  }
  const name = await vscode.window.showQuickPick(names, { placeHolder: 'Select the agent to remove' });
  if (!name) { return; }
  const { [name]: _removed, ...rest } = readRawAgents();
  await saveAgentConfigs(rest);
  return name;
}

function readRawAgents(): Record<string, AgentConfigEntry> {
  return { ...vscode.workspace.getConfiguration(ACP_CONFIG_SECTION).get<Record<string, AgentConfigEntry>>('agents', {}) };
}
