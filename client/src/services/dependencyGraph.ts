import * as vscode from 'vscode';
import { funWindow as window } from './funMessenger';
import { getClient } from '../adt/conections';
import { caughtToString, log } from '../lib';
import { UsageReference } from 'abap-adt-api';
import { WebviewManager } from './webviewManager';

export interface GraphNode {
    id: string;
    name: string;
    type: string;
    description?: string;
    isRoot?: boolean;
    isCustom?: boolean; // Z* or Y*
    responsible?: string; // Who owns this object
    package?: string; // Package name
    packageUri?: string; // Package URI
    canExpand?: boolean; // Can fetch more dependencies
    uri?: string; // ADT URI for opening
    line?: number; // Line number where used
    column?: number; // Column where used
    objectIdentifier?: string; // For on-demand snippet fetching
    parentClass?: string; // For methods, the parent class name (for filtering)
    parentUri?: string; // Parent URI from reference
    usageInformation?: string; // Usage info from reference
}

export interface GraphEdge {
    source: string;
    target: string;
    usageType?: string; // How it's used: READ, WRITE, CALL, etc.
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export interface DependencyGraphFilters {
    showCustomOnly: boolean;
    showStandardOnly: boolean;
    objectTypes: string[];
    usageTypes: string[]; // Filter by how objects are used (READ, WRITE, CALL, etc.)
}

/**
 * Parse UsageReference to extract object information
 */
function parseUsageReference(ref: UsageReference): { 
    name: string; 
    type: string; 
    description?: string;
    responsible?: string;
    package?: string;
    packageUri?: string;
    usageType?: string;
    canExpand?: boolean;
    uri?: string;
    line?: number;
    column?: number;
    objectIdentifier?: string;
    parentClass?: string;
    parentUri?: string;
    usageInformation?: string;
} | null {
    try {
        const rparts = ref.objectIdentifier?.split(";");
        if (!rparts || rparts.length < 2 || rparts[0] !== "ABAPFullName") {
            return null;
        }
        
        let objectType = ref['adtcore:type'] || '';
        
        // Handle special cases with empty type
        if (!objectType) {
            const name = ref['adtcore:name'];
            // Class sections have descriptive names but no type
            if (name === 'Public Section' || name === 'Protected Section' || name === 'Private Section') {
                objectType = 'CLAS/SECTION';
            } else if (ref.uri && ref.uri.includes('/oo/classes/')) {
                objectType = 'CLAS/OC'; // Default for class-related objects
            } else {
                objectType = 'UNKNOWN';
            }
        }
        
        // Determine the correct object name based on type
        // objectIdentifier format: ABAPFullName;PROGRAM_NAME;INCLUDE_NAME;...
        let objectName = rparts[1];
        
        // Extract parent class name for methods (for filtering)
        let parentClass: string | undefined = undefined;
        
        if (objectType === 'PROG/I' && rparts.length >= 3 && rparts[2]) {
            // For includes, use the include name from rparts[2]
            objectName = rparts[2];
        } else if ((objectType === 'FUGR/FF' || objectType === 'CLAS/OM') && ref['adtcore:name']) {
            // For function modules and methods, use adtcore:name (the actual FM/method name)
            objectName = ref['adtcore:name'];
            
            // For methods, extract parent class name from objectIdentifier
            if (objectType === 'CLAS/OM' && rparts[1]) {
                // Format: ABAPFullName;ZCL_CLASS_NAME======CP;...
                const className = rparts[1].split('=')[0]; // Remove ======CP suffix
                parentClass = className;
            }
        }
        
        return {
            name: objectName,
            type: objectType,
            description: ref['adtcore:description'] || '',
            responsible: ref['adtcore:responsible'] || '',
            package: ref.packageRef?.['adtcore:name'] || '',
            packageUri: ref.packageRef?.['adtcore:uri'] || '',
            usageType: ref.usageInformation || '',
            canExpand: ref.canHaveChildren,
            uri: ref.uri,
            line: undefined, // Will be fetched on-demand when opening
            column: undefined,
            objectIdentifier: ref.objectIdentifier,
            parentClass: parentClass,
            parentUri: ref.parentUri,
            usageInformation: ref.usageInformation
        };
    } catch (error) {
        console.error('Error parsing usage reference:', error);
        return null;
    }
}

/**
 * Check if object is custom (starts with Z or Y)
 * An object is custom if:
 * - Object name starts with Z or Y, OR
 * - Package name starts with Z or Y
 */
function isCustomObject(objectName: string, packageName?: string): boolean {
    const nameIsCustom = /^[ZY]/i.test(objectName);
    const packageIsCustom = packageName ? /^[ZY]/i.test(packageName) : false;
    return nameIsCustom || packageIsCustom;
}

/**
 * Fetch where-used data for an ABAP object with position information
 */
export async function fetchWhereUsedData(
    objectUri: string,
    connectionId: string,
    line?: number,
    character?: number
): Promise<UsageReference[]> {
    const client = getClient(connectionId.toLowerCase());
    
    try {
        const references = await client.statelessClone.usageReferences(
            objectUri,
            line || 1,
            character || 0
        );
        
        // Don't fetch snippets upfront - it's slow for large graphs
        // Snippets will be fetched on-demand when user double-clicks a node
        
        return references || [];
    } catch (error) {
        console.error('Error fetching where-used data:', error);
        throw new Error(`Failed to fetch where-used data: ${error}`);
    }
}

/**
 * Extract the actual symbol being searched from objectIdentifier
 * Format: ABAPFullName;PROGRAM;INCLUDE;\PR:PROGRAM\TY:TYPE\ME:METHOD\DA:VAR;...
 * The objectIdentifier can have MULTIPLE symbols chained - we want the LAST one (most specific)
 */
function extractActualSymbol(objectIdentifier: string): { name: string; type: string } | null {
    if (!objectIdentifier) return null;
    
    // Find ALL symbol markers: \TY:, \FU:, \ME:, \DA:, etc.
    const symbolMatches = objectIdentifier.match(/\\([A-Z]+):([^\\;]+)/g);
    if (symbolMatches && symbolMatches.length > 0) {
        // Take the LAST symbol in the chain (most specific)
        const lastSymbol = symbolMatches[symbolMatches.length - 1];
        const parts = lastSymbol.match(/\\([A-Z]+):(.+)/);
        
        if (parts) {
            const symbolTypeCode = parts[1];
            const symbolName = parts[2];
            
            // Map to readable types
            const typeMap: Record<string, string> = {
                'TY': 'TYPE',
                'FU': 'FUNCTION',
                'ME': 'METHOD',
                'CL': 'CLASS',
                'TA': 'TABLE',
                'DA': 'DATA',
                'VA': 'VARIABLE',
                'CO': 'CONSTANT',
                'IN': 'INTERFACE',
                'ST': 'STRUCTURE',
                'PR': 'PROGRAM'
            };
            
            // Always return the symbol - use raw type code if not in map
            return {
                name: symbolName,
                type: typeMap[symbolTypeCode] || symbolTypeCode
            };
        }
    }
    
    return null;
}

/**
 * Build graph data from where-used references
 * @param skipSymbolExtraction - If true, use rootObjectName/Type as-is (for node expansion)
 */
export function buildGraphData(
    rootObjectName: string,
    rootObjectType: string,
    references: UsageReference[],
    skipSymbolExtraction: boolean = false
): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeMap = new Map<string, GraphNode>();
    
    // Try to extract the actual symbol from the first valid reference (unless expanding)
    let actualRootName = rootObjectName;
    let actualRootType = rootObjectType;
    
    if (!skipSymbolExtraction) {
        for (const ref of references) {
            if (ref.objectIdentifier) {
                const symbol = extractActualSymbol(ref.objectIdentifier);
                if (symbol) {
                    actualRootName = symbol.name;
                    actualRootType = symbol.type;
                    break; // Use the first one we find
                }
            }
        }
    }
    
    // Add root node with the actual symbol
    const rootId = `${actualRootName}::${actualRootType}`;
    const rootNode: GraphNode = {
        id: rootId,
        name: actualRootName,
        type: actualRootType,
        isRoot: true,
        isCustom: isCustomObject(actualRootName)
    };
    nodes.push(rootNode);
    nodeMap.set(rootId, rootNode);

    // Process references - filter out invalid ones
    const validRefs = references.filter(ref => {
        const rparts = ref.objectIdentifier?.split(";");
        return rparts && rparts[1] && rparts[0] === "ABAPFullName";
    });

    // Build nodes and edges
    for (const ref of validRefs) {
        const parsed = parseUsageReference(ref);
        if (!parsed) continue;

        const nodeId = `${parsed.name}::${parsed.type}`;
        
        // Add node if not exists
        if (!nodeMap.has(nodeId)) {
            // For methods, check if parent class is custom, not the method name
            // Also check package name - if either object/class name OR package starts with Z/Y, it's custom
            const isCustomNode = parsed.parentClass 
                ? isCustomObject(parsed.parentClass, parsed.package) 
                : isCustomObject(parsed.name, parsed.package);
            
            const node: GraphNode = {
                id: nodeId,
                name: parsed.name,
                type: parsed.type,
                description: parsed.description,
                isRoot: false,
                isCustom: isCustomNode,
                responsible: parsed.responsible,
                package: parsed.package,
                packageUri: parsed.packageUri,
                canExpand: parsed.canExpand,
                uri: parsed.uri,
                line: parsed.line,
                column: parsed.column,
                objectIdentifier: parsed.objectIdentifier,
                parentClass: parsed.parentClass,
                parentUri: parsed.parentUri,
                usageInformation: parsed.usageInformation
            };
            nodes.push(node);
            nodeMap.set(nodeId, node);
        }

        // Add edge from dependent to root (who uses the root) with usage type
        // Skip self-referencing edges
        if (nodeId !== rootId) {
            edges.push({
                source: nodeId,
                target: rootId,
                usageType: parsed.usageType
            });
        }
    }
    
    return { nodes, edges };
}

/**
 * Merge new graph data into existing graph
 * Used when expanding nodes - preserves existing nodes and adds new ones
 */
export function mergeGraphData(
    existingGraph: GraphData,
    newGraph: GraphData
): GraphData {
    const nodeMap = new Map<string, GraphNode>();
    const edgeMap = new Map<string, GraphEdge>();

    // Add all existing nodes
    for (const node of existingGraph.nodes) {
        nodeMap.set(node.id, node);
    }

    // Add new nodes (avoiding duplicates)
    for (const node of newGraph.nodes) {
        if (!nodeMap.has(node.id)) {
            nodeMap.set(node.id, { ...node, isRoot: false }); // New nodes are not root
        }
    }

    // Add all existing edges (preserve full edge object including usageType)
    for (const edge of existingGraph.edges) {
        const key = `${edge.source}::${edge.target}`;
        edgeMap.set(key, edge);
    }

    // Add new edges (avoiding duplicates, preserve usageType)
    for (const edge of newGraph.edges) {
        const key = `${edge.source}::${edge.target}`;
        if (!edgeMap.has(key)) {
            edgeMap.set(key, edge);
        }
    }

    // Convert back to arrays
    const nodes = Array.from(nodeMap.values());
    const edges = Array.from(edgeMap.values());

    return { nodes, edges };
}

/**
 * Apply filters to graph data
 */
export function applyFilters(
    graphData: GraphData,
    filters: DependencyGraphFilters
): GraphData {
    let filteredNodes = graphData.nodes;

    // Filter by custom/standard
    if (filters.showCustomOnly) {
        filteredNodes = filteredNodes.filter(node => node.isCustom || node.isRoot);
    } else if (filters.showStandardOnly) {
        filteredNodes = filteredNodes.filter(node => !node.isCustom || node.isRoot);
    }

    // Filter by object types
    if (filters.objectTypes.length > 0) {
        filteredNodes = filteredNodes.filter(node => 
            node.isRoot || filters.objectTypes.includes(node.type)
        );
    }

    // Create node ID set for filtering edges
    const nodeIds = new Set(filteredNodes.map(n => n.id));

    // Filter edges - only keep edges where both nodes exist
    let filteredEdges = graphData.edges.filter(edge => 
        nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    // Filter by usage types if specified
    if (filters.usageTypes.length > 0) {
        filteredEdges = filteredEdges.filter(edge => 
            edge.usageType && filters.usageTypes.includes(edge.usageType)
        );
    }

    return {
        nodes: filteredNodes,
        edges: filteredEdges
    };
}

/**
 * Get unique object types from graph data
 */
export function getObjectTypes(graphData: GraphData): string[] {
    const types = new Set<string>();
    for (const node of graphData.nodes) {
        if (node.type) {
            types.add(node.type);
        }
    }
    return Array.from(types).sort();
}

/**
 * Get unique usage types from graph edges
 */
export function getUsageTypes(graphData: GraphData): string[] {
    const types = new Set<string>();
    for (const edge of graphData.edges) {
        if (edge.usageType) {
            types.add(edge.usageType);
        }
    }
    return Array.from(types).sort();
}

/**
 * Main command to visualize dependency graph
 */
export async function visualizeDependencyGraph(uri?: vscode.Uri) {
    try {
        // Get active editor to capture cursor position
        const editor = window.activeTextEditor;
        
        // Get active ABAP file if no URI provided
        if (!uri) {
            if (!editor) {
                window.showErrorMessage('No active ABAP file');
                return;
            }
            uri = editor.document.uri;
        }

        // Validate it's an ADT URI
        if (uri.scheme !== 'adt') {
            window.showErrorMessage('Dependency graph is only available for ABAP objects');
            return;
        }

        // Extract connection ID from URI
        const connectionMatch = uri.authority.match(/^([^\/]+)/);
        if (!connectionMatch) {
            window.showErrorMessage('Could not determine SAP connection');
            return;
        }
        const connectionId = connectionMatch[1];
        
        // Get cursor position if editor is on the same file
        let cursorLine: number | undefined = undefined;
        let cursorCharacter: number | undefined = undefined;
        if (editor && editor.document.uri.toString() === uri.toString()) {
            // If selection is not empty, use start of selection
            const selection = editor.selection;
            const position = selection.isEmpty ? selection.active : selection.start;
            cursorLine = position.line + 1; // ADT uses 1-based line numbers
            cursorCharacter = position.character;
        } else {
        }

        // Show progress
        await window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Hold on to your hat..Building dependency graph...`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 20, message: 'Getting object details...' });

            // Get object details from filesystem root (with retry for intermittent failures)
            const { getOrCreateRoot } = await import('../adt/conections');
            const { isAbapFile } = await import('abapfs');
            
            const root = await getOrCreateRoot(uri!.authority);
            
            // Retry logic for intermittent metadata fetch failures
            let node;
            let lastError;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    node = await root.getNodeAsync(uri!.path);
                    break; // Success
                } catch (error) {
                    lastError = error;
                    const errorStr = String(error);
                    
                    // Skip enhancement objects - they don't support standard metadata
                    if (errorStr.includes('ENHO/')) {
                        throw new Error(`Enhancement objects (ENHO/) are not supported for dependency graphs. Please use regular ABAP objects.`);
                    }
                    
                    if (attempt < 3) {
                        // Wait before retry: 100ms, 200ms
                        await new Promise(resolve => setTimeout(resolve, attempt * 200));
                    }
                }
            }
            
            if (!node) {
                throw new Error(`Failed to retrieve object metadata after 3 attempts: ${lastError}`);
            }
            
            if (!isAbapFile(node)) {
                throw new Error('Nope.Not an ABAP file');
            }
            
            const objectName = node.object.name.toUpperCase();
            const objectType = node.object.type || '';
            let mainUrl = node.object.contentsPath();
            // Use getOptimalObjectURI logic for correct where-used URL (for tables, etc)
            try {
                const { getOptimalObjectURI } = await import('./lm-tools/shared');
                mainUrl = getOptimalObjectURI(node.object.type, mainUrl);
            } catch (e) {
                // fallback: use original mainUrl
            }
        
            progress.report({ increment: 20, message: 'Fetching where-used data...' });

            // Fetch where-used data with cursor position for symbol-level search
            const references = await fetchWhereUsedData(mainUrl, connectionId, cursorLine, cursorCharacter);

            progress.report({ increment: 30, message: 'Building graph...' });

            // Use object name/type as root - the ADT API handles symbol-level resolution
            // If a cursor position is provided, the API returns references to that specific symbol
            // The root node represents what the API actually searched for
            const rootObjectName = node.object.name.toUpperCase();
            const rootObjectType = node.object.type || '';
            const graphData = buildGraphData(rootObjectName, rootObjectType, references);

            progress.report({ increment: 20, message: 'Opening visualization...' });

            // Get the actual root node name (might be different from file name if symbol was extracted)
            const actualRootNode = graphData.nodes.find(n => n.isRoot);
            const actualRootName = actualRootNode?.name || rootObjectName;
            const actualRootType = actualRootNode?.type || rootObjectType;

            // Get webview manager and create panel
            const webviewManager = WebviewManager.getInstance();
            await webviewManager.showDependencyGraph(
                connectionId,
                actualRootName,
                actualRootType,
                graphData,
                mainUrl
            );

            progress.report({ increment: 10, message: 'Done!' });
        });

    } catch (error) {
        window.showErrorMessage(`Failed to visualize dependency graph: ${error}`);
        console.error('Error visualizing dependency graph:', error);
    }
}
