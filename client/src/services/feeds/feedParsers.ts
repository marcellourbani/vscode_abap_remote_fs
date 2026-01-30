import { FeedEntry, FeedType, FeedMetadata } from './feedTypes';
import { Feed } from 'abap-adt-api';
import { log } from '../../lib';

/**
 * Determine feed type from feed metadata
 */
export function determineFeedType(feed: Feed): FeedType {
  const path = feed.href.toLowerCase();
  
  if (path.includes('/runtime/dumps')) {
    return FeedType.DUMPS;
  } else if (path.includes('/atc/feeds/verdicts')) {
    return FeedType.ATC;
  } else if (path.includes('/gw/errorlog')) {
    return FeedType.GATEWAY_ERROR;
  } else if (path.includes('/runtime/systemmessages')) {
    return FeedType.SYSTEM_MESSAGES;
  } else if (path.includes('/error/urimapper')) {
    return FeedType.URI_ERRORS;
  } else if (path.includes('/bo/feeds/ccviolations')) {
    return FeedType.RAP_CONTRACT;
  } else if (path.includes('/eee/errorlog')) {
    return FeedType.EEE_ERROR;
  }
  
  return FeedType.UNKNOWN;
}

/**
 * Get default query for feed
 */
export function getDefaultQuery(feed: Feed): string | undefined {
  if (feed.queryVariants && feed.queryVariants.length > 0) {
    const defaultVariant = feed.queryVariants.find(qv => qv.isDefault);
    return defaultVariant?.queryString || feed.queryVariants[0]?.queryString;
  }
  return undefined;
}

/**
 * Convert Feed to FeedMetadata
 */
export function toFeedMetadata(feed: Feed): FeedMetadata {
  return {
    ...feed,
    feedType: determineFeedType(feed),
    defaultQuery: getDefaultQuery(feed)
  };
}

/**
 * Parse raw feed entry to FeedEntry
 */
export function parseFeedEntry(
  rawEntry: any,
  systemId: string,
  feedTitle: string,
  feedPath: string,
  feedType: FeedType
): FeedEntry {
  // Extract title (for dumps, use category term)
  let title = rawEntry.title || 'Untitled';
  
  // For dumps, always try to get the runtime error name from categories
  if (feedType === FeedType.DUMPS && rawEntry.categories && Array.isArray(rawEntry.categories) && rawEntry.categories.length > 0) {
    // Find the category with label "ABAP runtime error" and use its term
    const runtimeError = rawEntry.categories.find((c: any) => c.label === "ABAP runtime error");
    if (runtimeError?.term) {
      title = runtimeError.term;
    } else {
      // Fallback to first category's term
      title = rawEntry.categories[0].term || rawEntry.categories[0].label || title;
    }
  }
  
  const entry: FeedEntry = {
    id: rawEntry.id || `${systemId}-${feedTitle}-${Date.now()}`,
    systemId,
    feedTitle,
    feedPath,
    feedType,
    timestamp: parseDate(rawEntry.updated || rawEntry.published),
    title,
    summary: extractSummary(rawEntry),
    author: rawEntry.author?.name || rawEntry.author,
    category: extractCategory(rawEntry),
    severity: determineSeverity(rawEntry, feedType),
    isNew: true,
    isRead: false,
    rawData: rawEntry
  };

  return entry;
}

/**
 * Parse date from various formats
 */
function parseDate(dateStr: any): Date {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  
  try {
    return new Date(dateStr);
  } catch {
    return new Date();
  }
}

/**
 * Extract summary text from feed entry
 */
function extractSummary(rawEntry: any): string {
  // Try summary field first
  if (rawEntry.summary) {
    if (typeof rawEntry.summary === 'string') {
      return rawEntry.summary;
    } else if (rawEntry.summary['#text']) {
      return rawEntry.summary['#text'];
    } else if (rawEntry.summary.text) {
      return rawEntry.summary.text;
    }
  }
  
  // Try content field
  if (rawEntry.content !== undefined && typeof rawEntry.content === 'string') {
    const str = String(rawEntry.content);
    if (str !== undefined && typeof str === 'string') {
      return str.replace(/<[^>]*>/g, '').substring(0, 200);
    }
  }
  
  // For dumps: extract from text field (contains HTML)
  if (rawEntry.text !== undefined && typeof rawEntry.text === 'string') {
    const str = String(rawEntry.text);
    if (str !== undefined && typeof str === 'string') {
      const plainText = str.replace(/<[^>]*>/g, '').trim();
      return plainText.substring(0, 200);
    }
  }
  
  return '';
}

/**
 * Extract category from feed entry
 */
function extractCategory(rawEntry: any): string | undefined {
  if (rawEntry.category) {
    if (Array.isArray(rawEntry.category)) {
      return rawEntry.category[0]?.term || rawEntry.category[0]?.label;
    } else if (typeof rawEntry.category === 'object') {
      return rawEntry.category.term || rawEntry.category.label;
    } else if (typeof rawEntry.category === 'string') {
      return rawEntry.category;
    }
  }
  return undefined;
}

/**
 * Determine severity from entry and feed type
 */
function determineSeverity(rawEntry: any, feedType: FeedType): 'error' | 'warning' | 'info' {
  // For dumps - always error
  if (feedType === FeedType.DUMPS) {
    return 'error';
  }
  
  // For ATC - check priority
  if (feedType === FeedType.ATC) {
    const priority = rawEntry.priority || 3;
    if (priority === 1) return 'error';
    if (priority === 2) return 'warning';
    return 'info';
  }
  
  // For gateway/EEE errors - always error
  if (feedType === FeedType.GATEWAY_ERROR || feedType === FeedType.EEE_ERROR) {
    return 'error';
  }
  
  // For system messages - check severity in content
  if (feedType === FeedType.SYSTEM_MESSAGES) {
    const summary = extractSummary(rawEntry).toLowerCase();
    if (summary.includes('error') || summary.includes('failed')) {
      return 'error';
    }
    if (summary.includes('warning') || summary.includes('warn')) {
      return 'warning';
    }
  }
  
  // Default to info
  return 'info';
}

/**
 * Parse feed response based on feed type
 */
export function parseFeedResponse(
  feedData: any,
  systemId: string,
  feedTitle: string,
  feedPath: string,
  feedType: FeedType
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  
  
  try {
    // Handle different response structures
    let rawEntries: any[] = [];
    
    // Check for direct array FIRST (before checking .entries property, which exists on arrays!)
    if (Array.isArray(feedData)) {
      rawEntries = feedData;
    } else if (feedData.dumps) {
      rawEntries = feedData.dumps;
    } else if (feedData.entries) {
      rawEntries = feedData.entries;
    } else if (feedData.entry) {
      rawEntries = Array.isArray(feedData.entry) ? feedData.entry : [feedData.entry];
    } else {
      // Unknown structure
      return entries;
    }
    
    
    // Ensure rawEntries is iterable
    if (!Array.isArray(rawEntries)) {
      return entries;
    }
    
    
    for (let i = 0; i < rawEntries.length; i++) {
      try {
        const rawEntry = rawEntries[i];
        const entry = parseFeedEntry(rawEntry, systemId, feedTitle, feedPath, feedType);
        entries.push(entry);
      } catch (entryError) {
      }
    }
    
  } catch (error) {
  }
  
  return entries;
}

/**
 * Get icon for feed type
 */
export function getFeedTypeIcon(feedType: FeedType): string {
  switch (feedType) {
    case FeedType.DUMPS:
      return '$(error)';
    case FeedType.ATC:
      return '$(check)';
    case FeedType.GATEWAY_ERROR:
      return '$(globe)';
    case FeedType.SYSTEM_MESSAGES:
      return '$(info)';
    case FeedType.URI_ERRORS:
      return '$(link)';
    case FeedType.RAP_CONTRACT:
      return '$(shield)';
    case FeedType.EEE_ERROR:
      return '$(pulse)';
    default:
      return '$(rss)';
  }
}

/**
 * Get severity icon
 */
export function getSeverityIcon(severity: 'error' | 'warning' | 'info'): string {
  switch (severity) {
    case 'error':
      return '$(error)';
    case 'warning':
      return '$(warning)';
    case 'info':
      return '$(info)';
  }
}

/**
 * Get human-readable feed type name
 */
export function getFeedTypeName(feedType: FeedType): string {
  switch (feedType) {
    case FeedType.DUMPS:
      return 'Runtime Errors';
    case FeedType.ATC:
      return 'ATC Findings';
    case FeedType.GATEWAY_ERROR:
      return 'Gateway Errors';
    case FeedType.SYSTEM_MESSAGES:
      return 'System Messages';
    case FeedType.URI_ERRORS:
      return 'URI Errors';
    case FeedType.RAP_CONTRACT:
      return 'RAP Contract Violations';
    case FeedType.EEE_ERROR:
      return 'EEE Errors';
    default:
      return 'Unknown';
  }
}

