/**
 * Shared utilities and types for ABAP Language Model Tools
 */


/**
 * Enhancement types and interfaces
 */
export interface EnhancementInfo {
  name: string;
  startLine: number;
  type: string; // e.g., 'ENHANCEMENT'
  code?: string; // Only included if needCode = true
  uri?: string; // SAP enhancement URI for separate access
}

export interface EnhancementResult {
  hasEnhancements: boolean;
  enhancements: EnhancementInfo[];
  totalEnhancements?: number;
}

/**
 * 🔧 UTILITY: Get optimal URI path based on object type
 * Uses our research findings to determine whether XML metadata is sufficient
 * or if /source/main is needed for actual source code
 */
export function getOptimalObjectURI(objectType: string, baseUri: string): string {
  // Object types where XML metadata contains all needed information
  const metadataOnlyTypes = ['DTEL/DE', 'DOMA/DD', 'TTYP/DA'];
  
  // Object types that require actual source code via /source/main
  const sourceRequiredTypes = ['CLAS/OC', 'FUNC/FF', 'PROG/P', 'INTF/OI', 'TABL/TA'];
  
  if (metadataOnlyTypes.includes(objectType)) {
    // XML has all the info we need - no /source/main needed
    return baseUri;
  } else if (sourceRequiredTypes.includes(objectType)) {
    // Need actual source code
    const sourceUri = baseUri.endsWith('/source/main') ? baseUri : `${baseUri}/source/main`;
    return sourceUri;
  } else {
    // Unknown type - try /source/main as fallback
    const sourceUri = baseUri.endsWith('/source/main') ? baseUri : `${baseUri}/source/main`;
    return sourceUri;
  }
}

/**
 * 🔧 UTILITY: Resolve correct URI path using findObjectPath
 */
export async function resolveCorrectURI(originalUri: string, connectionId: string): Promise<string> {
  try {
    
    const { getClient } = await import('../../adt/conections');
    const client = getClient(connectionId);
    
    const pathSteps = await client.findObjectPath(originalUri);
    
    if (pathSteps && pathSteps.length > 0) {
      // Use the last path step's URI as it should be the most specific/correct
      const lastStep = pathSteps[pathSteps.length - 1];
      const resolvedUri = lastStep['adtcore:uri'] || originalUri;
      
      if (resolvedUri !== originalUri) {
      }
      
      return resolvedUri;
    } else {
     // logCommands.warn(`⚠️ No path steps found for URI: ${originalUri}`);
      return originalUri;
    }
  } catch (pathError) {
   // logCommands.warn(`⚠️ Path resolution failed for ${originalUri}: ${pathError}`);
    return originalUri; // Fallback to original
  }
}


interface CachedEnhancementResult {
  result: EnhancementResult;
  timestamp: number;
  needCode: boolean;
}

const enhancementCache = new Map<string, CachedEnhancementResult>();
const ENHANCEMENT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_SIZE = 1000; // Prevent unlimited growth

setInterval(() => {
  const now = Date.now();
  const entriesToDelete: string[] = [];
  
  // First pass: Remove expired entries
  for (const [key, cached] of enhancementCache.entries()) {
    if (now - cached.timestamp > ENHANCEMENT_CACHE_TTL) {
      entriesToDelete.push(key);
    }
  }
  
  // Delete expired entries
  for (const key of entriesToDelete) {
    enhancementCache.delete(key);
  }
  
  // Second pass: If still too large, remove oldest entries
  if (enhancementCache.size > MAX_CACHE_SIZE) {
    const sortedEntries = Array.from(enhancementCache.entries())
      .sort(([,a], [,b]) => a.timestamp - b.timestamp);
    
    const toRemove = sortedEntries.slice(0, enhancementCache.size - MAX_CACHE_SIZE);
    for (const [key] of toRemove) {
      enhancementCache.delete(key);
    }
  }
}, 5 * 60 * 1000); // Cleanup every 5 minutes

/**
 * Get enhancement information for an ABAP object using SAP's enhancement APIs
 * Called from language model tools, search tools, and editor decorations
 */
export async function getObjectEnhancements(
  objectUriOrPath: string, 
  connectionId: string, 
  needCode: boolean = false
): Promise<EnhancementResult> {
  try {
    
    const cacheKey = `${connectionId}:${objectUriOrPath}:${needCode}`;
    const cached = enhancementCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < ENHANCEMENT_CACHE_TTL) {
      // Cache hit - return cached result
      return cached.result;
    }
    
    const { getClient } = await import('../../adt/conections');
    const client = getClient(connectionId);
    
    // Ensure we have a proper source/main path
    let sourceMainPath = objectUriOrPath;
    if (!sourceMainPath.includes('/source/main')) {
      if (sourceMainPath.endsWith('/source/main')) {
        // Already has /source/main
      } else {
        // Add /source/main to the path
        sourceMainPath = sourceMainPath.endsWith('/') ? 
          `${sourceMainPath}source/main` : 
          `${sourceMainPath}/source/main`;
      }
    }
    
    const result: EnhancementResult = {
      hasEnhancements: false,
      enhancements: [],
      totalEnhancements: 0
    };
    
    try {
      // Step 3: Get enhancement names and source code from elements endpoint
      let enhancementDetails: Array<{name: string, code?: string, startLine?: number, endLine?: number, uri?: string}> = [];
      
      try {
        const enhancementsUri = `${sourceMainPath}/enhancements/elements`;
       // logCommands.debug(`🔍 Calling enhancements API: ${enhancementsUri}`);
        
        const enhancementsResponse = await client.httpClient.request(enhancementsUri, {
          headers: {
            'Accept': 'application/vnd.sap.adt.enhancements.v3+xml'
          }
        });
        const enhancementsData = enhancementsResponse.body;
        
        if (enhancementsData && enhancementsData.trim().length > 0) {
          // Parse the enhancement elements XML to extract names and encoded source
          const elementMatches = enhancementsData.match(/<enh:elements[^>]*>(.*?)<\/enh:elements>/gs);
          
          if (elementMatches) {
            for (const elementMatch of elementMatches) {
              // Extract enhancement name
              const nameMatch = elementMatch.match(/enh:full_name="([^"]+)"/);
              // Extract enhancement URI from enh:uri attribute
              const uriMatch = elementMatch.match(/enh:uri="([^"]+)"/);
              
              if (nameMatch) {
                const enhancementName = nameMatch[1];
                const enhancementUri = uriMatch ? uriMatch[1] : '';
                let enhancementCode: string | undefined;
                let startLine = 0;
                
                // Extract position information from the <enh:position> element within <enh:option>
                const positionMatch = elementMatch.match(/<enh:position[^>]*adtcore:uri="[^"]*#start=(\d+),\d+"[^>]*\/>/);
                if (positionMatch) {
                  startLine = parseInt(positionMatch[1], 10);
                }
                
                if (needCode) {
                  // Extract and decode source code if requested
                  const sourceMatch = elementMatch.match(/<enh:source>([A-Za-z0-9+\/=\s]+)<\/enh:source>/);
                  if (sourceMatch) {
                    const encodedSource = sourceMatch[1].replace(/\s/g, ''); // Remove whitespace
                    try {
                      enhancementCode = Buffer.from(encodedSource, 'base64').toString('utf8');
                     // logCommands.debug(`✅ Decoded enhancement ${enhancementName}: ${enhancementCode.length} chars`);
                    } catch (decodeError) {
                     // logCommands.warn(`⚠️ Failed to decode enhancement ${enhancementName}: ${decodeError}`);
                    }
                  }
                }
                
                enhancementDetails.push({
                  name: enhancementName,
                  code: enhancementCode,
                  startLine: startLine,
                  uri: enhancementUri
                });
              }
            }
          }
        }
      } catch (enhError) {
        //logCommands.warn(`⚠️ Enhancement elements API failed: ${enhError}`);
        // Continue without enhancement details
      }
      
      if (enhancementDetails.length === 0) {
       // logCommands.debug(`ℹ️ No enhancement details found`);
        return result;
      }
      
      // Step 4: Build result by combining positions with enhancement details
      result.hasEnhancements = enhancementDetails.length > 0;
      result.totalEnhancements = enhancementDetails.length;
      
      // Use line numbers directly from enhancement details (from elements response)
      result.enhancements = enhancementDetails.map((detail) => {
        return {
          name: detail.name,
          startLine: detail.startLine || 0,
          type: 'ENHANCEMENT',
          code: detail.code,
          uri: detail.uri
        };
      });
      
     // logCommands.debug(`✅ Enhancement processing complete: ${result.totalEnhancements} enhancements found`);
         
     enhancementCache.set(cacheKey, {
      result,
      timestamp: now,
      needCode
    });
     return result;
      
    } catch (apiError) {
     // logCommands.debug(`ℹ️ Enhancement APIs not available: ${apiError}`);
      return result; // Return empty result
    }
    
  } catch (error) {
   // logCommands.error(`❌ Error getting enhancements: ${error}`);
    return {
      hasEnhancements: false,
      enhancements: [],
      totalEnhancements: 0
    };
  }
}
