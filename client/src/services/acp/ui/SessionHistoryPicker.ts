import * as vscode from 'vscode';
import type { SessionInfo as ProtocolSessionInfo } from '@agentclientprotocol/sdk';
import { SessionManager } from '../core/SessionManager';
import { type PersistedSessionEntry } from '../core/SessionHistoryStore';
import { ChatWebviewProvider } from './ChatWebviewProvider';
import { logError } from '../utils/Logger';

interface HistoryItem extends vscode.QuickPickItem {
  sessionId: string;
}

/** Quick pick of past conversations, like "Show Chats..." in Copilot Chat */
export async function showSessionHistory(sessionManager: SessionManager, chat: ChatWebviewProvider): Promise<void> {
  const agentName = sessionManager.getActiveAgentName();
  if (!agentName) {
    vscode.window.showInformationMessage('Connect to an agent to see its previous conversations.');
    return;
  }

  let items: HistoryItem[] | undefined;
  try {
    items = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Loading conversations...' },
      () => historyItems(sessionManager, agentName),
    );
  } catch (e: any) {
    logError(`Failed to list conversations for ${agentName}`, e);
    vscode.window.showErrorMessage(`Failed to list conversations: ${e.message}`);
    return;
  }
  if (!items) { return; }
  if (items.length === 0) {
    vscode.window.showInformationMessage(`No previous conversations with ${agentName}.`);
    return;
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: `${agentName} conversations`,
    placeHolder: 'Select a conversation to open',
    matchOnDescription: true,
  });
  if (!picked || picked.sessionId === sessionManager.getActiveSessionId()) { return; }
  await openSession(sessionManager, chat, agentName, picked.sessionId);
}

async function historyItems(sessionManager: SessionManager, agentName: string): Promise<HistoryItem[] | undefined> {
  await sessionManager.ensureConnected(agentName);
  const caps = sessionManager.getCachedCapabilities(agentName);
  if (!caps?.load && !caps?.resume) {
    vscode.window.showInformationMessage(`${agentName} does not support reopening past conversations.`);
    return undefined;
  }

  const cwd = sessionManager.getWorkspaceCwd();
  const store = sessionManager.getHistoryStore();
  const local = new Map((store?.list(agentName, cwd) ?? []).map(e => [e.sessionId, e]));
  const rows = caps.list
    ? (await sessionManager.listSessions(agentName, { cwd })).sessions.map(s => agentRow(s, local.get(s.sessionId)))
    : [...local.values()].map(localRow);

  const activeId = sessionManager.getActiveSessionId();
  return rows
    .filter(row => row.label || row.unknown || row.sessionId === activeId)
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(row => historyItem(row, activeId));
}

/** Agents may list sessions without titles, so prefer what ABAP FS recorded locally */
interface HistoryRow {
  sessionId: string;
  label?: string;
  updatedAt?: string;
  /** Not recorded locally, e.g. created outside VS Code */
  unknown: boolean;
}

function agentRow(info: ProtocolSessionInfo, entry: PersistedSessionEntry | undefined): HistoryRow {
  const local = entry ? localRow(entry) : undefined;
  return {
    sessionId: info.sessionId,
    label: info.title?.trim() || local?.label,
    updatedAt: local?.updatedAt || info.updatedAt || undefined,
    unknown: !entry,
  };
}

function localRow(entry: PersistedSessionEntry): HistoryRow {
  return {
    sessionId: entry.sessionId,
    label: entry.title?.trim() || entry.firstPrompt?.trim() || undefined,
    updatedAt: entry.lastActiveAt,
    unknown: false,
  };
}

function historyItem(row: HistoryRow, activeId: string | null): HistoryItem {
  const active = row.sessionId === activeId;
  return {
    sessionId: row.sessionId,
    label: truncate(singleLine(row.label || 'Untitled conversation'), 80),
    description: active ? 'current' : relativeTime(row.updatedAt),
    detail: row.label ? undefined : shortSessionId(row.sessionId),
    iconPath: new vscode.ThemeIcon(active ? 'circle-filled' : 'comment-discussion'),
  };
}

function singleLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

async function openSession(
  sessionManager: SessionManager,
  chat: ChatWebviewProvider,
  agentName: string,
  sessionId: string,
): Promise<void> {
  const replay = !!sessionManager.getCachedCapabilities(agentName)?.load;
  chat.clearChat();
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Opening conversation...' },
      () => replay
        ? sessionManager.loadSession(agentName, sessionId)
        : sessionManager.resumeSession(agentName, sessionId),
    );
  } catch (e: any) {
    logError(`Failed to open conversation ${sessionId}`, e);
    vscode.window.showErrorMessage(`Failed to open conversation: ${e.message}`);
    return;
  }
  if (!replay) {
    vscode.window.showInformationMessage(
      `${agentName} resumed the conversation but cannot replay its messages; the agent still has the full context.`,
    );
  }
}

function shortSessionId(id: string): string {
  if (id.length <= 14) { return id; }
  return id.slice(0, 8) + '…' + id.slice(-4);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function relativeTime(iso: string | null | undefined): string | undefined {
  if (!iso) { return undefined; }
  const t = Date.parse(iso);
  if (Number.isNaN(t)) { return undefined; }
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) { return 'just now'; }
  if (min < 60) { return `${min}m ago`; }
  const hr = Math.floor(min / 60);
  if (hr < 24) { return `${hr}h ago`; }
  const day = Math.floor(hr / 24);
  if (day < 30) { return `${day}d ago`; }
  return new Date(t).toLocaleDateString();
}
