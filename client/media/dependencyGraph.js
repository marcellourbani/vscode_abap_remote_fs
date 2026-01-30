// =====================================================================
// ABAP Dependency Graph Viewer - Powered by Cytoscape.js - v6
// =====================================================================
// Interactive dependency visualization with live filtering and expansion
// =====================================================================

(() => {
    const vscode = acquireVsCodeApi();
    
    // Security: HTML escape function to prevent XSS
    const escapeHtml = (str) => {
        if (str === undefined || str === null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };
    
    // ====== STATE ======
    let cy = null; // Cytoscape instance
    let graphData = { nodes: [], edges: [] }; // Full graph data
    let originalGraphData = null; // For reset
    let filters = {
        showCustomOnly: false,
        showStandardOnly: false,
        objectTypes: [],
        usageTypes: []
    };
    let availableTypes = [];
    let availableUsageTypes = [];
    let typeColorMap = new Map(); // Dynamic color assignment for object types
    let expandedNodes = new Set(); // Track which nodes have been expanded
    let graphBuilt = false; // Track if graph has been rendered
    
    // ====== ELEMENTS ======
    const graphContainer = document.getElementById('cy-graph');
    const busyIndicator = document.getElementById('graph-busy');
    const statsText = document.getElementById('stats-text');
    const customOnlyCheck = document.getElementById('filter-custom-only');
    const standardOnlyCheck = document.getElementById('filter-standard-only');
    const typesContainer = document.getElementById('type-filters-container');
    const usageFiltersContainer = document.getElementById('usage-filters-container');
    const resetFiltersBtn = document.getElementById('reset-filters');
    // Add Reset to Root button
    let resetRootBtn = document.getElementById('reset-root');
    if (!resetRootBtn) {
        resetRootBtn = document.createElement('button');
        resetRootBtn.id = 'reset-root';
        resetRootBtn.textContent = 'Reset to Root';
        resetRootBtn.title = 'Restore original root and graph';
        resetRootBtn.onclick = () => {
            if (originalGraphData) {
                graphData = JSON.parse(JSON.stringify(originalGraphData));
                expandedNodes.clear(); // Clear expanded node tracking
                graphBuilt = true; // Mark as built
                // Re-apply current filters to the reset graph
                applyFilters();
            }
        };
        if (resetFiltersBtn && resetFiltersBtn.parentNode) {
            resetFiltersBtn.parentNode.insertBefore(resetRootBtn, resetFiltersBtn.nextSibling);
        }
    }
    const fitGraphBtn = document.getElementById('fit-graph');
    const exportBtn = document.getElementById('export-graph');
    const layoutSelect = document.getElementById('layout-select');

    // ====== FILTER TEXT BOX ======
    let filterPattern = '';
    const filterBox = document.createElement('input');
    filterBox.type = 'text';
    filterBox.placeholder = 'Object name pattern (e.g. Z*MD*)';
    filterBox.style.marginLeft = '8px';
    filterBox.style.width = '180px';
    filterBox.id = 'object-filter-box';
    const filterBtn = document.createElement('button');
    filterBtn.textContent = 'Apply Filter';
    filterBtn.title = 'Apply object name pattern filter';
    filterBtn.onclick = () => {
        filterPattern = filterBox.value.trim();
        if (graphBuilt) {
            applyFilters();
        } else {
            // Update counts even before graph is built
            updateFilterCounts();
        }
    };
    // Insert filter box and button into toolbar
    const toolbar = document.querySelector('.graph-toolbar .toolbar-section');
    if (toolbar) {
        toolbar.appendChild(filterBox);
        toolbar.appendChild(filterBtn);
    }

    // ====== COLOR GENERATION ======
    function generateColorForType(type) {
        if (typeColorMap.has(type)) {
            return typeColorMap.get(type);
        }
        
        // Generate a deterministic color based on type name
        let hash = 0;
        for (let i = 0; i < type.length; i++) {
            hash = type.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        // Generate HSL color with good contrast and MAXIMUM distinctness
        // Avoid red (0-30, 330-360) and purple (270-310) hues to prevent confusion with root/expanded
        let hue = Math.abs(hash % 360);
        
        // Skip red range (340-30) and purple range (270-310)
        if ((hue >= 340 || hue <= 30) || (hue >= 270 && hue <= 310)) {
            // Shift to safe ranges: blue-green-yellow (60-240)
            hue = 60 + (Math.abs(hash) % 180); // Range: 60-240 (green, cyan, blue, yellow)
        }
        
        // Increase saturation and vary lightness more for maximum distinctness
        const saturation = 70 + (Math.abs(hash) % 25); // 70-95% (more vivid)
        const lightness = 40 + (Math.abs(hash >> 8) % 25); // 40-65% (wider range)
        
        const color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        typeColorMap.set(type, color);
        return color;
    }

    function getBorderColorForType(type) {
        const baseColor = generateColorForType(type);
        // Darken for border
        return baseColor.replace(/(\d+)%\)$/, (match, lightness) => `${Math.max(0, parseInt(lightness) - 15)}%)`);
    }

    // ====== UTILITY FUNCTIONS ======
    const showBusy = (message = 'Loading...') => {
        if (busyIndicator) {
            busyIndicator.textContent = message;
            busyIndicator.style.display = 'block';
        }
    };

    const hideBusy = () => {
        if (busyIndicator) {
            busyIndicator.style.display = 'none';
        }
    };

    const updateStats = () => {
        const visibleNodes = cy ? cy.nodes().length : 0;
        const visibleEdges = cy ? cy.edges().length : 0;
        const totalNodes = graphData.nodes.length;
        const totalEdges = graphData.edges.length;
        
        if (statsText) {
            const uniqueTypes = new Set(graphData.nodes.map(n => n.type).filter(t => t));
            statsText.textContent = `Showing ${visibleNodes}/${totalNodes} nodes, ${visibleEdges}/${totalEdges} edges (${uniqueTypes.size} types)`;
        }
    };

    // ====== FILTER SUMMARY VIEW ======
    function showFilterSummary(data) {
        const typeCounts = new Map();
        data.nodes.forEach(n => {
            if (!n.isRoot && n.type) {
                typeCounts.set(n.type, (typeCounts.get(n.type) || 0) + 1);
            }
        });
        
        const typeList = Array.from(typeCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
                const color = generateColorForType(type);
                return `<div style="display: flex; align-items: center; gap: 8px; margin: 4px 0;">
                    <div style="width: 20px; height: 20px; background: ${color}; border-radius: 50%;"></div>
                    <span>${escapeHtml(type)}: <strong>${count}</strong> nodes</span>
                </div>`;
            }).join('');
        
        graphContainer.innerHTML = `
            <div style="padding: 40px; text-align: center; max-width: 800px; margin: 0 auto;">
                <h2 style="color: var(--vscode-foreground); margin-bottom: 24px;">
                    📊 Dependency Analysis Ready
                </h2>
                <div style="background: var(--vscode-editor-background); padding: 20px; border-radius: 4px; margin-bottom: 24px; border: 1px solid var(--vscode-editorWidget-border);">
                    <h3 style="margin-top: 0;">Summary:</h3>
                    <p style="font-size: 16px; margin: 16px 0;"><strong>${data.nodes.length - 1}</strong> dependencies found for <strong>${escapeHtml(data.nodes.find(n => n.isRoot)?.name || 'unknown')}</strong></p>
                    <div style="margin-top: 16px; text-align: left; max-height: 300px; overflow-y: auto;">
                        ${typeList}
                    </div>
                </div>
                <p style="color: var(--vscode-descriptionForeground); margin-bottom: 16px;">
                    ⚠️ Large graphs may take time to render. Use filters on the right to reduce complexity before building.
                </p>
                <button id="build-graph-btn" style="
                    padding: 12px 32px;
                    font-size: 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                ">
                    🚀 Build Graph
                </button>
            </div>
        `;
        
        document.getElementById('build-graph-btn').onclick = () => {
            showBusy('Building graph with current filters...');
            graphBuilt = true; // Mark as built so applyFilters works
            // Clear the summary HTML first
            graphContainer.innerHTML = '';
            // Use setTimeout to let UI update before heavy rendering
            setTimeout(() => {
                applyFilters(); // This will now work because graphBuilt = true
            }, 50);
        };
        
        hideBusy();
        updateStats();
    }

    // ====== GRAPH RENDERING ======
    let createCytoscapeGraph = (data) => {
        showBusy('Building graph...');
        
        if (!data || !data.nodes || data.nodes.length === 0) {
            graphContainer.innerHTML = '<div style="padding: 20px; text-align: center;">No dependencies found</div>';
            hideBusy();
            return;
        }
        
        // Check if only root node with no edges (local-only usage)
        if (data.nodes.length === 1 && data.edges.length === 0) {
            const rootNode = data.nodes[0];
            graphContainer.innerHTML = `
                <div style="padding: 40px; text-align: center; max-width: 600px; margin: 0 auto;">
                    <h3 style="color: var(--vscode-foreground); margin-bottom: 16px;">
                        📍 ${escapeHtml(rootNode.name)} (${escapeHtml(rootNode.type)})
                    </h3>
                    <p style="color: var(--vscode-descriptionForeground); margin-bottom: 20px;">
                        This symbol is only used within the current object.<br>
                        No external dependencies found.
                    </p>
                    <p style="color: var(--vscode-descriptionForeground); font-size: 12px;">
                        💡 Try using "Find References" (right-click → Find All References) for a full where-used search.
                    </p>
                </div>
            `;
            hideBusy();
            updateStats();
            return;
        }

        // Prepare elements for Cytoscape
        const elements = {
            nodes: data.nodes.map(node => {
                const isExpanded = expandedNodes.has(node.id);
                const isRoot = node.isRoot || false;
                
                return {
                    data: {
                        id: node.id,
                        label: node.name,
                        type: node.type,
                        description: node.description || '',
                        isRoot: isRoot,
                        isExpanded: isExpanded,
                        isCustom: node.isCustom || false,
                        responsible: node.responsible || '',
                        package: node.package || '',
                        packageUri: node.packageUri || '',
                        canExpand: node.canExpand || false,
                        uri: node.uri,
                        line: node.line,
                        column: node.column,
                        character: node.character,
                        objectIdentifier: node.objectIdentifier,
                        parentClass: node.parentClass,
                        parentUri: node.parentUri,
                        usageInformation: node.usageInformation
                    }
                };
            }),
            edges: data.edges.map(edge => ({
                data: {
                    source: edge.source,
                    target: edge.target,
                    usageType: edge.usageType || ''
                }
            }))
        };

        // Cytoscape configuration
        const config = {
            container: graphContainer,
            elements: elements,
            style: [
                // Base node styles - default blue
                {
                    selector: 'node',
                    style: {
                        'label': 'data(label)',
                        'text-valign': 'center',
                        'text-halign': 'center',
                        'background-color': (ele) => {
                            // Use dynamic color based on type for regular nodes
                            if (ele.data('isRoot')) return '#e74c3c';
                            if (ele.data('isExpanded')) return '#9b59b6';
                            return generateColorForType(ele.data('type'));
                        },
                        'border-color': (ele) => {
                            if (ele.data('isRoot')) return '#c0392b';
                            if (ele.data('isExpanded')) return '#7d3c98';
                            return getBorderColorForType(ele.data('type'));
                        },
                        'color': '#fff',
                        'font-size': '11px',
                        'width': '160px',
                        'height': '60px',
                        'text-wrap': 'wrap',
                        'text-max-width': '150px',
                        'font-weight': 'bold',
                        'border-width': 2,
                        'text-outline-width': 0
                    }
                },
                // Root node style - larger and distinct
                {
                    selector: 'node[isRoot = "true"]',
                    style: {
                        'border-width': 6,
                        'width': '220px',
                        'height': '90px',
                        'font-size': '14px',
                        'text-max-width': '210px',
                        'shape': 'round-rectangle'
                    }
                },
                // Expanded nodes (but not root) - slightly larger with thicker border
                {
                    selector: 'node[isExpanded = "true"]',
                    style: {
                        'border-width': (ele) => ele.data('isRoot') ? 6 : 5,
                        'width': (ele) => ele.data('isRoot') ? '220px' : '180px',
                        'height': (ele) => ele.data('isRoot') ? '90px' : '70px',
                        'shape': 'round-rectangle'
                    }
                },
                // Expandable nodes (have more dependencies to fetch) - double border
                {
                    selector: 'node[canExpand = "true"]',
                    style: {
                        'border-style': 'double'
                    }
                },
                // Edge styles
                {
                    selector: 'edge',
                    style: {
                        'width': 2,
                        'line-color': '#95a5a6',
                        'target-arrow-color': '#95a5a6',
                        'target-arrow-shape': 'triangle',
                        'curve-style': 'bezier',
                        'arrow-scale': 1.5,
                        // Hide usageType labels - they're too technical and not useful
                        // 'label': 'data(usageType)',
                        'font-size': '8px',
                        'text-rotation': 'autorotate',
                        'text-margin-y': -10,
                        'color': '#7f8c8d'
                    }
                },
                // Selected elements
                {
                    selector: ':selected',
                    style: {
                        'background-color': '#9b59b6',
                        'line-color': '#8e44ad',
                        'target-arrow-color': '#8e44ad',
                        'border-color': '#8e44ad'
                    }
                },
                // Hovered node
                {
                    selector: 'node:active',
                    style: {
                        'overlay-color': '#000',
                        'overlay-padding': 5,
                        'overlay-opacity': 0.1
                    }
                }
            ],
            layout: {
                name: layoutSelect?.value || 'cose',
                animate: true,
                animationDuration: 500,
                // Aggressive spacing to prevent overlap
                nodeRepulsion: (node) => 600000, // Much higher repulsion
                nodeOverlap: 200, // Large overlap prevention (node width is 160-220px)
                idealEdgeLength: (edge) => 250, // Longer edges = more space
                edgeElasticity: (edge) => 50, // Stiffer edges maintain length
                padding: 50,
                // Slow down convergence for better spacing (fewer iterations = less compression)
                numIter: 500, // Fewer iterations (default: 1000)
                initialTemp: 200, // Higher temp = more movement allowed
                coolingFactor: 0.99, // Slower cooling
                minTemp: 1.0,
                // Root positioning
                fit: true,
                // Prevent node overlap aggressively
                avoidOverlap: true,
                avoidOverlapPadding: 40
            },
            minZoom: 0.01,
            maxZoom: 10
        };

        // Ensure container has size before initializing
        if (graphContainer.offsetWidth === 0 || graphContainer.offsetHeight === 0) {
            // Force container to have size
            graphContainer.style.width = '100%';
            graphContainer.style.height = '100%';
            // Wait a bit for layout
            setTimeout(() => createCytoscapeGraph(data), 500);
            return;
        }
        

        // Destroy existing graph
        if (cy) {
            cy.destroy();
        }

        // Create new graph
        cy = cytoscape(config);
        
        // Force resize after creation to ensure proper dimensions
        setTimeout(() => {
            if (cy) {
                cy.resize();
                cy.fit(null, 50);
            }
        }, 100);

        // Add event handlers
        setupEventHandlers();
        
        // Hide busy indicator once layout is complete
        cy.one('layoutstop', () => {
            hideBusy();
            updateStats();
        });
    };

    // ====== EVENT HANDLERS ======
    let setupEventHandlers = () => {
        if (!cy) return;

        // Double-click to open object
        cy.on('dbltap', 'node', (event) => {
            const node = event.target;
            const nodeData = node.data();
            
            vscode.postMessage({
                command: 'openObject',
                objectName: nodeData.label,
                objectType: nodeData.type,
                uri: nodeData.uri,
                line: nodeData.line,
                column: nodeData.column,
                character: nodeData.character,
                objectIdentifier: nodeData.objectIdentifier,
                parentUri: nodeData.parentUri,
                usageInformation: nodeData.usageInformation,
                canExpand: nodeData.canExpand,
                responsible: nodeData.responsible,
                package: nodeData.package,
                packageUri: nodeData.packageUri
            });
        });

        // Single click to expand dependencies
        cy.on('tap', 'node', (event) => {
            const node = event.target;
            const nodeData = node.data();
            
            // Don't expand on root node double-click
            if (nodeData.isRoot) return;
            
            // Show context menu or expand on single click
            // For now, let's keep it simple - user can right-click for context menu
        });

        // Right-click context menu
        cy.on('cxttap', 'node', (event) => {
            const node = event.target;
            const nodeData = node.data();
            
            // Show custom context menu
            showNodeContextMenu(event.originalEvent, nodeData);
        });

        // Tooltip on hover
        cy.on('mouseover', 'node', (event) => {
            const node = event.target;
            const nodeData = node.data();
            
            // Create tooltip
            const tooltip = document.getElementById('node-tooltip') || createTooltip();
            
            let tooltipContent = `<div><strong>${escapeHtml(nodeData.label)}</strong></div>`;
            tooltipContent += `<div style="font-size: 11px; color: #666;">Type: ${escapeHtml(nodeData.type)}</div>`;
            
            // For methods, show parent class name
            if (nodeData.parentClass) {
                tooltipContent += `<div style="margin-top: 4px; font-size: 11px; color: #888;">🏛️ Class: ${escapeHtml(nodeData.parentClass)}</div>`;
            }
            
            if (nodeData.description) {
                tooltipContent += `<div style="margin-top: 4px;">${escapeHtml(nodeData.description)}</div>`;
            }
            
            if (nodeData.package) {
                tooltipContent += `<div style="margin-top: 4px; font-size: 11px;">📦 Package: ${escapeHtml(nodeData.package)}</div>`;
            }
            
            if (nodeData.responsible) {
                tooltipContent += `<div style="font-size: 11px;">👤 Responsible: ${escapeHtml(nodeData.responsible)}</div>`;
            }
            
            tooltipContent += `<div style="margin-top: 8px; font-size: 10px; color: #888;">`;
            if (nodeData.isRoot) tooltipContent += 'Root Node<br>';
            tooltipContent += nodeData.isCustom ? 'Custom Object (Z/Y)' : 'Standard SAP Object';
            if (nodeData.canExpand) tooltipContent += '<br>🔍 Can expand dependencies';
            tooltipContent += `</div>`;
            
            tooltipContent += `<div style="margin-top: 8px; font-size: 10px; color: #666; border-top: 1px solid #ddd; padding-top: 4px;">`;
            tooltipContent += `Double-click to open | Right-click for options`;
            tooltipContent += `</div>`;
            
            tooltip.innerHTML = tooltipContent;
            tooltip.style.display = 'block';
            
            // Position tooltip
            const renderedPos = node.renderedPosition();
            tooltip.style.left = (renderedPos.x + 70) + 'px';
            tooltip.style.top = (renderedPos.y - 30) + 'px';
        });

        cy.on('mouseout', 'node', () => {
            const tooltip = document.getElementById('node-tooltip');
            if (tooltip) {
                tooltip.style.display = 'none';
            }
        });
    };

    const createTooltip = () => {
        const tooltip = document.createElement('div');
        tooltip.id = 'node-tooltip';
        tooltip.className = 'graph-tooltip';
        document.body.appendChild(tooltip);
        return tooltip;
    };

    const showNodeContextMenu = (event, nodeData) => {
        // Prevent default context menu
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        
        // Create custom context menu
        const menu = document.createElement('div');
        menu.className = 'graph-context-menu';
        menu.style.left = event.clientX + 'px';
        menu.style.top = event.clientY + 'px';
        
        const menuItems = [
            { label: 'Open Object', action: 'openObject' },
            { label: 'Expand Dependencies', action: 'expandDependencies' },
            { label: 'Focus on This Node', action: 'focusNode' }
        ];
        
        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.textContent = item.label;
            menuItem.className = 'graph-menu-item';
            menuItem.onmouseover = () => menuItem.classList.add('hover');
            menuItem.onmouseout = () => menuItem.classList.remove('hover');
            menuItem.onclick = () => {
                handleContextMenuAction(item.action, nodeData);
                document.body.removeChild(menu);
            };
            menu.appendChild(menuItem);
        });
        
        document.body.appendChild(menu);
        
        // Remove menu on click outside
        const removeMenu = () => {
            if (menu.parentNode) {
                document.body.removeChild(menu);
            }
            document.removeEventListener('click', removeMenu);
        };
        setTimeout(() => document.addEventListener('click', removeMenu), 100);
    };

    const handleContextMenuAction = (action, nodeData) => {
        switch (action) {
            case 'openObject':
                vscode.postMessage({
                    command: 'openObject',
                    objectName: nodeData.label,
                    objectType: nodeData.type
                });
                break;
            case 'expandDependencies':
                // Mark this node as expanded
                expandedNodes.add(nodeData.id);
                vscode.postMessage({
                    command: 'expandNode',
                    objectName: nodeData.label,
                    objectType: nodeData.type,
                    uri: nodeData.uri
                });
                break;
            case 'focusNode':
                if (cy) {
                    const node = cy.getElementById(nodeData.id);
                    cy.animate({
                        fit: { eles: node, padding: 100 },
                        duration: 500
                    });
                }
                break;
        }
    };

    // ====== ENHANCED FILTERING ======
    function matchesPattern(name, pattern) {
        if (!pattern) return true;
        // Convert wildcard pattern to regex
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
        const matches = regex.test(name);
        // Don't log every match - too many for large graphs
        return matches;
    }

    // ====== FILTERING ======
    const applyFilters = async () => {
        // If graph hasn't been built yet, just return
        if (!graphBuilt) {
            return;
        }

        showBusy('Applying filters...');

        const selectedTypes = Array.from(document.querySelectorAll('.type-checkbox:checked'))
            .map(cb => cb.value);
        const selectedUsageTypes = Array.from(document.querySelectorAll('.usage-checkbox:checked'))
            .map(cb => cb.value);

        filters.objectTypes = selectedTypes;
        filters.usageTypes = selectedUsageTypes;


        // Filter nodes - ALWAYS keep root node regardless of filters
        let filteredNodes = graphData.nodes.filter(node => {
            // Root node is always included
            if (node.isRoot) return true;
            
            // Apply filters to non-root nodes
            if (filters.showCustomOnly && !node.isCustom) return false;
            if (filters.showStandardOnly && node.isCustom) return false;
            if (filters.objectTypes.length && !filters.objectTypes.includes(node.type)) return false;
            
            // For name pattern filter: check parent class for methods, otherwise check node name
            if (filterPattern) {
                const nameToMatch = node.parentClass || node.name;
                if (!matchesPattern(nameToMatch, filterPattern)) return false;
            }
            
            return true;
        });


        // Filter edges - ONLY keep edges where BOTH nodes are in filtered set
        const filteredNodeIds = new Set(filteredNodes.map(n => n.id));
        let filteredEdges = graphData.edges.filter(edge => {
            if (filters.usageTypes.length && !filters.usageTypes.includes(edge.usageType)) return false;
            
            // Keep edge only if both source and target are visible
            return filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target);
        });


        // For very large filtered sets, warn user
        if (filteredNodes.length > 1000) {
            const proceed = confirm(`About to render ${filteredNodes.length} nodes. This may take a while. Continue?`);
            if (!proceed) {
                hideBusy();
                return;
            }
        }

        // Render filtered graph
        createCytoscapeGraph({ nodes: filteredNodes, edges: filteredEdges });
        
        // Update filter counts to show what's currently visible
        updateFilterCounts();
        
        // Don't hide busy here - createCytoscapeGraph will hide it when layout completes
    };

    const renderFilteredGraph = (filteredData) => {
        createCytoscapeGraph(filteredData);
        // Don't hide busy here - createCytoscapeGraph will hide it when layout completes
    };

    const buildTypeFilters = (types) => {
        if (!typesContainer) return;
        
        typesContainer.innerHTML = '';
        
        // Count nodes per type in FULL graph
        const totalTypeCounts = new Map();
        graphData.nodes.forEach(n => {
            if (!n.isRoot && n.type) {
                totalTypeCounts.set(n.type, (totalTypeCounts.get(n.type) || 0) + 1);
            }
        });
        
        // Calculate filtered counts (what will actually be shown)
        const calculateFilteredCounts = () => {
            const filteredCounts = new Map();
            graphData.nodes.forEach(n => {
                if (n.isRoot || !n.type) return;
                
                // Apply current filters
                if (filters.showCustomOnly && !n.isCustom) return;
                if (filters.showStandardOnly && n.isCustom) return;
                if (filterPattern) {
                    const nameToMatch = n.parentClass || n.name;
                    if (!matchesPattern(nameToMatch, filterPattern)) return;
                }
                
                filteredCounts.set(n.type, (filteredCounts.get(n.type) || 0) + 1);
            });
            return filteredCounts;
        };
        
        const filteredCounts = calculateFilteredCounts();
        
        types.forEach(type => {
            const label = document.createElement('label');
            label.className = 'filter-label';
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '6px';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'type-checkbox';
            checkbox.value = type;
            checkbox.checked = true;
            checkbox.onchange = () => {
                if (graphBuilt) applyFilters();
                // Update counts after filter change
                updateFilterCounts();
            };
            
            // Color indicator
            const colorBox = document.createElement('span');
            colorBox.style.width = '12px';
            colorBox.style.height = '12px';
            colorBox.style.backgroundColor = generateColorForType(type);
            colorBox.style.borderRadius = '50%';
            colorBox.style.display = 'inline-block';
            colorBox.style.flexShrink = '0';
            
            const totalCount = totalTypeCounts.get(type) || 0;
            const filteredCount = filteredCounts.get(type) || 0;
            const countText = graphBuilt ? `${filteredCount} / ${totalCount}` : `${totalCount}`;
            const text = document.createTextNode(` ${type} (${countText})`);
            
            label.appendChild(checkbox);
            label.appendChild(colorBox);
            label.appendChild(text);
            label.setAttribute('data-type', type);
            typesContainer.appendChild(label);
        });
    };
    
    // Update filter counts dynamically
    const updateFilterCounts = () => {
        if (!graphBuilt) return;
        
        const filteredCounts = new Map();
        graphData.nodes.forEach(n => {
            if (n.isRoot || !n.type) return;
            
            // Apply current filters (except object type)
            if (filters.showCustomOnly && !n.isCustom) return;
            if (filters.showStandardOnly && n.isCustom) return;
            if (filterPattern) {
                const nameToMatch = n.parentClass || n.name;
                if (!matchesPattern(nameToMatch, filterPattern)) return;
            }
            
            filteredCounts.set(n.type, (filteredCounts.get(n.type) || 0) + 1);
        });
        
        // Update text in each label
        document.querySelectorAll('.filter-label').forEach(label => {
            const type = label.getAttribute('data-type');
            if (type) {
                const totalCount = graphData.nodes.filter(n => !n.isRoot && n.type === type).length;
                const filteredCount = filteredCounts.get(type) || 0;
                const textNode = Array.from(label.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
                if (textNode) {
                    textNode.textContent = ` ${type} (${filteredCount} / ${totalCount})`;
                }
            }
        });
    };

    const buildUsageFilters = (types) => {
        if (!usageFiltersContainer) return;
        
        usageFiltersContainer.innerHTML = '';
        if (types.length === 0) {
            usageFiltersContainer.innerHTML = '<div style="color: #888; font-size: 11px;">No usage types</div>';
            return;
        }
        
        types.forEach(type => {
            const label = document.createElement('label');
            label.className = 'filter-label';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'usage-checkbox';
            checkbox.value = type;
            checkbox.checked = true;
            checkbox.onchange = applyFilters;
            
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(` ${type}`));
            usageFiltersContainer.appendChild(label);
        });
    };

    // ====== BUTTON HANDLERS ======
    if (customOnlyCheck) {
        customOnlyCheck.onchange = (e) => {
            filters.showCustomOnly = e.target.checked;
            if (e.target.checked) {
                standardOnlyCheck.checked = false;
                filters.showStandardOnly = false;
            }
            applyFilters();
        };
    }

    if (standardOnlyCheck) {
        standardOnlyCheck.onchange = (e) => {
            filters.showStandardOnly = e.target.checked;
            if (e.target.checked) {
                customOnlyCheck.checked = false;
                filters.showCustomOnly = false;
            }
            applyFilters();
        };
    }

    if (resetFiltersBtn) {
        resetFiltersBtn.onclick = () => {
            filters = {
                showCustomOnly: false,
                showStandardOnly: false,
                objectTypes: availableTypes,
                usageTypes: availableUsageTypes
            };
            customOnlyCheck.checked = false;
            standardOnlyCheck.checked = false;
            
            document.querySelectorAll('.type-checkbox').forEach(cb => cb.checked = true);
            document.querySelectorAll('.usage-checkbox').forEach(cb => cb.checked = true);
            applyFilters();
        };
    }

    if (fitGraphBtn) {
        fitGraphBtn.onclick = () => {
            if (cy) {
                cy.fit(null, 50);
            }
        };
    }

    // --- SVG Export Button Fix ---
    if (exportBtn) {
        exportBtn.textContent = 'Export SVG Image';
        // Ensure cytoscape-svg extension is loaded
        if (typeof cytoscape !== 'undefined' && typeof cytoscape('core', 'svg') === 'undefined') {
            if (typeof cytoscapeSvg !== 'undefined') {
                cytoscape.use(cytoscapeSvg);
            }
        }
        exportBtn.onclick = () => {
            if (cy && typeof cy.svg === 'function') {
                const svg = cy.svg({ full: true, scale: 1 });
                vscode.postMessage({
                    command: 'exportImage',
                    imageData: svg,
                    format: 'svg'
                });
            } else {
                alert('SVG export is not available.');
            }
        };
    }

    if (layoutSelect) {
        layoutSelect.onchange = (e) => {
            if (cy) {
                showBusy('Applying layout...');
                
                // Use setTimeout to let UI update before heavy computation
                setTimeout(() => {
                    const layoutName = e.target.value;
                    const layoutOptions = {
                        name: layoutName,
                        animate: true,
                        animationDuration: 500
                    };
                
                // Apply aggressive spacing for all layouts
                if (layoutName === 'cose') {
                    Object.assign(layoutOptions, {
                        nodeRepulsion: (node) => 400000,
                        nodeOverlap: 200,
                        idealEdgeLength: (edge) => 250,
                        edgeElasticity: (edge) => 50,
                        padding: 50,
                        numIter: 500,
                        initialTemp: 200,
                        coolingFactor: 0.99,
                        minTemp: 1.0,
                        avoidOverlap: true,
                        avoidOverlapPadding: 40
                    });
                } else if (layoutName === 'concentric') {
                    Object.assign(layoutOptions, {
                        concentric: (node) => node.data('isRoot') ? 100 : 1,
                        levelWidth: () => 3,
                        minNodeSpacing: 150,
                        padding: 50,
                        avoidOverlap: true
                    });
                } else if (layoutName === 'breadthfirst') {
                    Object.assign(layoutOptions, {
                        roots: '[isRoot = "true"]',
                        directed: true,
                        spacingFactor: 2.0,
                        padding: 50,
                        avoidOverlap: true
                    });
                } else if (layoutName === 'circle' || layoutName === 'grid') {
                    Object.assign(layoutOptions, {
                        spacingFactor: 2.0,
                        padding: 50,
                        avoidOverlap: true
                    });
                }
                
                const layout = cy.layout(layoutOptions);
                
                // Hide busy when layout actually completes
                layout.one('layoutstop', () => {
                    hideBusy();
                });
                
                layout.run();
                }, 50);
            }
        };
    }

    // ====== LOGGING ======
    function log(...args) {
        if (window && window.console) {
        }
        // Optionally, send to VSCode for extension-side logging
        if (typeof vscode !== 'undefined' && vscode.postMessage) {
            try {
                vscode.postMessage({ command: 'log', log: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ') });
            } catch (e) {}
        }
    }

    // ====== MESSAGE HANDLING ======
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.command) {
            case 'init':
                // Initialize graph with data
                graphData = message.graphData;
                originalGraphData = JSON.parse(JSON.stringify(graphData));
                availableTypes = message.availableTypes || [];
                availableUsageTypes = message.availableUsageTypes || [];
                filters.objectTypes = [...availableTypes];
                filters.usageTypes = [...availableUsageTypes];
                buildTypeFilters(availableTypes);
                buildUsageFilters(availableUsageTypes);
                
                // For large graphs, show filter summary first instead of building immediately
                if (graphData.nodes.length > 100) {
                    showFilterSummary(graphData);
                } else {
                    // Small graphs can be built immediately
                    createCytoscapeGraph(graphData);
                    graphBuilt = true;
                }
                hideBusy();
                break;
            case 'updateGraph':
                // Log expansion
                
                // Mark the expanded node
                if (message.expandedNodeId) {
                    expandedNodes.add(message.expandedNodeId);
                }
                
                // Merge new nodes/edges into existing graph
                const newData = message.graphData;
                
                // Merge nodes (avoid duplicates, strip isRoot from expanded node)
                const nodeMap = new Map(graphData.nodes.map(n => [n.id, n]));
                for (const n of newData.nodes) {
                    if (!nodeMap.has(n.id)) {
                        // New nodes from expansion should never be root
                        graphData.nodes.push({ ...n, isRoot: false });
                    }
                }
                
                // Merge edges (avoid duplicates) - use full edge signature including usageType
                const edgeMap = new Map();
                for (const e of graphData.edges) {
                    const key = `${e.source}|${e.target}|${e.usageType || ''}`;
                    edgeMap.set(key, e);
                }
                for (const e of newData.edges) {
                    const key = `${e.source}|${e.target}|${e.usageType || ''}`;
                    if (!edgeMap.has(key)) {
                        graphData.edges.push(e);
                    }
                }
                
                // Re-apply current filters to the merged graph
                applyFilters();
                break;
                
            case 'busy':
                showBusy(message.message);
                break;
                
            case 'error':
                hideBusy();
                graphContainer.innerHTML = `<div style="padding: 20px; color: #e74c3c;">Error: ${escapeHtml(message.error)}</div>`;
                break;
        }
    });

    // Prevent all default context menus in the webview
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
    }, true); // Use capture phase to catch it early

    // Signal ready
    vscode.postMessage({ command: 'ready' });
})();
