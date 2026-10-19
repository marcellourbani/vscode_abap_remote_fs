import type { AgentConfigEntry } from './AgentConfig';

const npx = (pkg: string, ...args: string[]): AgentConfigEntry => ({
  command: 'npx',
  args: ['-y', `${pkg}@latest`, ...args],
  env: {},
});

/** Must stay in sync with the defaultSnippets of abapfs.acp.agents in package.json */
export const AGENT_PRESETS: Record<string, AgentConfigEntry> = {
  'Claude Code': npx('@agentclientprotocol/claude-agent-acp'),
  'GitHub Copilot': npx('@github/copilot-language-server', '--acp'),
  'Codex CLI': npx('@zed-industries/codex-acp'),
  'Gemini CLI': npx('@google/gemini-cli', '--experimental-acp'),
  'Qwen Code': npx('@qwen-code/qwen-code', '--acp', '--experimental-skills'),
  'Auggie CLI': { ...npx('@augmentcode/auggie', '--acp'), env: { AUGMENT_DISABLE_AUTO_UPDATE: '1' } },
  'Qoder CLI': npx('@qoder-ai/qodercli', '--acp'),
  'OpenCode': npx('opencode-ai', 'acp'),
};

export function unconfiguredPresets(configuredNames: string[]): [string, AgentConfigEntry][] {
  const taken = new Set(configuredNames);
  return Object.entries(AGENT_PRESETS).filter(([name]) => !taken.has(name));
}
