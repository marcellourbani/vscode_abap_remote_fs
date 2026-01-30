/**
 * SAP System Information Service
 * Retrieves comprehensive system information from SAP tables
 * Includes caching to avoid repeated queries to SAP
 */

// ============================================================================
// INTERFACES
// ============================================================================

export interface SAPClientInfo {
  clientNumber: string;
  clientName: string;
  category: string;
  logicalSystem: string;
  changeProtection: string;
}

export type SAPSystemType = 'S/4HANA' | 'ECC' | 'Unknown';

export interface SAPSoftwareComponent {
  component: string;
  release: string;
  extRelease: string;
  componentType: string;
}

export interface SAPSystemInfo {
  sapRelease: string;
  systemType: SAPSystemType;
  currentClient: SAPClientInfo | null;
  softwareComponents: SAPSoftwareComponent[];
  queryTimestamp: string;
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

interface CachedSystemInfo {
  data: SAPSystemInfo;
  timestamp: number;
}

// Cache store: "baseUrl|client" -> cached data
// Using URL + client as key because connectionId is just a user label that can change
const systemInfoCache = new Map<string, CachedSystemInfo>();

// Default TTL: 24 hours in milliseconds
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Generate cache key from URL and client
 */
function getCacheKey(url: string, client: string): string {
  // Normalize URL: lowercase, remove trailing slash
  const normalizedUrl = url.toLowerCase().replace(/\/$/, '');
  return `${normalizedUrl}|${client}`;
}

/**
 * Clear the system info cache
 * Called on extension deactivation to free memory
 */
export function clearSystemInfoCache(): void {
  systemInfoCache.clear();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get client category description
 */
function getClientCategoryDescription(category: string): string {
  const categories: Record<string, string> = {
    'P': 'Production',
    'T': 'Test',
    'C': 'Customizing',
    'D': 'Demo',
    'E': 'Education/Training',
    'S': 'SAP Reference',
    '': 'Not Classified'
  };
  return categories[category] || category || 'Unknown';
}

/**
 * Get change protection description
 */
function getChangeProtectionDescription(indicator: string): string {
  const protections: Record<string, string> = {
    '0': 'Changes allowed (no protection)',
    '1': 'No changes allowed',
    '2': 'No changes allowed, no transports allowed',
    '': 'No protection'
  };
  return protections[indicator] || indicator || 'Unknown';
}

/**
 * Detect SAP system type based on software components
 * S/4HANA has S4CORE or S4COREOP components
 * ECC has SAP_APPL component but no S4CORE
 */
function detectSystemType(components: SAPSoftwareComponent[]): SAPSystemType {
  const hasS4Core = components.some(c => 
    c.component === 'S4CORE' || c.component === 'S4COREOP'
  );
  
  if (hasS4Core) {
    return 'S/4HANA';
  }
  
  // Check for ECC indicators
  const hasSapAppl = components.some(c => c.component === 'SAP_APPL');
  const hasSapBasis = components.some(c => c.component === 'SAP_BASIS');
  
  if (hasSapAppl || hasSapBasis) {
    return 'ECC';
  }
  
  return 'Unknown';
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Get comprehensive SAP system information (with caching)
 * Cache TTL is 4 hours. Use clearSystemInfoCache() to force refresh.
 * @param connectionId - The SAP connection ID (e.g., 'dev100')
 * @param includeComponents - Whether to include full software component list (default: false)
 * @returns SAPSystemInfo object with system details
 */
export async function getSAPSystemInfo(
  connectionId: string,
  includeComponents: boolean = false
): Promise<SAPSystemInfo> {
  // Import dependencies
  const { getClient } = await import('../adt/conections');
  const { RemoteManager } = await import('../config');
  
  // Get client and config
  const client = getClient(connectionId);
  if (!client) {
    throw new Error(`No client found for connection: ${connectionId}`);
  }
  
  const connectionConfig = RemoteManager.get().byId(connectionId);
  if (!connectionConfig) {
    throw new Error(`Connection configuration not found for: ${connectionId}`);
  }
  
  const url = connectionConfig.url || '';
  const currentClientNumber = connectionConfig.client || '';
  
  // Check cache first
  const cacheKey = getCacheKey(url, currentClientNumber);
  const now = Date.now();
  
  const cached = systemInfoCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < DEFAULT_CACHE_TTL_MS) {
    // Return cached data, filtering components based on request
    const cachedResult = { ...cached.data };
    if (!includeComponents) {
      cachedResult.softwareComponents = [];
    }
    return cachedResult;
  }
  
  // Fetch fresh data from SAP
  const result: SAPSystemInfo = {
    sapRelease: '',
    systemType: 'Unknown',
    currentClient: null,
    softwareComponents: [],
    queryTimestamp: new Date().toISOString()
  };

  // Query T000 - Client Information (only current client)
  try {
    // Pad client number to 3 digits with leading zeros
    const paddedClient = currentClientNumber.padStart(3, '0');
    const t000Sql = `SELECT MANDT, MTEXT, CCCATEGORY, LOGSYS, CCNOCLIIND FROM T000 WHERE MANDT = '${paddedClient}'`;
    const t000Result = await client.runQuery(t000Sql, 1, true);
    
    if (t000Result && t000Result.values && Array.isArray(t000Result.values) && t000Result.values.length > 0) {
      const row = t000Result.values[0];
      result.currentClient = {
        clientNumber: row.MANDT || '',
        clientName: row.MTEXT || '',
        category: getClientCategoryDescription(row.CCCATEGORY),
        logicalSystem: row.LOGSYS || '',
        changeProtection: getChangeProtectionDescription(row.CCNOCLIIND)
      };
    }
  } catch (error) {
    console.warn('Failed to query T000:', error);
  }

  // Query CVERS - Software Component Versions
  try {
    const cversSql = `SELECT COMPONENT, RELEASE, EXTRELEASE, COMP_TYPE FROM CVERS`;
    const cversResult = await client.runQuery(cversSql, 500, true);
    
    if (cversResult && cversResult.values && Array.isArray(cversResult.values)) {
      const allComponents = cversResult.values.map((row: any) => ({
        component: row.COMPONENT || '',
        release: row.RELEASE || '',
        extRelease: row.EXTRELEASE || '',
        componentType: row.COMP_TYPE || ''
      }));
      
      // Always detect system type based on software components
      result.systemType = detectSystemType(allComponents);
      
      // Always store full component list (for caching)
      result.softwareComponents = allComponents;
    }
  } catch (error) {
    console.warn('Failed to query CVERS:', error);
  }

  // Query SVERS - SAP Release
  try {
    const sversSql = `SELECT VERSION FROM SVERS`;
    const sversResult = await client.runQuery(sversSql, 10, true);
    
    if (sversResult && sversResult.values && Array.isArray(sversResult.values) && sversResult.values.length > 0) {
      result.sapRelease = sversResult.values[0].VERSION || '';
    }
  } catch (error) {
    console.warn('Failed to query SVERS:', error);
  }

  // Store in cache (always with full data)
  systemInfoCache.set(cacheKey, {
    data: result,
    timestamp: now
  });

  // Return with or without components based on request
  if (!includeComponents) {
    return { ...result, softwareComponents: [] };
  }
  
  return result;
}

/**
 * Format SAP System Info as readable text for LLM consumption
 */
export function formatSAPSystemInfoAsText(info: SAPSystemInfo): string {
  let output = '';
  
  output += `📊 SAP SYSTEM INFORMATION\n`;
  output += `${'='.repeat(60)}\n`;
  output += `Query Timestamp: ${info.queryTimestamp}\n`;
  output += `System Type: ${info.systemType}\n\n`;

  // SAP Release
  if (info.sapRelease) {
    output += `🔖 SAP RELEASE\n`;
    output += `${'-'.repeat(40)}\n`;
    output += `Version: ${info.sapRelease}\n\n`;
  }

  // Current Client
  if (info.currentClient) {
    output += `🏢 CURRENT CLIENT (from T000)\n`;
    output += `${'-'.repeat(40)}\n`;
    output += `• Client ${info.currentClient.clientNumber}: ${info.currentClient.clientName}\n`;
    output += `  - Category: ${info.currentClient.category}\n`;
    output += `  - Logical System: ${info.currentClient.logicalSystem || 'N/A'}\n`;
    output += `  - Change Protection: ${info.currentClient.changeProtection}\n`;
    output += '\n';
  } else {
    output += `🏢 CURRENT CLIENT: No client information available\n\n`;
  }

  // Software Components (only shown if included)
  if (info.softwareComponents.length > 0) {
    output += `📦 SOFTWARE COMPONENTS (from CVERS)\n`;
    output += `${'-'.repeat(40)}\n`;
    output += `Total Components: ${info.softwareComponents.length}\n\n`;
    
    // Group by component type if available
    const sapBasis = info.softwareComponents.find(c => c.component === 'SAP_BASIS');
    if (sapBasis) {
      output += `SAP_BASIS: ${sapBasis.release} (SP ${sapBasis.extRelease || 'N/A'})\n`;
    }
    
    // Show key components first
    const keyComponents = ['SAP_BASIS', 'SAP_ABA', 'SAP_GWFND', 'SAP_UI', 'SAP_BW', 'S4CORE', 'S4COREOP'];
    const foundKey = info.softwareComponents.filter(c => keyComponents.includes(c.component));
    
    if (foundKey.length > 0) {
      output += `\nKey Components:\n`;
      foundKey.forEach(comp => {
        output += `• ${comp.component}: ${comp.release} (SP ${comp.extRelease || 'N/A'})\n`;
      });
    }
    
    // List remaining components
    const otherComponents = info.softwareComponents.filter(c => !keyComponents.includes(c.component));
    if (otherComponents.length > 0 && otherComponents.length <= 20) {
      output += `\nOther Components:\n`;
      otherComponents.forEach(comp => {
        output += `• ${comp.component}: ${comp.release}\n`;
      });
    } else if (otherComponents.length > 20) {
      output += `\n... and ${otherComponents.length} other components\n`;
    }
  }
  // Don't show "no components" message - they just weren't requested

  return output;
}
