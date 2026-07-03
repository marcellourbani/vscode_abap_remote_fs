(()=>{
    const vscode = acquireVsCodeApi();

    // State
    let currentEntity = null; // { name, type }
    let currentMode = 'criteria'; // 'criteria' | 'sql'
    let lastTop = 200;
    let lastWhere = '';
    let lastSQL = '';
    let table = null; // Tabulator instance
    let fieldMeta = [];
    let showPref = new Map(); // name -> boolean
    let searchTimer = null;

    // Load technical preference from localStorage
    const getTechnicalPref = () => {
        try {
            return localStorage.getItem('adb-technical-names') === 'true';
        } catch {
            return false;
        }
    };

    // Save technical preference to localStorage  
    const setTechnicalPref = (value) => {
        try {
            localStorage.setItem('adb-technical-names', value ? 'true' : 'false');
        } catch {}
    };

    // Helper: format dd-mm-yyyy
    const fmtDateDMY = (d) => {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = String(d.getFullYear());
        return `${dd}-${mm}-${yyyy}`;
    };

    // Elements
    const el = id => document.getElementById(id);
    const objectInput = el('adb-object-input');
        const objectType = el('adb-object-type');
        const searchResults = el('adb-search-results');
        const rowCount = el('adb-rowCount');
        const executeBtn = el('adb-execute');
        const toggleSqlBtn = el('adb-toggle-sql');
        const toggleFieldsBtn = el('adb-toggle-fields');
    const exportCsvBtn = el('adb-export-csv');
    const copyRowsBtn = el('adb-copy-rows');
    const techToggle = el('adb-tech-names');
    const viewSqlBtn = el('adb-view-sql');
    const sqlModal = el('adb-sql-modal');
    const sqlText = el('adb-sql-text');
    const sqlClose = el('adb-sql-close');
    const sqlCopy = el('adb-sql-copy');
    const sqlOpen = el('adb-sql-open');
    const criteriaPanel = el('adb-criteria-panel');
    const sqlPanel = el('adb-sql-panel');
    const sqlBox = el('adb-sql');
    const busy = el('adb-busy');
        const objectControls = [objectInput, objectType];
        const fieldFilter = el('adb-field-filter');
        const fieldsPrev = el('adb-fields-prev');
        const fieldsNext = el('adb-fields-next');
        const fieldsPage = el('adb-fields-page');

    // Create and insert hits counter
    const hitsCounterEl = document.createElement('div');
    hitsCounterEl.id = 'adb-hits-counter';
    hitsCounterEl.style.padding = '5px 10px';
    hitsCounterEl.style.textAlign = 'right';
    hitsCounterEl.style.display = 'none'; // Initially hidden
    const resultTableEl = el('result-table');
    if (resultTableEl) {
        resultTableEl.parentNode.insertBefore(hitsCounterEl, resultTableEl);
    }

    // Initialize technical toggle from localStorage
    if (techToggle) {
        techToggle.checked = getTechnicalPref();
        techToggle.addEventListener('change', () => {
            setTechnicalPref(techToggle.checked);
            if (table && fieldMeta.length > 0) {
                rebuildTableColumns();
            }
        });
    }

    // Clear search results and timer
    const clearSearchResults = () => {
        if (searchTimer) {
            clearTimeout(searchTimer);
            searchTimer = null;
        }
        searchResults.style.display = 'none';
        searchResults.innerHTML = '';
    };

    // Live search results
    const renderSearchResults = list => {
        searchResults.innerHTML = '';
        if (!Array.isArray(list) || list.length === 0) {
            searchResults.style.display = 'none';
            return;
        }
        // Don't show results if we already have this entity loaded
        if (currentEntity && objectInput.value.trim().toUpperCase() === currentEntity.name) {
            searchResults.style.display = 'none';
            return;
        }
        searchResults.style.display = 'block';
        const ul = document.createElement('ul');
        ul.className = 'adb-ul';
        list.forEach(it => {
            const li = document.createElement('li');
            li.className = 'adb-li';
            li.textContent = `${it.name} (${it.type}) ${it.description?'- '+it.description:''}`;
            li.onclick = () => {
                objectInput.value = it.name;
                currentEntity = { name: it.name, type: it.type };
                clearSearchResults();
                resetUIForNewObject(); // FIX: Reset UI when new object is selected
                vscode.postMessage({ command: 'loadFields', entity: currentEntity });
            };
            ul.appendChild(li);
        });
        searchResults.appendChild(ul);
    };

    // Debounced search-as-you-type
    const doSearch = () => {
        let term = objectInput.value.trim();
        const t = objectType.value;
        if (!term || term.length < 2) { renderSearchResults([]); return; }
        // If user didn't type wildcard, use fast prefix search (MAR -> MAR*)
        // Honor user wildcards verbatim
        if (!(/[\*\?]/.test(term))) term = `${term.toUpperCase()}*`; else term = term.toUpperCase();
        const types = t === 'ALL' ? ['ALL'] : [t];
        vscode.postMessage({ command: 'searchObjects', term, types, max: 50 });
    };

    if (objectInput) {
        objectInput.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') {
                const raw = objectInput.value.trim();
                if (raw && !(/[\\*\\?]/.test(raw))) {
                    // Treat Enter as "use this exact object" and load fields immediately
                    currentEntity = { name: raw.toUpperCase(), type: objectType.value };
                    clearSearchResults(); // Clear any pending search results
                    resetUIForNewObject(); // FIX: Reset UI when new object is selected
                    vscode.postMessage({ command: 'loadFields', entity: currentEntity });
                } else {
                    doSearch();
                }
            }
        });

        objectInput.addEventListener('input', () => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(doSearch, 300);
        });

        // Hide search results when clicking outside
        document.addEventListener('click', (e) => {
            if (!objectInput.contains(e.target) && !searchResults.contains(e.target)) {
                clearSearchResults();
            }
        });
    }

    // Criteria builder
    const operatorOptions = (type) => {
        const common = [
            {v:'=',t:'='},{v:'!=',t:'!='},{v:'like',t:'LIKE'},{v:'not like',t:'NOT LIKE'},{v:'in',t:'IN'},{v:'not in',t:'NOT IN'},{v:'is initial',t:'IS INITIAL'},{v:'is not initial',t:'IS NOT INITIAL'}
        ];
        const numeric = [{v:'>',t:'>'},{v:'>=',t:'>='},{v:'<',t:'<'},{v:'<=',t:'<='},{v:'between',t:'BETWEEN'}];
        const date = [{v:'=',t:'='},{v:'>',t:'>'},{v:'>=',t:'>='},{v:'<',t:'<'},{v:'<=',t:'<='},{v:'between',t:'BETWEEN'},{v:'is initial',t:'IS INITIAL'},{v:'is not initial',t:'IS NOT INITIAL'}];
        if (['I','b','8','s','P','/','a','e','F','N','%'].includes(type)) return [...common, ...numeric];
        if (['D','T'].includes(type)) return [...common, ...date];
        return common;
    };

    // Field list paging/filtering
    let fieldPage = 1;
    const pageSize = 25;
    const filteredFields = () => {
        const q = (fieldFilter?.value || '').trim().toUpperCase();
        if (!q) return fieldMeta;
        return fieldMeta.filter(c => (c.name||'').toUpperCase().includes(q) || (c.description||'').toUpperCase().includes(q));
    };
    const pageFields = (list) => {
        const totalPages = Math.max(1, Math.ceil(list.length / pageSize));
        fieldPage = Math.min(fieldPage, totalPages);
        const start = (fieldPage - 1) * pageSize;
        const end = start + pageSize;
        if (fieldsPage) fieldsPage.textContent = `${fieldPage}/${totalPages}`;
        return list.slice(start, end);
    };

    const renderCriteria = () => {
        criteriaPanel.innerHTML = '';
        if (!fieldMeta.length) return;
        // Hide MANDT globally
        const filtered = filteredFields().filter(f => f.name?.toUpperCase() !== 'MANDT');
        const list = pageFields(filtered);
        const tbl = document.createElement('table');
        tbl.className = 'adb-crit-table';
        const thead = document.createElement('thead');
    thead.innerHTML = `<tr><th>Field</th><th>Operator</th><th>Value</th><th>Use</th><th>Show <span id="adb-show-all" title="Select all" style="cursor:pointer;">✔</span> <span id="adb-show-none" title="Clear all" style="cursor:pointer;">✖</span></th></tr>`;
        tbl.appendChild(thead);
        const tbody = document.createElement('tbody');
        list.forEach(col => {
            const tr = document.createElement('tr');
            const tdField = document.createElement('td');
            tdField.innerHTML = `<div><strong>${col.description || col.name}</strong><div class="adb-tech">${col.name} · ${col.type}</div></div>`; tr.appendChild(tdField);
            const tdOp = document.createElement('td');
            const sel = document.createElement('select');
            operatorOptions(col.type).forEach(op => { const o=document.createElement('option'); o.value=op.v; o.textContent=op.t; sel.appendChild(o); });
            tdOp.appendChild(sel); tr.appendChild(tdOp);
                    const tdVal = document.createElement('td');
                    const ta = document.createElement('textarea');
                    ta.rows = 1;
                    ta.placeholder = 'Value(s): paste newline/comma/; for multi | %/_ for LIKE';
                    // Auto-switch to IN if multiple values detected
                    ta.addEventListener('input', () => {
                        const raw = ta.value.trim();
                        const values = splitMulti(raw);
                        if (values.length > 1) sel.value = 'in';
                        // Auto-tick Use when user enters a value; untick if empty
                        const use = tr.querySelector('input.adb-use');
                        if (use) use.checked = raw.length > 0;
                    });
                    // Auto-tick Use and disable value when IS INITIAL/NOT INITIAL
                    sel.addEventListener('change', () => {
                        const v = sel.value;
                        const use = tr.querySelector('input.adb-use');
                        if (v === 'is initial' || v === 'is not initial') {
                            if (use) use.checked = true;
                            ta.disabled = true; ta.value = '';
                        } else {
                            // switching away: re-enable and clear to avoid stale values
                            ta.disabled = false; 
                            ta.value = '';
                        }
                    });
                    tdVal.appendChild(ta);
                    tr.appendChild(tdVal);
            const tdChk = document.createElement('td');
            const chk = document.createElement('input'); chk.type='checkbox'; chk.title='Include'; chk.className='adb-use'; chk.checked=false; tdChk.appendChild(chk); tr.appendChild(tdChk);
            const tdShow = document.createElement('td');
            const chkShow = document.createElement('input'); chkShow.type='checkbox'; chkShow.title='Show column'; chkShow.className='adb-show';
            // Default to persisted preference if present; otherwise unchecked
            const persisted = showPref.has(col.name) ? !!showPref.get(col.name) : null;
            chkShow.checked = persisted === null ? false : persisted;
            chkShow.addEventListener('change', () => { showPref.set(col.name, chkShow.checked); });
            tdShow.appendChild(chkShow); tr.appendChild(tdShow);
            tr.dataset.field = col.name;
            tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        criteriaPanel.appendChild(tbl);
        // Select/Deselect all icons bound to the Show column
        const setAll = (val) => {
            // Update preference for all fields across all pages
            fieldMeta.forEach(f => showPref.set(f.name, val));
            // Update current page checkboxes for immediate feedback
            criteriaPanel.querySelectorAll('input.adb-show').forEach(ch => { ch.checked = val; });
        };
        const btnAll = document.getElementById('adb-show-all');
        const btnNone = document.getElementById('adb-show-none');
        if (btnAll) btnAll.onclick = () => setAll(true);
        if (btnNone) btnNone.onclick = () => setAll(false);
    };

    const sqlQuote = (val) => `'${String(val).replace(/'/g, "''")}'`;
    const splitMulti = (raw) => raw
        .split(/\r?\n|,|;|\t/)
        .map(s => s.trim())
        .filter(Boolean);
    
    const likePattern = (raw) => {
        // For ADT/OpenSQL compatibility, handle patterns more carefully
        let pattern = raw.trim();
        
        // If user explicitly included % or _, use as-is
        if (pattern.includes('%') || pattern.includes('_')) {
            return pattern;
        }
        
        // Convert * to % and ? to _
        pattern = pattern.replace(/\*/g, '%').replace(/\?/g, '_');
        
        // If still no wildcards and not an exact match, add trailing %
        if (!pattern.includes('%') && !pattern.includes('_')) {
            pattern = `${pattern}%`;
        }
        
        return pattern;
    };

    // Format SQL for ADT compatibility 
    const formatSQLForADT = (sql) => {
        // Remove extra whitespace and ensure proper formatting
        return sql
            .replace(/\s+/g, ' ') // normalize whitespace
            .replace(/\s*,\s*/g, ', ') // normalize comma spacing
            .trim();
    };
    // Clear table and reset state
    const clearTable = () => {
        if (table) {
            table.destroy();
            table = null;
        }
        // Clear the container completely
        const container = document.getElementById('result-table');
        if (container) container.innerHTML = '';
        updateActionButtonsVisibility();
    };

    // Reset UI to initial state when object changes
    const resetUIForNewObject = () => {
        clearTable();
        // Show selection fields by default
        const h = document.getElementById('adb-fields-header');
        if (criteriaPanel) criteriaPanel.style.display = '';
        if (h) h.style.display = '';
        if (toggleFieldsBtn) toggleFieldsBtn.textContent = 'Hide Selection Fields';
    };

    // Clear busy indicator
    const clearBusy = () => {
        if (busy) {
            busy.style.display = 'none';
            console.log('Busy indicator cleared'); // DEBUG
        }
    };

    // Show busy indicator
    const showBusy = () => {
        if (busy) {
            busy.style.display = '';
            console.log('Busy indicator shown'); // DEBUG
        }
    };
    // No type-specific initial handling per user preference
    const buildWhere = () => {
        const rows = criteriaPanel.querySelectorAll('tbody tr');
        const clauses = [];
        rows.forEach(tr => {
            const checked = tr.querySelector('input.adb-use')?.checked;
            if (!checked) return;
            const field = tr.dataset.field;
            const op = tr.querySelector('select').value;
            const raw = tr.querySelector('textarea').value.trim();
            if (op === 'is initial') { clauses.push(`${field} = ''`); return; }
            if (op === 'is not initial') { clauses.push(`${field} <> ''`); return; }
            if (!raw) return;
                    if (op === 'between') {
                        const [a,b] = splitMulti(raw);
                        if (a && b) clauses.push(`${field} BETWEEN ${sqlQuote(a.trim())} AND ${sqlQuote(b.trim())}`);
                        return;
                    }
                    if (op === 'in' || op === 'not in') {
                        const vals = splitMulti(raw).map(sqlQuote).join(',');
                if (vals) clauses.push(`${field} ${op.toUpperCase()} (${vals})`);
                return;
            }
            if (op === 'like' || op === 'not like') {
                // Handle multiple values in LIKE - join with OR
                const parts = splitMulti(raw);
                if (parts.length > 1) {
                    const orClauses = parts.map(part => `${field} ${op.toUpperCase()} ${sqlQuote(likePattern(part.trim()))}`);
                    clauses.push(`(${orClauses.join(' OR ')})`);
                } else {
                    // For ADT compatibility, be more conservative with LIKE patterns
                    const pattern = likePattern(raw);
                    clauses.push(`${field} ${op.toUpperCase()} ${sqlQuote(pattern)}`);
                }
                return;
            }
            clauses.push(`${field} ${op} ${sqlQuote(raw)}`);
        });
        return clauses.length ? `where ${clauses.join(' and ')}` : '';
    };
    const buildProjection = () => {
        // Use saved preferences so selections on other pages are honored; empty => host uses *
        const cols = [];
        for (const [n, v] of showPref.entries()) if (v) cols.push(n);
        return cols;
    };

    // Compose Criteria SQL string (for preview only)
    const buildCriteriaSQL = () => {
        if (!currentEntity?.name) return '';
        const cols = buildProjection();
        const list = cols.length ? cols.map(c => c.toUpperCase()).join(', ') : '*';
        const where = buildWhere().replace(/^\s*where\s*/i, '');
        const sql = `select ${list} from ${currentEntity.name}${where ? ' where ' + where : ''}`;
        return formatSQLForADT(sql);
    };

    // Rebuild table columns with current technical setting
    const rebuildTableColumns = () => {
        if (!table || !fieldMeta.length) return;
        const currentData = table.getData();
        const useTech = !!(techToggle && techToggle.checked);
        const rawCols = fieldMeta.filter(c => String(c.name || '').toUpperCase() !== 'MANDT');
        const cols = rawCols.map(c => createColumnDefinition(c, useTech, rawCols));
        table.setColumns(cols);
        table.setData(currentData);
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
    const createColumnDefinition = (colMeta, useTech, allCols) => {
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
            headerFilterFunc: headerFilterFunc, // Your custom filter
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
        const hitsCounter = el('adb-hits-counter');

        if (hitsCounter) {
            if (table) { // table instance exists
                const count = table.getDataCount();
                hitsCounter.textContent = `Number of Hits: ${count}`;
                hitsCounter.style.display = '';
            } else {
                hitsCounter.style.display = 'none';
            }
        }

        if (exportCsvBtn) exportCsvBtn.style.display = hasData ? '' : 'none';
        if (copyRowsBtn) {
            const selCount = hasData ? table.getSelectedData().length : 0;
            copyRowsBtn.style.display = selCount > 0 ? '' : 'none';
        }
    };

    // Mode toggle with proper cleanup
    const setMode = (mode) => {
        currentMode = mode;
        
        // Clear table when switching modes
        clearTable();
        clearBusy();
        
        if (mode === 'sql') {
            sqlPanel.style.display = '';
            criteriaPanel.style.display = 'none';
            // Hide object controls and SQL-irrelevant buttons in SQL mode
            objectControls.forEach(el => el && (el.style.display = 'none'));
            const fieldsHeader = document.getElementById('adb-fields-header');
            if (fieldsHeader) fieldsHeader.style.display = 'none';
            if (toggleFieldsBtn) toggleFieldsBtn.style.display = 'none';
            if (viewSqlBtn) viewSqlBtn.style.display = 'none';
            // Hide technical toggle properly
            const techLabel = techToggle?.closest('label');
            if (techLabel) techLabel.style.display = 'none';
            if (toggleSqlBtn) toggleSqlBtn.textContent = 'Criteria Mode';
            if (executeBtn) executeBtn.textContent = 'Execute';
        } else {
            sqlPanel.style.display = 'none';
            criteriaPanel.style.display = '';
            objectControls.forEach(el => el && (el.style.display = ''));
            const fieldsHeader = document.getElementById('adb-fields-header');
            if (fieldsHeader) fieldsHeader.style.display = '';
            if (toggleFieldsBtn) toggleFieldsBtn.style.display = '';
            if (viewSqlBtn) viewSqlBtn.style.display = '';
            // Show technical toggle properly
            const techLabel = techToggle?.closest('label');
            if (techLabel) techLabel.style.display = '';
            if (toggleSqlBtn) toggleSqlBtn.textContent = 'SQL Mode';
            if (executeBtn) executeBtn.textContent = 'Search';
        }
        updateActionButtonsVisibility();
    };
    
    if (toggleSqlBtn) toggleSqlBtn.onclick = () => setMode(currentMode === 'sql' ? 'criteria' : 'sql');

    // Execute
    executeBtn.onclick = () => {
        // Clear table and reset state on every execution
        clearTable();
        clearBusy();
        showBusy();
        
        const top = parseInt(rowCount.value) || 200;
        lastTop = top;
        
        if (currentMode === 'sql') {
            lastSQL = sqlBox.value.trim();
            if (!lastSQL) { 
                clearBusy(); 
                return; 
            }
            // Format SQL for ADT compatibility
            const formattedSQL = formatSQLForADT(lastSQL);
            vscode.postMessage({ command: 'runSQL', sql: formattedSQL, top });
        } else {
            if (!currentEntity) {
                const name = objectInput.value.trim();
                if (name) currentEntity = { name: name.toUpperCase(), type: objectType.value };
            }
            if (!currentEntity) { 
                clearBusy(); 
                return; 
            }
            lastWhere = buildWhere();
            const columns = buildProjection();
            // Persist per-table Show preferences
            vscode.postMessage({ command: 'setShowPrefs', table: currentEntity.name, fields: columns });
            vscode.postMessage({ command: 'runCriteria', entity: currentEntity, where: lastWhere, top, columns });
            
            // Auto-hide fields after search execution in criteria mode
            const h = document.getElementById('adb-fields-header');
            if (criteriaPanel && criteriaPanel.style.display !== 'none') {
                criteriaPanel.style.display = 'none';
                if (h) h.style.display = 'none';
                if (toggleFieldsBtn) toggleFieldsBtn.textContent = 'Show Fields';
            }
        }
    };
    // Fields filter/pager
    if (fieldFilter) fieldFilter.addEventListener('input', () => { fieldPage = 1; renderCriteria(); });
    if (fieldsPrev) fieldsPrev.addEventListener('click', () => { fieldPage = Math.max(1, fieldPage - 1); renderCriteria(); });
    if (fieldsNext) fieldsNext.addEventListener('click', () => { fieldPage = fieldPage + 1; renderCriteria(); });
    if (toggleFieldsBtn) toggleFieldsBtn.onclick = () => {
        const h = document.getElementById('adb-fields-header');
        const visible = criteriaPanel.style.display !== 'none';
        if (visible) { criteriaPanel.style.display = 'none'; if (h) h.style.display = 'none'; toggleFieldsBtn.textContent = 'Show Fields'; }
        else { if (h) h.style.display = ''; criteriaPanel.style.display = ''; toggleFieldsBtn.textContent = 'Hide Fields'; }
    };

    // Show SQL modal in criteria mode
    if (viewSqlBtn) viewSqlBtn.onclick = () => {
        if (currentMode !== 'criteria') return;
        const sql = buildCriteriaSQL();
        if (sqlText) sqlText.textContent = sql;
        if (sqlModal) sqlModal.style.display = 'flex';
    };
    if (sqlClose) sqlClose.onclick = () => { if (sqlModal) sqlModal.style.display = 'none'; };
    if (sqlModal) sqlModal.addEventListener('click', (e) => { if (e.target === sqlModal) sqlModal.style.display = 'none'; });
    if (sqlCopy) sqlCopy.onclick = async () => {
        try {
            await navigator.clipboard.writeText(sqlText?.textContent || '');
            sqlCopy.textContent = 'Copied';
            setTimeout(() => { sqlCopy.textContent = 'Copy'; }, 1200);
        } catch {}
    };
    if (sqlOpen) sqlOpen.onclick = () => {
        const sql = buildCriteriaSQL();
        if (sql) {
            setMode('sql');
            if (sqlBox) sqlBox.value = sql;
        }
        if (sqlModal) sqlModal.style.display = 'none';
    };

    // Results
    const wildToRegex = (input) => {
        // Convert * and ? to regex, keep others literal; empty input matches all
        if (input == null) return null;
        const txt = String(input);
        const esc = txt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx = esc.replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
        return new RegExp('^' + rx + '$', 'i');
    };
        const renderResult = (result) => {
            // Always clear busy state first
            clearBusy();
            
            const rawCols = (result.columns || []);
            if (rawCols.length === 0) {
                document.getElementById('result-table').innerHTML = '<p style="padding: 12px;">No data found.</p>';
                updateActionButtonsVisibility();
                return;
            }
            
            // Hide MANDT column in output
            const visibleCols = rawCols.filter(c => String(c.name || '').toUpperCase() !== 'MANDT');
            const useTech = getTechnicalPref(); // Use saved preference instead of checkbox
            const cols = visibleCols.map(c => createColumnDefinition(c, useTech, rawCols));
            
            const data = result.values || [];
            if (!table) {
                table = new Tabulator('#result-table', {
                    data,
                    columns: cols,
                    layout: 'fitData',
                    height: false, // Let webview handle scrolling
                    selectableRows: true, // FIX: Enable multi-row selection with Ctrl/Shift
                    movableColumns: true,
                    resizableColumnGuide: true,
                    clipboard: true,
                    history: true,

                    // ALV-like visual features
                    rowBorder: true,
                    columnBorder: true,
                    headerBorder: true,

                    // Restore ALV-like context menus
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
                        headerFilter: "input", // Restore header filter input
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
                        headerFilter: false // Disable filter for this column
                    }
                });
                // Add selection event handlers safely
                if (table && typeof table.on === 'function') {
                    table.on('rowSelectionChanged', () => updateActionButtonsVisibility());
                    table.on('dataProcessed', () => updateActionButtonsVisibility());
                }
            } else {
                table.setColumns(cols);
                table.replaceData(data);
                table.redraw(true); // Force redraw to fix rendering issues
            }
            
            // Update technical checkbox to match current state
            if (techToggle) techToggle.checked = useTech;
            
            updateActionButtonsVisibility();
            // clearBusy() already called at the start of this function
        };

        exportCsvBtn.onclick = async () => {
            if (!table) return;
            // Ask host to save (works better in CSP webviews)
            const columns = table.getColumns().map(c => ({ title: c.getDefinition().title, field: c.getField() }));
            const rows = table.getData();
            vscode.postMessage({ command: 'exportCSV', columns, rows, defaultName: (currentEntity && currentEntity.name) || 'data' });
        };

    // Messages from host
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.command) {
            case 'objects':
                renderSearchResults(msg.data);
                break;
            case 'fields':
                fieldMeta = msg.data.columns || [];
                if (msg.data.entity) currentEntity = msg.data.entity;
                // Load persisted Show preferences if any
        if (currentEntity?.name) vscode.postMessage({ command: 'getShowPrefs', table: currentEntity.name });
                renderCriteria();
                break;
            case 'showPrefs': {
                const { table, fields } = msg.data || {};
                if (currentEntity?.name && table && currentEntity.name.toUpperCase() === String(table).toUpperCase()) {
                    showPref = new Map();
                    const selected = new Set((fields || []).map(s => String(s).toUpperCase()));
                    if (selected.size > 0) {
                        fieldMeta.forEach(f => showPref.set(f.name, selected.has(f.name.toUpperCase())));
                    } else {
                        // No saved prefs: default to none selected
                        showPref.clear();
                    }
                    // Apply to current page checkboxes
                    criteriaPanel.querySelectorAll('tbody tr').forEach(tr => {
                        const f = tr.dataset.field;
                        const box = tr.querySelector('input.adb-show');
                        if (f && box) {
                            box.checked = !!showPref.get(f);
                        }
                    });
                }
                break;
            }
            case 'queryResult': {
                const { result, hasMore, top, mode, where, sql, entity } = msg.data;
                if (entity) currentEntity = entity;
                if (typeof top === 'number') lastTop = top;
                if (mode === 'sql') lastSQL = sql || '';
                else lastWhere = where || '';
                console.log('Received queryResult, calling renderResult'); // DEBUG
                renderResult(result);
                break;
            }
            case 'result': // legacy
                console.log('Received legacy result'); // DEBUG
                renderResult(JSON.parse(msg.data));
                break;
            case 'error':
                console.log('Received error, clearing busy'); // DEBUG
                document.getElementById('result-table').innerHTML = `<p style="color: red; padding: 12px;">${msg.data}</p>`;
                clearBusy();
                break;
        }
    });

    // Initialize button visibility on startup (hide all initially)
    if (exportCsvBtn) exportCsvBtn.style.display = 'none';
    if (copyRowsBtn) copyRowsBtn.style.display = 'none';
    
    // Auto-load fields if input prefilled
    const preset = objectInput && objectInput.value && objectInput.value.trim();
    if (preset) {
        currentEntity = { name: preset.toUpperCase(), type: objectType.value };
        vscode.postMessage({ command: 'loadFields', entity: currentEntity });
    }

    // Copy selected rows
    if (copyRowsBtn) copyRowsBtn.onclick = async () => {
        if (!table) return;
        const rows = table.getSelectedData();
        if (!rows || rows.length === 0) return;
        const cols = table.getColumns().map(c => c.getField()).filter(Boolean);
        const csv = [cols.join('\t')].concat(rows.map(r => cols.map(f => String(r[f] ?? '')).join('\t'))).join('\n');
        try { await navigator.clipboard.writeText(csv); } catch {}
    };
})();