import { ViewColumn, workspace, WebviewPanel } from 'vscode';
import { funWindow as window } from '../services/funMessenger';
import { connectedRoots } from '../config';
import { getOrCreateClient } from '../adt/conections';
import { toFeedMetadata } from '../services/feeds/feedParsers';
import { FeedSubscriptions, SystemFeedConfig } from '../services/feeds/feedTypes';
import { context } from '../extension';
import * as path from 'path';
import * as fs from 'fs';

let currentPanel: WebviewPanel | undefined;

export async function configureFeedsCommand() {
  // If panel already exists and not disposed, reveal it
  if (currentPanel) {
    try {
      currentPanel.reveal(ViewColumn.Active);
      return;
    } catch {
      // Panel was disposed, create new one
      currentPanel = undefined;
    }
  }

  // Create webview panel
  currentPanel = window.createWebviewPanel(
    'feedConfiguration',
    '📡 Feed Configuration',
    ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: []
    }
  );

  // Load HTML content from extension dist folder
  const htmlPath = path.join(context.extensionPath, 'client', 'dist', 'media', 'feedConfiguration.html');
  let htmlContent = fs.readFileSync(htmlPath, 'utf8');
  
  currentPanel.webview.html = htmlContent;

  // Handle messages from webview
  currentPanel.webview.onDidReceiveMessage(
    async message => {
      switch (message.command) {
        case 'loadSystems':
          await handleLoadSystems();
          break;
          
        case 'loadFeeds':
          await handleLoadFeeds(message.data.systemId);
          break;
          
        case 'saveConfig':
          await handleSaveConfig(message.data.systemId, message.data.config);
          break;
          
        case 'bulkAction':
          // Bulk actions are handled in webview
          break;
      }
    },
    undefined,
    []
  );

  // Clean up when panel is disposed
  currentPanel.onDidDispose(
    () => {
      currentPanel = undefined;
    },
    null,
    []
  );
}

/**
 * Handle load systems request
 */
async function handleLoadSystems(): Promise<void> {
  try {
    const systems = Array.from(connectedRoots().keys());
    
    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: 'systemsLoaded',
        data: systems
      });
    }
  } catch (error) {
    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: 'error',
        data: `Failed to load systems: ${error}`
      });
    }
  }
}

/**
 * Handle load feeds request
 */
async function handleLoadFeeds(systemId: string): Promise<void> {
  try {
    // Get client for this system
    const client = await getOrCreateClient(systemId);
    
    // Fetch available feeds
    const feeds = await client.feeds();
    const feedMetadata = feeds.map(toFeedMetadata);

    // Get existing configuration from settings
    const config = workspace.getConfiguration();
    const subscriptions = config.get<FeedSubscriptions>('abapfs.feedSubscriptions', {});
    const systemConfig = subscriptions[systemId] || {};

    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: 'feedsLoaded',
        data: {
          feeds: feedMetadata,
          config: systemConfig
        }
      });
    }
  } catch (error) {
    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: 'error',
        data: `Failed to load feeds for ${systemId}: ${error}`
      });
    }
  }
}

/**
 * Handle save config request
 */
async function handleSaveConfig(systemId: string, systemConfig: SystemFeedConfig): Promise<void> {
  try {
    // Get existing subscriptions
    const config = workspace.getConfiguration();
    const subscriptions = config.get<FeedSubscriptions>('abapfs.feedSubscriptions', {});

    // Update this system's configuration
    subscriptions[systemId] = systemConfig;

    // Save to workspace configuration
    await config.update('abapfs.feedSubscriptions', subscriptions, true);

    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: 'saveSuccess'
      });
    }

    window.showInformationMessage(`Feed configuration saved for ${systemId}. Polling service will restart automatically.`);
  } catch (error) {
    if (currentPanel) {
      currentPanel.webview.postMessage({
        command: 'saveError',
        data: String(error)
      });
    }
  }
}

