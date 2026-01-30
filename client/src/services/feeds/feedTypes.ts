import { Feed } from 'abap-adt-api';

/**
 * Feed subscription configuration per system per feed
 */
export interface FeedSubscriptionConfig {
  enabled: boolean;
  pollingInterval: number; // seconds (120 - 86400)
  notifications: boolean;
  query?: string; // Custom query string
  useDefaultQuery: boolean;
}

/**
 * All feed subscriptions per system
 */
export interface SystemFeedConfig {
  [feedTitle: string]: FeedSubscriptionConfig;
}

/**
 * VS Code settings structure for all systems
 */
export interface FeedSubscriptions {
  [systemId: string]: SystemFeedConfig;
}

/**
 * Feed state tracking (persisted in globalState)
 */
export interface FeedState {
  systemId: string;
  feedTitle: string;
  feedPath: string;
  lastPollTime: number; // timestamp
  lastSeenEntryId: string;
  errorCount: number;
  lastError?: string;
  isAvailable: boolean; // false if feed disappeared after system upgrade
}

/**
 * All feed states (persisted)
 */
export interface FeedStates {
  [key: string]: FeedState; // key: systemId|feedTitle
}

/**
 * Generic feed entry (common fields across all feed types)
 */
export interface FeedEntry {
  id: string;
  systemId: string;
  feedTitle: string;
  feedPath: string;
  feedType: FeedType;
  timestamp: Date;
  title: string;
  summary: string;
  author?: string;
  category?: string;
  severity?: 'error' | 'warning' | 'info';
  isNew: boolean;
  isRead: boolean;
  rawData: any; // Original feed entry data
}

/**
 * Feed type enumeration
 */
export enum FeedType {
  DUMPS = 'dumps',
  ATC = 'atc',
  GATEWAY_ERROR = 'gateway_error',
  SYSTEM_MESSAGES = 'system_messages',
  URI_ERRORS = 'uri_errors',
  RAP_CONTRACT = 'rap_contract',
  EEE_ERROR = 'eee_error',
  UNKNOWN = 'unknown'
}

/**
 * Feed metadata with discovery information
 */
export interface FeedMetadata extends Feed {
  feedType: FeedType;
  defaultQuery?: string;
}

/**
 * Polling task tracking
 */
export interface PollingTask {
  systemId: string;
  feedTitle: string;
  feedPath: string;
  config: FeedSubscriptionConfig;
  nextPollTime: number; // timestamp
  isPolling: boolean;
  timeoutHandle?: NodeJS.Timeout;
}

/**
 * Notification group for batched notifications
 */
export interface FeedNotificationGroup {
  systemId: string;
  feedTitle: string;
  count: number;
  entries: FeedEntry[];
  severity: 'error' | 'warning' | 'info';
}

/**
 * Feed statistics for UI display
 */
export interface FeedStatistics {
  totalFeeds: number;
  enabledFeeds: number;
  totalEntries: number;
  unreadEntries: number;
  erroredFeeds: number;
}

/**
 * Message types for webview communication
 */
export interface WebviewMessage {
  command: string;
  data?: any;
}

export interface LoadSystemsMessage extends WebviewMessage {
  command: 'loadSystems';
}

export interface LoadFeedsMessage extends WebviewMessage {
  command: 'loadFeeds';
  data: {
    systemId: string;
  };
}

export interface SaveConfigMessage extends WebviewMessage {
  command: 'saveConfig';
  data: {
    systemId: string;
    config: SystemFeedConfig;
  };
}

export interface BulkActionMessage extends WebviewMessage {
  command: 'bulkAction';
  data: {
    systemId: string;
    action: 'enableAll' | 'disableAll' | 'resetDefaults';
  };
}

/**
 * Webview state
 */
export interface WebviewState {
  systems: string[];
  selectedSystem?: string;
  feeds: FeedMetadata[];
  config: SystemFeedConfig;
  loading: boolean;
  error?: string;
}

