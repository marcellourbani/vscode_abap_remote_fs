import {
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  EventEmitter,
  Event,
  window,
  ViewColumn,
  WebviewPanel,
  Uri,
  commands,
  ThemeIcon
} from 'vscode';
import { FeedStateManager } from '../../services/feeds/feedStateManager';
import { FeedEntry, FeedType } from '../../services/feeds/feedTypes';
import { getFeedTypeIcon, getSeverityIcon } from '../../services/feeds/feedParsers';
import { AbapFsCommands, command } from '../../commands';
import { AdtObjectFinder } from '../../adt/operations/AdtObjectFinder';
import { log } from '../../lib';

/**
 * System node in feed tree
 */
class SystemFeedNode extends TreeItem {
  readonly tag = 'system' as const;
  
  constructor(
    public readonly systemId: string,
    private stateManager: FeedStateManager
  ) {
    const baseLabel = systemId || 'Unknown System';
    
    // Calculate stats before super() call
    const allEntries = stateManager.getAllFeedEntries();
    const systemEntries = allEntries.filter(e => e.systemId === systemId);
    const unreadCount = systemEntries.filter(e => !e.isRead).length;
    
    // Add dot indicator if unread
    const label = unreadCount > 0 ? `● ${baseLabel}` : baseLabel;
    
    super(label, TreeItemCollapsibleState.Expanded);
    
    this.contextValue = 'systemFeed';
    this.tooltip = `System: ${baseLabel}`;
    
    if (unreadCount > 0) {
      this.description = `${unreadCount} new`;
      this.tooltip = `${baseLabel}: ${unreadCount} unread, ${systemEntries.length} total`;
    }
  }

  async children(): Promise<FeedFolderNode[]> {
    try {
      // Get all feed titles for this system
      const allEntries = this.stateManager.getAllFeedEntries();
      const systemEntries = allEntries.filter(e => e?.systemId === this.systemId && e?.feedTitle);
      
      if (systemEntries.length === 0) {
        return [];
      }
      
      // Group by feed title
      const feedGroups = new Map<string, FeedEntry[]>();
      for (const entry of systemEntries) {
        const existing = feedGroups.get(entry.feedTitle) || [];
        existing.push(entry);
        feedGroups.set(entry.feedTitle, existing);
      }

      // Create feed nodes
      const feedNodes: FeedFolderNode[] = [];
      for (const [feedTitle, entries] of feedGroups.entries()) {
        if (feedTitle) {  // Only create node if feedTitle is not empty
          feedNodes.push(new FeedFolderNode(this.systemId, feedTitle, entries, this.stateManager));
        }
      }

      // Sort by unread count (highest first)
      feedNodes.sort((a, b) => b.getUnreadCount() - a.getUnreadCount());

      return feedNodes;
    } catch (error) {
      return [];
    }
  }
}

/**
 * Feed folder node
 */
class FeedFolderNode extends TreeItem {
  readonly tag = 'feedFolder' as const;
  
  constructor(
    public readonly systemId: string,
    public readonly feedTitle: string,
    public readonly entries: FeedEntry[],
    private stateManager: FeedStateManager
  ) {
    const baseLabel = feedTitle || 'Unknown Feed';
    
    // Calculate unread count before super() call
    const unreadCount = entries.filter(e => !e.isRead).length;
    
    // Add dot indicator if unread
    const label = unreadCount > 0 ? `● ${baseLabel}` : baseLabel;
    
    super(label, TreeItemCollapsibleState.Collapsed);
    
    this.contextValue = 'feedFolder';
    
    if (unreadCount > 0) {
      this.description = `${unreadCount} new`;
      this.tooltip = `${baseLabel} on ${systemId}: ${unreadCount} unread, ${entries.length} total`;
    } else {
      this.description = `${entries.length} total`;
      this.tooltip = `${baseLabel} on ${systemId}: ${entries.length} entries`;
    }
  }

  getUnreadCount(): number {
    return this.entries.filter(e => !e.isRead).length;
  }

  children(): FeedEntryNode[] {
    try {
      // Sort entries by timestamp (newest first)
      const sortedEntries = [...this.entries].sort((a, b) => {
        const timeA = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
        const timeB = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
        return timeB - timeA;
      });

      return sortedEntries.map(entry => 
        new FeedEntryNode(entry, this.stateManager)
      );
    } catch (error) {
      return [];
    }
  }
}

/**
 * Feed entry node
 */
class FeedEntryNode extends TreeItem {
  readonly tag = 'feedEntry' as const;
  
  constructor(
    public readonly entry: FeedEntry,
    private stateManager: FeedStateManager
  ) {
    // Add visual indicator for unread entries
    const label = entry?.title || 'Untitled';
    const displayLabel = entry?.isRead ? label : `● ${label}`;
    
    super(displayLabel, TreeItemCollapsibleState.None);
    this.contextValue = 'feedEntry';
    
    try {
      // Show timestamp
      this.description = entry?.timestamp instanceof Date 
        ? entry.timestamp.toLocaleString() 
        : String(entry?.timestamp || '');
      
      // Tooltip with full summary
      const timeStr = entry?.timestamp instanceof Date 
        ? entry.timestamp.toLocaleString() 
        : String(entry?.timestamp || 'Unknown');
      this.tooltip = `${entry?.title || 'Untitled'}\n\n${entry?.summary || ''}\n\nSystem: ${entry?.systemId || 'Unknown'}\nFeed: ${entry?.feedTitle || 'Unknown'}\nTime: ${timeStr}`;
      
      // Command to view entry
      this.command = {
        title: 'View Feed Entry',
        command: AbapFsCommands.viewFeedEntry,
        arguments: [this]
      };
    } catch (error) {
      this.description = 'Error loading entry';
    }
  }

  children(): FeedEntryNode[] {
    return [];
  }
}

// Type union for all tree items
type FeedItem = SystemFeedNode | FeedFolderNode | FeedEntryNode;

/**
 * Feed Inbox Tree Data Provider
 */
export class FeedInboxProvider implements TreeDataProvider<FeedItem> {
  private _onDidChangeTreeData = new EventEmitter<FeedItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<FeedItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private stateManager: FeedStateManager;
  private webviewPanels: Map<string, WebviewPanel> = new Map();

  constructor(stateManager: FeedStateManager) {
    this.stateManager = stateManager;
  }

  /**
   * Refresh the tree view
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item
   */
  getTreeItem(element: FeedItem): TreeItem {
    if (!element) {
      return new TreeItem('Error: undefined element');
    }
    return element;
  }

  /**
   * Get children - VS Code calls this to get child nodes
   */
  async getChildren(element?: FeedItem): Promise<FeedItem[]> {
    
    try {
      switch (element?.tag) {
        case undefined:
          const rootNodes = this.getRootNodes();
          if (rootNodes.length > 0) {
          }
          return rootNodes;
        
        case 'system':
          const systemChildren = await element.children();
          if (systemChildren.length > 0) {
          }
          return systemChildren;
        
        case 'feedFolder':
          const folderChildren = element.children();
          if (folderChildren.length > 0) {
          }
          return folderChildren;
        
        case 'feedEntry':
          return [];
        
        default:
          return [];
      }
    } catch (error) {
      if (error instanceof Error && error.stack) {
      }
      return [];
    }
  }

  /**
   * Get root nodes (systems with feed entries)
   */
  private getRootNodes(): FeedItem[] {
    const allEntries = this.stateManager.getAllFeedEntries();
    
    if (allEntries.length === 0) {
      return [];
    }

    // Filter out entries with undefined systemId
    const validEntries = allEntries.filter(e => e?.systemId);
    if (validEntries.length < allEntries.length) {
    }

    if (validEntries.length === 0) {
      return [];
    }

    // Group by system
    const systems = new Set(validEntries.map(e => e.systemId));
    
    // Create system nodes
    const systemNodes = Array.from(systems).map(systemId => 
      new SystemFeedNode(systemId, this.stateManager)
    );

    // Sort by system name
    systemNodes.sort((a, b) => a.systemId.localeCompare(b.systemId));

    return systemNodes;
  }

  /**
   * Show feed entry in webview
   */
  async viewFeedEntry(node: any): Promise<void> {
    // Handle both FeedEntryNode and plain object
    const entry = node.entry || node;
    
    // Mark as read
    await this.stateManager.markAsRead(entry.systemId, entry.feedTitle, entry.id);
    this.refresh();

    // Get or create webview panel
    const panelKey = `${entry.systemId}-${entry.feedTitle}-${entry.id}`;
    let panel = this.webviewPanels.get(panelKey);

    if (!panel) {
      panel = window.createWebviewPanel(
        'feedEntry',
        entry.title,
        ViewColumn.Active,
        {
          enableScripts: true,
          enableCommandUris: true,
          enableFindWidget: true,
          retainContextWhenHidden: true
        }
      );

      this.webviewPanels.set(panelKey, panel);

      panel.onDidDispose(() => {
        this.webviewPanels.delete(panelKey);
      });

      // Handle clicks on ADT URIs
      panel.webview.onDidReceiveMessage(async message => {
        if (message.command === 'click' && message.uri) {
          return new AdtObjectFinder(entry.systemId).displayAdtUri(message.uri);
        }
      });
    }

    // Render content based on feed type
    panel.webview.html = this.renderFeedEntry(entry);
    panel.reveal();
  }

  /**
   * Render feed entry as HTML
   */
  private renderFeedEntry(entry: FeedEntry): string {
    const jsFooter = `<script type="text/javascript">
const vscode = acquireVsCodeApi();
const as = document.querySelectorAll("a")
as.forEach(
    a=>a.addEventListener('click',e=>{
        const uri = e.currentTarget.attributes.href.value
        if(!uri.match(/^#/)){
            e.preventDefault();
            vscode.postMessage({
                command: 'click',
                uri
            });
        }
    })
)</script>`;

    // For dumps, use the raw HTML content from text field
    if (entry.rawData.text) {
      return `${entry.rawData.text}${jsFooter}`;
    }

    // For URI errors and other feeds with HTML summary, extract and render HTML
    let htmlContent = null;
    if (entry.rawData.summary) {
      // Check if summary has #text with @_type: "html"
      if (entry.rawData.summary['#text'] && entry.rawData.summary['@_type'] === 'html') {
        htmlContent = entry.rawData.summary['#text'];
      } else if (typeof entry.rawData.summary === 'string' && entry.rawData.summary.includes('<table')) {
        htmlContent = entry.rawData.summary;
      }
    }

    // If we found HTML content, render it
    if (htmlContent) {
      return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
        }
        h1 {
            font-size: 1.3em;
            margin-top: 20px;
            margin-bottom: 10px;
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 10px 0;
        }
        th, td {
            border: 1px solid var(--vscode-panel-border);
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: var(--vscode-editor-background);
            font-weight: bold;
        }
        .meta {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 15px;
        }
    </style>
</head>
<body>
    <div class="meta">
        <strong>${this.escapeHtml(entry.title)}</strong><br>
        System: ${this.escapeHtml(entry.systemId)} | Time: ${this.escapeHtml(entry.timestamp?.toLocaleString?.() || '')}
        ${entry.author ? ` | Author: ${this.escapeHtml(entry.author)}` : ''}
    </div>
    ${htmlContent}
    ${jsFooter}
</body>
</html>`;
    }

    // For other types, create a formatted HTML view
    const severityColor = entry.severity === 'error' ? '#f48771' : 
                          entry.severity === 'warning' ? '#cca700' : '#75beff';

    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            line-height: 1.6;
        }
        .header {
            border-left: 4px solid ${severityColor};
            padding-left: 15px;
            margin-bottom: 20px;
        }
        .title {
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 10px;
        }
        .meta {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            margin-bottom: 5px;
        }
        .summary {
            margin: 20px 0;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
        }
        .raw-data {
            margin-top: 20px;
            padding: 15px;
            background-color: var(--vscode-editor-background);
            border-radius: 4px;
            font-family: monospace;
            font-size: 0.85em;
            white-space: pre-wrap;
            overflow-x: auto;
        }
        a {
            color: var(--vscode-textLink-foreground);
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="title">${this.escapeHtml(entry.title)}</div>
        <div class="meta">System: ${this.escapeHtml(entry.systemId)}</div>
        <div class="meta">Feed: ${this.escapeHtml(entry.feedTitle)}</div>
        <div class="meta">Time: ${this.escapeHtml(entry.timestamp?.toLocaleString?.() || '')}</div>
        ${entry.author ? `<div class="meta">Author: ${this.escapeHtml(entry.author)}</div>` : ''}
        ${entry.category ? `<div class="meta">Category: ${this.escapeHtml(entry.category)}</div>` : ''}
    </div>
    
    <div class="summary">
        ${this.escapeHtml(entry.summary)}
    </div>
    
    ${entry.rawData ? `<div class="raw-data">${this.escapeHtml(JSON.stringify(entry.rawData, null, 2))}</div>` : ''}
    
    ${jsFooter}
</body>
</html>`;
  }

  /**
   * Escape HTML
   */
  private escapeHtml(text: string | undefined | null): string {
    if (text === undefined || text === null) return '';
    const str = String(text);
    if (str === undefined || typeof str !== 'string') return '';
    return str.replace(/[&<>"']/g, m => {
      const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return map[m];
    });
  }

  /**
   * Mark all as read
   */
  async markAllAsRead(): Promise<void> {
    await this.stateManager.markAllEntriesAsRead();
    this.refresh();
   // window.showInformationMessage('All feed entries marked as read');
  }

  /**
   * Mark feed folder as read
   */
  async markFeedFolderAsRead(node: any): Promise<void> {
    await this.stateManager.markAllAsRead(node.systemId, node.feedTitle);
    this.refresh();
  }

  /**
   * Delete feed entry
   */
  async deleteFeedEntry(node: any): Promise<void> {
    // Handle both FeedEntryNode and plain object
    const entry = node.entry || node;
    await this.stateManager.removeEntry(entry.systemId, entry.feedTitle, entry.id);
    this.refresh();
  }

  /**
   * Clear feed folder
   */
  async clearFeedFolder(node: any): Promise<void> {
    // Get entry count from state manager
    const entries = this.stateManager.getFeedEntries(node.systemId, node.feedTitle);
    
    const result = await window.showWarningMessage(
      `Clear all ${entries.length} entries from "${node.feedTitle}"?`,
      'Clear',
      'Cancel'
    );
    
    if (result === 'Clear') {
      await this.stateManager.clearFeedEntries(node.systemId, node.feedTitle);
      this.refresh();
    }
  }

  /**
   * Show feed inbox and optionally navigate to specific feed
   */
  async showFeedInbox(options?: { systemId?: string; feedTitle?: string }): Promise<void> {
    // Refresh the tree to show latest data
    this.refresh();
    
    // Focus the feed inbox view
    try {
      await commands.executeCommand('abapfs.feedInbox.focus');
    } catch {
      // Fallback: just show the ABAP view container
      await commands.executeCommand('workbench.view.extension.abapfs');
    }
  }
}

// Export singleton instance
export let feedInboxProvider: FeedInboxProvider | undefined;

export function initializeFeedInboxProvider(stateManager: FeedStateManager): FeedInboxProvider {
  feedInboxProvider = new FeedInboxProvider(stateManager);
  return feedInboxProvider;
}

