import { ExtensionContext, Uri } from 'vscode';
import { FeedState, FeedStates, FeedEntry } from './feedTypes';
import { log } from '../../lib';
import * as fs from 'fs';
import * as path from 'path';

const FEED_STATES_KEY = 'abapfs.feedStates';
const FEED_ENTRIES_FILENAME = 'feedEntries.json';

/**
 * Manages persistent state for feeds (last-seen entries, error counts, etc.)
 */
export class FeedStateManager {
  private context: ExtensionContext;
  private feedStates: FeedStates = {};
  private feedEntries: Map<string, FeedEntry[]> = new Map(); // key: systemId|feedTitle
  private storageUri: Uri;

  constructor(context: ExtensionContext) {
    this.context = context;
    this.storageUri = context.globalStorageUri;
    this.ensureStorageExists();
    this.loadStates();
    this.loadEntries();
  }
  
  /**
   * Ensure storage directory exists
   */
  private ensureStorageExists(): void {
    const storagePath = this.storageUri.fsPath;
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }
  }
  
  /**
   * Get file path for feed entries storage
   */
  private getEntriesFilePath(): string {
    return path.join(this.storageUri.fsPath, FEED_ENTRIES_FILENAME);
  }

  /**
   * Load feed states from globalState
   */
  private loadStates(): void {
    const stored = this.context.globalState.get<FeedStates>(FEED_STATES_KEY);
    if (stored) {
      this.feedStates = stored;
    }
  }

  /**
   * Load feed entries from file storage
   */
  private loadEntries(): void {
    try {
      const filePath = this.getEntriesFilePath();
      
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        const stored = JSON.parse(data) as Record<string, FeedEntry[]>;
        
        // Convert timestamp strings back to Date objects and validate
        const entries = Object.entries(stored).map(([key, entryList]) => {
          const fixedEntries = entryList.map(entry => {
            // Ensure timestamp is a valid Date
            const timestamp = entry.timestamp 
              ? new Date(entry.timestamp) 
              : new Date();
            
            // Validate the date is valid
            if (isNaN(timestamp.getTime())) {
            }
            
            return {
              ...entry,
              timestamp,
              // Ensure required fields exist
              title: entry.title || 'Untitled',
              summary: entry.summary || '',
              systemId: entry.systemId || '',
              feedTitle: entry.feedTitle || ''
            };
          });
          return [key, fixedEntries] as [string, FeedEntry[]];
        });
        this.feedEntries = new Map(entries);
        
        const totalEntries = Array.from(this.feedEntries.values()).reduce((sum, list) => sum + list.length, 0);
      } else {
      }
    } catch (error) {
      this.feedEntries = new Map();
    }
  }

  /**
   * Save feed states to globalState
   */
  private async saveStates(): Promise<void> {
    await this.context.globalState.update(FEED_STATES_KEY, this.feedStates);
  }

  /**
   * Save feed entries to file storage
   */
  private async saveEntries(): Promise<void> {
    try {
      const filePath = this.getEntriesFilePath();
      const obj = Object.fromEntries(this.feedEntries);
      fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (error) {
    }
  }

  /**
   * Get feed state key
   */
  private getStateKey(systemId: string, feedTitle: string): string {
    return `${systemId}|${feedTitle}`;
  }

  /**
   * Get feed state
   */
  getFeedState(systemId: string, feedTitle: string): FeedState | undefined {
    const key = this.getStateKey(systemId, feedTitle);
    return this.feedStates[key];
  }

  /**
   * Update feed state
   */
  async updateFeedState(state: Partial<FeedState> & { systemId: string; feedTitle: string }): Promise<void> {
    const key = this.getStateKey(state.systemId, state.feedTitle);
    const existing = this.feedStates[key] || {
      systemId: state.systemId,
      feedTitle: state.feedTitle,
      feedPath: '',
      lastPollTime: 0,
      lastSeenEntryId: '',
      errorCount: 0,
      isAvailable: true
    };

    this.feedStates[key] = { ...existing, ...state };
    await this.saveStates();
  }

  /**
   * Update last poll time
   */
  async updateLastPoll(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      lastPollTime: Date.now()
    });
  }

  /**
   * Update last seen entry
   */
  async updateLastSeen(systemId: string, feedTitle: string, entryId: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      lastSeenEntryId: entryId
    });
  }

  /**
   * Increment error count
   */
  async incrementErrorCount(systemId: string, feedTitle: string, error: string): Promise<void> {
    const state = this.getFeedState(systemId, feedTitle);
    const errorCount = (state?.errorCount || 0) + 1;
    await this.updateFeedState({
      systemId,
      feedTitle,
      errorCount,
      lastError: error
    });
  }

  /**
   * Reset error count
   */
  async resetErrorCount(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      errorCount: 0,
      lastError: undefined
    });
  }

  /**
   * Mark feed as unavailable
   */
  async markFeedUnavailable(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      isAvailable: false
    });
  }

  /**
   * Mark feed as available
   */
  async markFeedAvailable(systemId: string, feedTitle: string): Promise<void> {
    await this.updateFeedState({
      systemId,
      feedTitle,
      isAvailable: true
    });
  }

  /**
   * Get all feed entries for a system/feed
   */
  getFeedEntries(systemId: string, feedTitle: string): FeedEntry[] {
    const key = this.getStateKey(systemId, feedTitle);
    return this.feedEntries.get(key) || [];
  }

  /**
   * Get all feed entries across all systems/feeds
   */
  getAllFeedEntries(): FeedEntry[] {
    const allEntries: FeedEntry[] = [];
    for (const entries of this.feedEntries.values()) {
      allEntries.push(...entries);
    }
    const sorted = allEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return sorted;
  }

  /**
   * Get unread entries for a system/feed
   */
  getUnreadEntries(systemId: string, feedTitle: string): FeedEntry[] {
    return this.getFeedEntries(systemId, feedTitle).filter(e => !e.isRead);
  }

  /**
   * Get all unread entries
   */
  getAllUnreadEntries(): FeedEntry[] {
    return this.getAllFeedEntries().filter(e => !e.isRead);
  }

  /**
   * Add new feed entries
   */
  async addFeedEntries(systemId: string, feedTitle: string, entries: FeedEntry[]): Promise<void> {
    
    const key = this.getStateKey(systemId, feedTitle);
    const existing = this.feedEntries.get(key) || [];
    
    // Merge new entries with existing (avoid duplicates)
    const entryMap = new Map<string, FeedEntry>();
    for (const entry of existing) {
      entryMap.set(entry.id, entry);
    }
    for (const entry of entries) {
      if (!entryMap.has(entry.id)) {
        entryMap.set(entry.id, entry);
      }
    }

    // Sort by timestamp (newest first)
    const allEntries = Array.from(entryMap.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    this.feedEntries.set(key, allEntries);
    
    await this.saveEntries();
  }

  /**
   * Mark entry as read
   */
  async markAsRead(systemId: string, feedTitle: string, entryId: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle);
    const entries = this.feedEntries.get(key);
    if (!entries) return;

    const entry = entries.find(e => e.id === entryId);
    if (entry) {
      entry.isRead = true;
      entry.isNew = false;
      await this.saveEntries();
    }
  }

  /**
   * Mark all entries as read for a feed
   */
  async markAllAsRead(systemId: string, feedTitle: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle);
    const entries = this.feedEntries.get(key);
    if (!entries) return;

    for (const entry of entries) {
      entry.isRead = true;
      entry.isNew = false;
    }
    await this.saveEntries();
  }

  /**
   * Mark all entries as read (all systems, all feeds)
   */
  async markAllEntriesAsRead(): Promise<void> {
    for (const entries of this.feedEntries.values()) {
      for (const entry of entries) {
        entry.isRead = true;
        entry.isNew = false;
      }
    }
    await this.saveEntries();
  }

  /**
   * Remove entry
   */
  async removeEntry(systemId: string, feedTitle: string, entryId: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle);
    const entries = this.feedEntries.get(key);
    if (!entries) return;

    const filtered = entries.filter(e => e.id !== entryId);
    this.feedEntries.set(key, filtered);
    await this.saveEntries();
  }

  /**
   * Clear all entries for a feed
   */
  async clearFeedEntries(systemId: string, feedTitle: string): Promise<void> {
    const key = this.getStateKey(systemId, feedTitle);
    this.feedEntries.delete(key);
    await this.saveEntries();
  }

  /**
   * Clear all entries (all systems, all feeds)
   */
  async clearAllEntries(): Promise<void> {
    this.feedEntries.clear();
    await this.saveEntries();
  }

  /**
   * Get feed statistics
   */
  getStatistics(): { totalEntries: number; unreadEntries: number; newEntries: number } {
    const allEntries = this.getAllFeedEntries();
    return {
      totalEntries: allEntries.length,
      unreadEntries: allEntries.filter(e => !e.isRead).length,
      newEntries: allEntries.filter(e => e.isNew).length
    };
  }

  /**
   * Get statistics for a specific feed
   */
  getFeedStatistics(systemId: string, feedTitle: string): { total: number; unread: number; new: number } {
    const entries = this.getFeedEntries(systemId, feedTitle);
    return {
      total: entries.length,
      unread: entries.filter(e => !e.isRead).length,
      new: entries.filter(e => e.isNew).length
    };
  }

  /**
   * Check if entry is new (not seen before)
   */
  isNewEntry(systemId: string, feedTitle: string, entryId: string): boolean {
    const state = this.getFeedState(systemId, feedTitle);
    if (!state) return true;
    
    // Entry is new if we haven't seen it before
    return state.lastSeenEntryId !== entryId;
  }
}

