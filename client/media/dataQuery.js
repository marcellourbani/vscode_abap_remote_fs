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
    
    // State
    let table = null; // Tabulator instance
    let fieldMeta = [];
    let webviewId = window.webviewId || 'unknown';

    // Helper: format dd-mm-yyyy
    const fmtDateDMY = (d) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = String(d.getFullYear());
        return `${dd}-${mm}-${yyyy}`;
    };

    // Elements
    const el = id => document.getElementById(id);
    const exportCsvBtn = el('adb-export-csv');
    const copyRowsBtn = el('adb-copy-rows');
    const busy = el('adb-busy');

    // Clear busy indicator
    const clearBusy = () => {
        if (busy) {
            busy.style.display = 'none';
        }
    };

    // Show busy indicator
    const showBusy = () => {
        if (busy) {
            busy.style.display = '';
        }
    };

    // Clear table and reset state
    const clearTable = () => {
        if (table) {
            table.destroy();
            table = null;
        }
        const container = document.getElementById('result-table');
        if (container) container.innerHTML = '';
        updateActionButtonsVisibility();
    };

    // Custom header filter function for exact match / wildcards
    const headerFilterFunc = (headerValue, rowValue, rowData, filterParams) => {
        if (headerValue == null || headerValue === '') return true;
        const sv = rowValue == null ? '' : String(rowValue);
        // If wildcards are present, use regex matching
        if (/[*?]/.test(String(headerValue))) {
            const wildToRegex = s => new RegExp(`^${s.replace(/([.+^${}()|\[\]\/\\])/g, '\\$1').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
            const rx = wildToRegex(headerValue);
            return rx ? rx.test(sv) : true;
        }
        // Otherwise, perform an exact, case-insensitive match
        return sv.toLowerCase() === String(headerValue).toLowerCase();
    };

    // Create column definition
    const createColumnDefinition = (colMeta, useTech = false, allCols = []) => {
        // Determine sorter based on SAP data type
        let sorter = 'string'; // Default
        if (['I', 'b', '8', 's', 'P', 'F', 'DEC', 'CURR', 'QUAN', 'FLTP'].includes(colMeta.type)) {
            sorter = 'number';
        } else if (colMeta.type === 'D') {
            sorter = 'date';
        } else if (colMeta.type === 'T') {
            sorter = 'time';
        } else if (['C', 'N', 'STRING', 'CHAR', 'NUMC'].includes(colMeta.type)) {
            sorter = 'alphanum'; // Alphanumeric sorter for material numbers etc.
        }

        return {
            title: useTech ? colMeta.name : (colMeta.description || colMeta.name),
            field: colMeta.name,
            sorter: sorter,
            sorterParams: {
                format: sorter === 'date' ? 'DD-MM-YYYY' : undefined,
            },
            resizable: true,
            headerFilter: "input",
            headerFilterFunc: headerFilterFunc,
            tooltip: (e, cell, onRender) => {
                const val = cell.getValue();
                return val == null ? '' : String(val);
            },
            formatter: cell => {
                const val = cell.getValue();
                if (val == null) return '';
                const str = String(val);
                // Format SAP dates and times back to readable format
                if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(str)) {
                    const dt = new Date(str);
                    if (colMeta?.type === 'D') return fmtDateDMY(dt); // dd-mm-yyyy
                    if (colMeta?.type === 'T') return dt.toISOString().slice(11, 19); // HH:MM:SS
                }
                return str;
            }
        };
    };

    // Update visibility of action buttons based on table state
    const updateActionButtonsVisibility = () => {
        const hasData = !!table && (table.getDataCount() > 0);
        
        if (exportCsvBtn) exportCsvBtn.style.display = hasData ? '' : 'none';
        if (copyRowsBtn) {
            const selCount = hasData ? table.getSelectedData().length : 0;
            copyRowsBtn.style.display = selCount > 0 ? '' : 'none';
        }
    };

    // Render query result
    const renderResult = (result) => {
        clearBusy();
        
        const rawCols = (result.columns || []);
        if (rawCols.length === 0) {
            document.getElementById('result-table').innerHTML = '<p style="padding: 12px;">No data found.</p>';
            updateActionButtonsVisibility();
            return;
        }
        
        // Hide MANDT column in output
        const visibleCols = rawCols.filter(c => String(c.name || '').toUpperCase() !== 'MANDT');
        const cols = visibleCols.map(c => createColumnDefinition(c, false, rawCols));
        
        const data = result.values || [];
        fieldMeta = rawCols; // Store for later use
        
        if (!table) {
            table = new Tabulator('#result-table', {
                data,
                columns: cols,
                layout: 'fitData',
                height: 400, // Fixed height enables virtualization
                
                // 🚀 PERFORMANCE: Enable virtualization for large datasets
                renderVertical: "virtual", // Only render visible rows
                renderHorizontal: "virtual", // Only render visible columns  
                renderVerticalBuffer: 50, // Buffer rows for smooth scrolling
                
                selectableRows: true,
                movableColumns: true,
                resizableColumnGuide: true,
                clipboard: true,
                history: true,

                // ALV-like visual features
                rowBorder: true,
                columnBorder: true,
                headerBorder: true,

                // Context menus
                rowContextMenu: [
                    { label: "Copy Row", action: (e, row) => row.copyToClipboard() }
                ],
                columnHeaderMenu: [
                    { label: "Hide Column", action: (e, column) => column.hide() },
                    { label: "Sort Ascending", action: (e, column) => column.getTable().setSort(column.getField(), "asc") },
                    { label: "Sort Descending", action: (e, column) => column.getTable().setSort(column.getField(), "desc") }
                ],

                // Column Defaults
                columnDefaults: {
                    resizable: true,
                    headerFilter: "input",
                    headerSort: true,
                    minWidth: 100,
                    headerTooltip: true
                },
                rowHeader: {
                    formatter: "rownum",
                    resizable: false,
                    headerSort: false,
                    width: 40,
                    frozen: true,
                    headerFilter: false
                }
            });
            
            // Add selection event handlers
            if (table && typeof table.on === 'function') {
                table.on('rowSelectionChanged', () => updateActionButtonsVisibility());
                table.on('dataProcessed', () => updateActionButtonsVisibility());
            }
        } else {
            table.setColumns(cols);
            table.replaceData(data);
            table.redraw(true);
        }
        
        updateActionButtonsVisibility();
    };

    // Apply sorting to table (replaces existing sorts)
    const applySorting = (sortColumns) => {
        if (!table || !Array.isArray(sortColumns)) return;
        
        // Convert to Tabulator format and apply (this replaces all existing sorts)
        const sortConfig = sortColumns.map(sort => ({
            column: sort.column,
            dir: sort.direction
        }));
        
        if (sortConfig.length > 0) {
            table.setSort(sortConfig);
        }
    };

    // Apply filters to table (additive - preserves existing filters unless reset first)
    const applyFilters = (filters) => {
        if (!table || !Array.isArray(filters)) return;
        
        // Apply new filters without clearing existing ones
        filters.forEach(filter => {
            table.setHeaderFilterValue(filter.column, filter.value);
        });
    };

    // Clear all sorting
    const clearSorting = () => {
        if (!table) return;
        table.clearSort();
    };

    // Clear all filters
    const clearFilters = () => {
        if (!table) return;
        table.clearHeaderFilter();
    };

    // Get current table data
    const getCurrentTableData = () => {
        if (!table) return null;
        
        // Get current sorts from Tabulator
        const currentSorts = table.getSorters().map(sorter => ({
            column: sorter.getField(),
            direction: sorter.getDir()
        }));
        
        // Get current filters from Tabulator (this is trickier)
        const currentFilters = [];
        table.getColumns().forEach(column => {
            const headerFilter = column.getHeaderFilterValue();
            if (headerFilter) {
                currentFilters.push({
                    column: column.getField(),
                    value: headerFilter
                });
            }
        });
        
        return {
            columns: fieldMeta,
            values: table.getData(),
            totalRows: table.getDataCount(),
            currentSorts: currentSorts,
            currentFilters: currentFilters
        };
    };

    // Export CSV functionality
    if (exportCsvBtn) {
        exportCsvBtn.onclick = async () => {
            if (!table) return;
            const columns = table.getColumns().map(c => ({ 
                title: c.getDefinition().title, 
                field: c.getField() 
            }));
            const rows = table.getData();
            vscode.postMessage({ 
                command: 'exportCSV', 
                columns, 
                rows, 
                defaultName: `data-query-${webviewId}` 
            });
        };
    }

    // Copy selected rows functionality
    if (copyRowsBtn) {
        copyRowsBtn.onclick = async () => {
            if (!table) return;
            const rows = table.getSelectedData();
            if (!rows || rows.length === 0) return;
            const cols = table.getColumns().map(c => c.getField()).filter(Boolean);
            const csv = [cols.join('\t')].concat(
                rows.map(r => cols.map(f => String(r[f] ?? '')).join('\t'))
            ).join('\n');
            try { 
                await navigator.clipboard.writeText(csv); 
            } catch (e) {
                console.warn('Failed to copy to clipboard:', e);
            }
        };
    }

    // Message handling from extension
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.command) {
            case 'queryResult': {
                const { result } = msg.data;
                renderResult(result);
                break;
            }
            case 'loading': {
                // Show loading state for filter/sort operations
                showBusy();
                console.log('Loading state shown:', msg.message || 'Processing...'); // DEBUG
                break;
            }
            case 'applySorting': {
                const { sortColumns } = msg.data;
                applySorting(sortColumns);
                break;
            }
            case 'applyFilters': {
                const { filters } = msg.data;
                applyFilters(filters);
                break;
            }
            case 'clearSorting': {
                clearSorting();
                break;
            }
            case 'clearFilters': {
                clearFilters();
                break;
            }
            case 'getWebviewData': {
                const data = getCurrentTableData();
                console.log('[DEBUG] Sending webview data:', data); // DEBUG
                vscode.postMessage({ 
                    command: 'webviewData', 
                    data 
                });
                break;
            }
            case 'error': {
                clearBusy();
                document.getElementById('result-table').innerHTML = 
                    `<p style="color: red; padding: 12px;">${escapeHtml(msg.data)}</p>`;
                break;
            }
        }
    });

    // Initialize button visibility
    if (exportCsvBtn) exportCsvBtn.style.display = 'none';
    if (copyRowsBtn) copyRowsBtn.style.display = 'none';
    
    // Show loading initially
    showBusy();
})();
