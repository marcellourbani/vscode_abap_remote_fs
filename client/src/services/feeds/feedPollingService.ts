import { workspace, ExtensionContext, commands } from 'vscode';
import { funWindow as window } from '../funMessenger';
import { getOrCreateClient } from '../../adt/conections';
import { connectedRoots } from '../../config';
import { FeedStateManager } from './feedStateManager';
import { parseFeedResponse, toFeedMetadata } from './feedParsers';
import {
  FeedSubscriptions,
  PollingTask,
  FeedEntry,
  FeedMetadata
} from './feedTypes';
import { fullParse, xmlArray } from 'abap-adt-api/build/utilities';

const MIN_POLL_INTERVAL = 120; // 2 minutes in seconds
const MAX_POLL_INTERVAL = 86400; // 24 hours in seconds
const MAX_CONCURRENT_POLLS = 5;
const EXPONENTIAL_BACKOFF_BASE = 2;
const MAX_BACKOFF_MULTIPLIER = 8;
const STAGGER_DELAY = 5000; // 5 seconds between poll initiations
const ERROR_NOTIFICATION_COOLDOWN = 3600000; // 1 hour in milliseconds

/**
 * Feed Polling Service - manages background polling of all subscribed feeds
 */
export class FeedPollingService {
  private context: ExtensionContext;
  private stateManager: FeedStateManager;
  private pollingTasks: Map<string, PollingTask> = new Map();
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private currentPolls: number = 0;
  private onEntriesChanged?: () => void;
  private restartDebounceTimer?: NodeJS.Timeout;
  private configListenerDisposable?: { dispose: () => void };
  private lastErrorNotificationTime: Map<string, number> = new Map(); // systemId -> timestamp

  constructor(context: ExtensionContext, stateManager: FeedStateManager) {
    this.context = context;
    this.stateManager = stateManager;
  }

  /**
   * Set callback for when entries change
   */
  setOnEntriesChanged(callback: () => void): void {
    this.onEntriesChanged = callback;
  }

  /**
   * Start the polling service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.isPaused = false;

    // Load feed subscriptions from settings
    await this.loadAndSchedulePolls();

    // Listen for settings changes (debounced to handle rapid saves)
    // Only register listener once
    if (!this.configListenerDisposable) {
      this.configListenerDisposable = workspace.onDidChangeConfiguration(async e => {
        if (e.affectsConfiguration('abapfs.feedSubscriptions')) {
          
          // Immediately cancel all active polling tasks to stop current polls
          for (const task of this.pollingTasks.values()) {
            if (task.timeoutHandle) {
              clearTimeout(task.timeoutHandle);
              task.timeoutHandle = undefined;
            }
          }
          
          // Clear existing restart timer
          if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer);
          }
          
          // Debounce restart by 2 seconds to avoid multiple restarts when saving multiple configs
          this.restartDebounceTimer = setTimeout(async () => {
            await this.restart();
          }, 2000);
        }
      });
      
      // Add to subscriptions for cleanup on extension deactivate
      this.context.subscriptions.push(this.configListenerDisposable);
    }

    // Check for offline/online status
    this.setupOfflineDetection();

  }

  /**
   * Stop the polling service
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Clear restart debounce timer
    if (this.restartDebounceTimer) {
      clearTimeout(this.restartDebounceTimer);
      this.restartDebounceTimer = undefined;
    }

    // Dispose config listener
    if (this.configListenerDisposable) {
      this.configListenerDisposable.dispose();
      this.configListenerDisposable = undefined;
    }

    // Cancel all polling tasks
    for (const task of this.pollingTasks.values()) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle);
      }
    }

    this.pollingTasks.clear();
  }

  /**
   * Restart the polling service
   */
  async restart(): Promise<void> {
    this.stop();
    await this.start();
  }

  /**
   * Pause polling (e.g., when offline)
   */
  pause(): void {
    if (!this.isRunning) return;
    
    this.isPaused = true;

    // Cancel all active timeouts but keep task info
    for (const task of this.pollingTasks.values()) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle);
        task.timeoutHandle = undefined;
      }
    }
  }

  /**
   * Resume polling
   */
  async resume(): Promise<void> {
    if (!this.isRunning || !this.isPaused) return;

    this.isPaused = false;

    // Reschedule all polls
    await this.loadAndSchedulePolls();
  }

  /**
   * Load feed subscriptions and schedule polls
   */
  private async loadAndSchedulePolls(): Promise<void> {
    // Clear existing tasks
    for (const task of this.pollingTasks.values()) {
      if (task.timeoutHandle) {
        clearTimeout(task.timeoutHandle);
      }
    }
    this.pollingTasks.clear();

    // Get feed subscriptions from settings
    const config = workspace.getConfiguration();
    const subscriptions = config.get<FeedSubscriptions>('abapfs.feedSubscriptions', {});


    // Get connected systems
    const systems = Array.from(connectedRoots().keys());

    let staggerIndex = 0;
    for (const systemId of systems) {
      const systemConfig = subscriptions[systemId];
      if (!systemConfig) {
        continue;
      }

      // Get available feeds for this system
      const availableFeeds = await this.getAvailableFeeds(systemId);
      if (!availableFeeds) continue;

      for (const [feedTitle, feedConfig] of Object.entries(systemConfig)) {
        if (!feedConfig.enabled) {
          continue;
        }

        // Find the feed metadata
        const feedMeta = availableFeeds.find(f => f.title === feedTitle);
        if (!feedMeta) {
          // Feed no longer available
          await this.handleUnavailableFeed(systemId, feedTitle);
          continue;
        }

        // Validate polling interval
        const pollingInterval = this.validatePollingInterval(feedConfig.pollingInterval);

        // Create polling task
        const taskKey = `${systemId}|${feedTitle}`;
        const task: PollingTask = {
          systemId,
          feedTitle,
          feedPath: feedMeta.href,
          config: { ...feedConfig, pollingInterval },
          nextPollTime: Date.now() + (staggerIndex * STAGGER_DELAY), // Stagger initial polls
          isPolling: false
        };

        this.pollingTasks.set(taskKey, task);

        // Schedule the poll with staggering
        this.schedulePoll(task, staggerIndex * STAGGER_DELAY);
        staggerIndex++;
      }
    }

    
    // If no tasks were scheduled, log it clearly
    if (this.pollingTasks.size === 0) {
    }
  }

  /**
   * Get available feeds for a system
   */
  private async getAvailableFeeds(systemId: string): Promise<FeedMetadata[] | null> {
    try {
      const client = await getOrCreateClient(systemId);
      const feeds = await client.feeds();
      return feeds.map(toFeedMetadata);
    } catch (error) {
      return null;
    }
  }

  /**
   * Handle unavailable feed
   */
  private async handleUnavailableFeed(systemId: string, feedTitle: string): Promise<void> {
    const state = this.stateManager.getFeedState(systemId, feedTitle);
    
    // Only notify if this is the first time we notice it's unavailable
    if (!state || state.isAvailable) {
      await this.stateManager.markFeedUnavailable(systemId, feedTitle);
      
      void window.showWarningMessage(
        `Feed "${feedTitle}" is no longer available on ${systemId}. It may have been removed after a system upgrade. Please review your feed subscriptions.`,
        'Configure Feeds'
      ).then(action => {
        if (action === 'Configure Feeds') {
          void commands.executeCommand('abapfs.configureFeeds');
        }
      });
    }
  }

  /**
   * Validate and normalize polling interval
   */
  private validatePollingInterval(interval: number): number {
    if (interval < MIN_POLL_INTERVAL) return MIN_POLL_INTERVAL;
    if (interval > MAX_POLL_INTERVAL) return MAX_POLL_INTERVAL;
    return interval;
  }

  /**
   * Schedule a poll for a task
   */
  private schedulePoll(task: PollingTask, delay: number = 0): void {
    if (!this.isRunning || this.isPaused) return;

    const actualDelay = delay || Math.max(0, task.nextPollTime - Date.now());
    
    task.timeoutHandle = setTimeout(async () => {
      await this.executePoll(task);
    }, actualDelay);
  }

  /**
   * Execute a poll for a task
   */
  private async executePoll(task: PollingTask): Promise<void> {
    if (!this.isRunning || this.isPaused || task.isPolling) return;

    // Wait if too many concurrent polls
    while (this.currentPolls >= MAX_CONCURRENT_POLLS) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    task.isPolling = true;
    this.currentPolls++;

    try {

      // Get the client
      const client = await getOrCreateClient(task.systemId);

      // Build query
      const query = task.config.useDefaultQuery 
        ? undefined 
        : task.config.query;


      // Poll the feed based on type
      let feedData: any;
      if (task.feedPath.includes('/runtime/dumps')) {
        feedData = await client.dumps(query);
      } else {
        // For other feed types, we need to use generic HTTP request
        // Since the ADT API doesn't have specific methods for all feed types
        feedData = await this.pollGenericFeed(client, task.feedPath, query);
      }

      // Parse the feed response
      const feedMeta = await this.getAvailableFeeds(task.systemId);
      const feed = feedMeta?.find(f => f.title === task.feedTitle);
      if (!feed) {
        throw new Error('Feed metadata not found');
      }

      
      const entries = parseFeedResponse(
        feedData,
        task.systemId,
        task.feedTitle,
        task.feedPath,
        feed.feedType
      );


      // Filter for NEW entries FIRST (before adding to state)
      const newEntries = this.filterNewEntries(task, entries);
      

      // Always add ALL entries to state manager (so they appear in inbox)
      if (entries.length > 0) {
        await this.stateManager.addFeedEntries(task.systemId, task.feedTitle, entries);

        // Update last seen ID
        await this.stateManager.updateLastSeen(task.systemId, task.feedTitle, entries[0].id);

        // Notify tree view to refresh
        if (this.onEntriesChanged) {
          this.onEntriesChanged();
        }
      }

      // Show notifications only for new entries
      if (newEntries.length > 0) {
        
        if (task.config.notifications) {
          await this.showNotifications(task, newEntries);
        }
      }

      // Update last poll time
      await this.stateManager.updateLastPoll(task.systemId, task.feedTitle);

      // Reset error count on success
      await this.stateManager.resetErrorCount(task.systemId, task.feedTitle);

      // Mark feed as available
      await this.stateManager.markFeedAvailable(task.systemId, task.feedTitle);

    } catch (error) {

      // Increment error count
      await this.stateManager.incrementErrorCount(task.systemId, task.feedTitle, String(error));

      // Get current error count
      const state = this.stateManager.getFeedState(task.systemId, task.feedTitle);
      const errorCount = state?.errorCount || 0;

      // Apply exponential backoff if errors persist
      if (errorCount > 3) {
        const backoffMultiplier = Math.min(
          EXPONENTIAL_BACKOFF_BASE ** (errorCount - 3),
          MAX_BACKOFF_MULTIPLIER
        );
        task.config.pollingInterval *= backoffMultiplier;
      }

      // Show error notification for persistent failures (with 1-hour cooldown per system)
      if (errorCount >= 5) {
        const lastNotification = this.lastErrorNotificationTime.get(task.systemId) || 0;
        const now = Date.now();
        
        if (now - lastNotification > ERROR_NOTIFICATION_COOLDOWN) {
          this.lastErrorNotificationTime.set(task.systemId, now);
          void window.showErrorMessage(
            `Unable to reach SAP system "${task.systemId}". Feed polling will continue in the background.`,
            'Configure Feeds'
          ).then(action => {
            if (action === 'Configure Feeds') {
              void commands.executeCommand('abapfs.configureFeeds');
            }
          });
        }
      }
    } finally {
      task.isPolling = false;
      this.currentPolls--;

      // Schedule next poll
      task.nextPollTime = Date.now() + (task.config.pollingInterval * 1000);
      this.schedulePoll(task);
    }
  }

  /**
   * Poll a generic feed using HTTP request
   */
  private async pollGenericFeed(client: any, feedPath: string, query?: string): Promise<any> {
    // Build query string
    const qs: any = {};
    if (query) {
      qs['$query'] = query;
    }

    // Make HTTP request using the underlying httpClient
    const response = await client.httpClient.request(feedPath, {
      method: 'GET',
      qs,
      headers: { Accept: 'application/atom+xml;type=feed' }
    });


    // Parse the XML feed response using abap-adt-api utilities
    const raw = fullParse(response.body, { removeNSPrefix: true });
    const feed = raw?.feed || raw;
    
    
    // Extract raw entries from the feed (parseFeedResponse will convert them to FeedEntry objects)
    let entries = xmlArray(feed, 'entry');
    
    // Ensure entries is always an array (xmlArray sometimes returns a function or other non-array types)
    let entriesArray: any[] = [];
    if (Array.isArray(entries)) {
      entriesArray = entries;
    } else if (entries && typeof entries === 'object' && 'length' in entries) {
      // Array-like object, convert to array
      entriesArray = Array.from(entries as any);
    } else {
      // Not an array, not array-like, return empty array
      entriesArray = [];
    }
    
    
    // Return raw entries for parseFeedResponse to process
    return entriesArray;
  }

  /**
   * Filter new entries
   */
  private filterNewEntries(task: PollingTask, entries: FeedEntry[]): FeedEntry[] {
    // If this is the first poll (no existing entries), treat all as new
    const hasExistingEntries = this.stateManager.getFeedEntries(task.systemId, task.feedTitle).length > 0;
    if (!hasExistingEntries) {
      return entries;
    }
    
    const state = this.stateManager.getFeedState(task.systemId, task.feedTitle);
    if (!state) return entries; // All entries are new if no state

    const lastSeenId = state.lastSeenEntryId;
    if (!lastSeenId) return entries;

    // Find the index of last seen entry
    const lastSeenIndex = entries.findIndex(e => e.id === lastSeenId);
    if (lastSeenIndex === -1) return entries; // Last seen not found, return all

    // Return only entries before the last seen
    return entries.slice(0, lastSeenIndex);
  }

  /**
   * Show notifications for new entries
   */
  private async showNotifications(task: PollingTask, entries: FeedEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // Group notification
    const severity = this.getGroupSeverity(entries);
    const severityEmoji = severity === 'error' ? '🔴' : severity === 'warning' ? '⚠️' : 'ℹ️';
    
    const message = `${severityEmoji} ${entries.length} new ${task.feedTitle} on ${task.systemId}`;
    
    const action = await window.showInformationMessage(message, 'View', 'Dismiss');
    if (action === 'View') {
      // Navigate to feed inbox and select this feed
      await commands.executeCommand('abapfs.showFeedInbox', {
        systemId: task.systemId,
        feedTitle: task.feedTitle
      });
    }
  }

  /**
   * Get group severity (highest severity in the group)
   */
  private getGroupSeverity(entries: FeedEntry[]): 'error' | 'warning' | 'info' {
    if (entries.some(e => e.severity === 'error')) return 'error';
    if (entries.some(e => e.severity === 'warning')) return 'warning';
    return 'info';
  }

  /**
   * Setup offline detection
   */
  private setupOfflineDetection(): void {
    // Monitor network connectivity using workspace.fs
    // If requests start failing consistently across multiple systems, pause polling
    
    let consecutiveFailures = 0;
    const checkInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(checkInterval);
        return;
      }

      // Count active polling tasks with recent errors
      let recentErrors = 0;
      for (const task of this.pollingTasks.values()) {
        const state = this.stateManager.getFeedState(task.systemId, task.feedTitle);
        if (state && state.errorCount > 0 && Date.now() - state.lastPollTime < 300000) {
          recentErrors++;
        }
      }

      // If majority of feeds are failing, assume offline
      const errorRate = recentErrors / Math.max(this.pollingTasks.size, 1);
      if (errorRate > 0.7) {
        consecutiveFailures++;
        
        if (consecutiveFailures >= 3 && !this.isPaused) {
          this.pause();
          
          window.showWarningMessage(
            'Feed polling paused due to connectivity issues. Polling will resume automatically when connection is restored.',
            'Resume Now'
          ).then(action => {
            if (action === 'Resume Now') {
              this.resume();
            }
          });
        }
      } else {
        consecutiveFailures = 0;
        
        // Resume if paused and errors cleared
        if (this.isPaused && errorRate < 0.2) {
          this.resume();
        }
      }
    }, 60000); // Check every minute

    this.context.subscriptions.push({ dispose: () => clearInterval(checkInterval) });
  }

  /**
   * Get polling statistics
   */
  getStatistics(): {
    totalTasks: number;
    activeTasks: number;
    pausedTasks: number;
    erroredTasks: number;
  } {
    let activeTasks = 0;
    let pausedTasks = 0;
    let erroredTasks = 0;

    for (const task of this.pollingTasks.values()) {
      if (task.isPolling) {
        activeTasks++;
      }
      
      const state = this.stateManager.getFeedState(task.systemId, task.feedTitle);
      if (state) {
        if (state.errorCount > 0) {
          erroredTasks++;
        }
      }
    }

    if (this.isPaused) {
      pausedTasks = this.pollingTasks.size - activeTasks;
    }

    return {
      totalTasks: this.pollingTasks.size,
      activeTasks,
      pausedTasks,
      erroredTasks
    };
  }
}

