/**
 * ABAP Object Search Service
 */

import { getClient } from "../adt/conections";
import { logSearch } from './abapCopilotLogger';

// Export interfaces for compatibility (simplified for line-based access)
export interface ABAPObjectInfo {
  name: string;
  type: string;
  description: string;
  package: string;
  systemType: 'STANDARD' | 'CUSTOM';
  lastModified?: Date;
  uri?: string;
  details?: any;
  
}

export class searchService {
  private connectionId: string;

  constructor(connectionId: string) {
    this.connectionId = connectionId;
  }

  /**
   * Search for ABAP objects by pattern - Direct ADT search
   */
  async searchObjects(
    pattern: string, 
    types?: string[], 
    maxResults: number = 50
  ): Promise<ABAPObjectInfo[]> {
    
    try {
      const client = getClient(this.connectionId);
      const searchPattern = pattern.toUpperCase();
      const results: ABAPObjectInfo[] = [];
      
      // Determine which types to search
      const searchTypes = types && types.length > 0 ? types : [
        'FUNC',  // Function Modules
        'CLAS',  // Classes
        'TABL',  // Database Tables
        'PROG',  // Reports/Programs
        'INTF',  // Interfaces
        'DTEL',  // Data Elements
        'DDLS',  // CDS Views
        'DOMA',  // Domains
        'TTYP',  // Table Types
        'ENQU',  // Lock Objects
        'MSAG',  // Message Classes
        'FUGR',  // Function Groups
        'DEVC',  // Packages
        'TRAN',  // Transactions
        'VIEW',  // Views
        'SICF',  // ICF Services
        'WDYN',  // Web Dynpro Components
        'SPRX',  // Proxies
        'XSLT',  // XSLT Programs
        'TRANSFORMATIONS', // Simple Transformations
        'SUSH',  // Authorization Objects
        'SUSC',  // Authorization Object Classes
        'PINF',  // Package Interfaces
        'ENHC',  // Enhancement Implementations
        'ENHS',  // Enhancement Spots
        'BADI',  // BAdI Definitions
        'BADII', // BAdI Implementations
        'SAMC',  // AMC Classes
        'SAPC',  // APC Classes
        'SFSW',  // Switch Framework
        'SFBF',  // Business Functions
        'SFBS',  // Business Function Sets
        'JOBD',  // Job Definitions
        'NROB',  // Number Range Objects
      ];
      
      
      for (const type of searchTypes) {
        try {
          const searchResults = await client.searchObject(searchPattern, type);
          for (const result of searchResults.slice(0, maxResults)) {
            const objName = result['adtcore:name'];
            const objType = result['adtcore:type'];
            
            if (objName && objType) {
              const objectInfo: ABAPObjectInfo = {
                name: objName,
                type: objType,
                description: result['adtcore:description'] || '',
                package: result['adtcore:packageName'] || '',
                systemType: this.determineSystemType(objName),
                uri: result['adtcore:uri'] || ''
              };
              results.push(objectInfo);
              
              if (results.length >= maxResults) break;
            }
          }
          
          if (results.length >= maxResults) break;
          
        } catch (error) {
          // Skip types that fail
        }
      }
      
      return results;
      
    } catch (error) {
      logSearch.error('Error searching objects', error);
      return [];
    }
  }

  /**
   * Determine if object is standard or custom
   */
  private determineSystemType(name: string): 'STANDARD' | 'CUSTOM' {
    return (name.startsWith('Z') || name.startsWith('Y')) ? 'CUSTOM' : 'STANDARD';
  }

}

// Global search instances
const search = new Map<string, searchService>();

export function getSearchService(connectionId: string): searchService {
  if (!search.has(connectionId)) {
    search.set(connectionId, new searchService(connectionId));
  }
  return search.get(connectionId)!;
}
