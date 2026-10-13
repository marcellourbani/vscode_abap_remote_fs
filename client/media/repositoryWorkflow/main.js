const vscode = acquireVsCodeApi()
const app = document.getElementById("app")
const globalError = document.getElementById("error")
const home = document.getElementById("home")
let state = {}
let busy = false
let pendingTransition = false
let latestWorkflowRevision = 0
let assistedApplyExecutionHistory
const sourceSelections = {}
const sourceSelectionRevisions = {}
const copilotAssistedApplySelections = {}
const copilotAssistedApplySelectionRevisions = {}
const manualAssistedApplySelections = {}
const manualAssistedApplySelectionRevisions = {}
const workflowTables = []
const workflowTableById = {}
const workflowTableStates = {}
const workflowTableViews = {}
const busyDisabledStates = new WeakMap()
let tableResizeFrame

const send = (command, data = {}) => vscode.postMessage({ command, ...data })
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character])
const list = value => (value || []).join(", ")
const complete = stepId => state.workflow?.steps?.[stepId]?.status === "complete"
const reviewable = stepId =>
  ["complete", "partial"].includes(state.workflow?.steps?.[stepId]?.status)

window.addEventListener("message", event => {
  if (event.data.command === "state") {
    const previousWorkflowId = state.workflow?.workflowId
    if (
      state.workflow?.workflowId === event.data.workflow?.workflowId &&
      Number(event.data.workflow?.revision || 0) < latestWorkflowRevision
    )
      return
    pendingTransition = false
    state = event.data
    if (previousWorkflowId !== state.workflow?.workflowId)
      assistedApplyExecutionHistory = undefined
    latestWorkflowRevision = Number(state.workflow?.revision || 0)
    clearErrors()
    render()
  }
  if (event.data.command === "workflow") {
    if (state.workflow?.workflowId !== event.data.workflow?.workflowId) return
    const revision = Number(event.data.workflow?.revision || 0)
    if (revision < latestWorkflowRevision) return
    latestWorkflowRevision = revision
    const renderedRevision = state.workflow.revision
    state.workflow = { ...event.data.workflow, revision: renderedRevision }
    pendingTransition = false
    updateWorkflowChrome()
  }
  if (event.data.command === "progress") {
    if (state.workflow?.workflowId !== event.data.workflow?.workflowId) return
    const revision = Number(event.data.workflow?.revision || 0)
    if (revision < latestWorkflowRevision) return
    latestWorkflowRevision = revision
    const renderedRevision = state.workflow.revision
    state.workflow = { ...event.data.workflow, revision: renderedRevision }
    updateProgressDisplay()
    updateElapsedCounters()
    applyBusy()
  }
  if (event.data.command === "error") {
    pendingTransition = false
    showSectionError(event.data.section, event.data.message)
    applyBusy()
  }
  if (event.data.command === "busy") {
    busy = event.data.value
    applyBusy()
  }
  if (event.data.command === "sourceSelectionImported") {
    if (state.workflow?.workflowId !== event.data.workflowId) return
    const workflowId = event.data.workflowId
    sourceSelections[workflowId] = new Set(event.data.keys || [])
    const table = workflowTableById.existenceComparison
    if (table)
      void table.updateData(
        (state.previews.existenceComparison || []).map(row => ({
          key: row.key,
          selected: sourceSelections[workflowId].has(row.key)
        }))
      )
    const comparableCount = (state.previews.existenceComparison || []).filter(sourceComparable).length
    updateSourceSelectionControls(workflowId, comparableCount)
    const status = document.getElementById("selectionImportStatus")
    if (status)
      status.textContent = `${event.data.keys.length.toLocaleString()} selected from ${event.data.fileName}; ${event.data.unselectable.toLocaleString()} unselectable, ${event.data.unknown.toLocaleString()} unknown, and ${event.data.duplicates.toLocaleString()} duplicate keys ignored.`
  }
  if (event.data.command === "copilotAssistedApplySelectionImported") {
    if (state.workflow?.workflowId !== event.data.workflowId) return
    const workflowId = event.data.workflowId
    copilotAssistedApplySelections[workflowId] = new Set(event.data.keys || [])
    const table = workflowTableById.assistedApplyPlan
    if (table)
      void table.updateData(
        (state.previews.assistedApplyPlan?.items || []).map(row => ({
          key: row.key,
          selected: copilotAssistedApplySelections[workflowId].has(row.key),
          copilotStatus: copilotAssistedApplyStatus(
            row,
            copilotAssistedApplySelections[workflowId].has(row.key)
          ),
          copilotDecision: copilotAssistedApplyDecision(
            row,
            copilotAssistedApplySelections[workflowId].has(row.key)
          ),
          copilotDecisionReason: copilotAssistedApplyDecisionReason(
            row,
            copilotAssistedApplySelections[workflowId].has(row.key)
          )
        }))
      )
    updateCopilotAssistedApplySelectionControls()
    const status = document.getElementById("copilotSelectionImportStatus")
    if (status)
      status.textContent = `${event.data.keys.length.toLocaleString()} selected from ${event.data.fileName}; ${event.data.unselectable.toLocaleString()} ineligible, ${event.data.unknown.toLocaleString()} unknown, and ${event.data.duplicates.toLocaleString()} duplicate keys ignored. Save the selection to make it available to Copilot.`
  }
  if (event.data.command === "assistedApplyExecutionHistory") {
    if (state.workflow?.workflowId !== event.data.workflowId) return
    assistedApplyExecutionHistory = {
      objectKey: event.data.objectKey,
      events: event.data.events || []
    }
    render()
  }
})

home.onclick = () => { state.workflow = undefined; render() }

window.addEventListener("resize", () => {
  if (tableResizeFrame) cancelAnimationFrame(tableResizeFrame)
  tableResizeFrame = requestAnimationFrame(() => {
    tableResizeFrame = undefined
    workflowTables.forEach(table => table.redraw(true))
  })
})

function render() {
  destroyWorkflowTables()
  home.classList.toggle("hidden", !state.workflow)
  if (state.workflow) renderWorkflow()
  else renderHome()
  applyBusy()
  updateElapsedCounters()
}

function renderHome() {
  document.getElementById("subtitle").textContent = "Persistent source and target analysis"
  const options = (state.connectedSystems || []).map(system => `<option value="${escapeHtml(system)}">${escapeHtml(system.toUpperCase())}</option>`).join("")
  const workflows = (state.workflows || []).map(workflow => `
    <article class="workflow-row">
      <div><strong>${escapeHtml(workflow.name)}</strong><div class="muted">
        <span class="direction">Source: ${escapeHtml(workflow.source.connectionId.toUpperCase())}</span>
        <span class="direction">Target: ${escapeHtml(workflow.target.connectionId.toUpperCase())}</span>
        <span>${escapeHtml(workflow.currentStep)} · ${escapeHtml(workflow.runState)}</span>
      </div></div>
      <div class="actions">
        <button data-open="${workflow.workflowId}">Open</button>
        <button class="secondary" data-duplicate="${workflow.workflowId}">Duplicate</button>
        <button class="secondary" data-archive="${workflow.workflowId}">Archive</button>
        <button class="danger" data-delete="${workflow.workflowId}">Delete</button>
      </div>
    </article>`).join("")
  app.innerHTML = `
    <section class="start"><h2>Start new workflow</h2><div id="error-home" class="section-error"></div>
      <div class="grid">
        <label class="field"><span>Name</span><input id="name" readonly placeholder="Select source and target"></label>
        <label class="field"><span>Description</span><input id="description"></label>
        <label class="field"><span>Source connection</span><select id="source"><option value="">Select source connection</option>${options}</select></label>
        <label class="field"><span>Target connection</span><select id="target"><option value="">Select target connection</option>${options}</select></label>
      </div><div class="actions"><button id="create" disabled>Create workflow</button></div>
    </section>
    <section class="existing"><h2>Open existing workflow</h2>${workflows || '<p class="muted">No existing workflows.</p>'}</section>`

  const source = document.getElementById("source")
  const target = document.getElementById("target")
  const name = document.getElementById("name")
  const create = document.getElementById("create")
  const updateSelection = () => {
    const distinct = source.value && target.value && source.value !== target.value
    name.value = source.value && target.value ? workflowName(source.value, target.value) : ""
    create.disabled = !distinct
    showSectionError("home", source.value && target.value && source.value === target.value ? "Source and target connections must be different." : "")
  }
  source.onchange = updateSelection
  target.onchange = updateSelection
  create.onclick = () => send("create", { name: name.value, description: document.getElementById("description").value, source: source.value, target: target.value })
  bind("open", (workflowId, button) => {
    button.textContent = "Opening…"
    busy = true
    applyBusy()
    send("select", { workflowId })
  })
  bind("duplicate", workflowId => send("duplicate", { workflowId }))
  bind("archive", workflowId => send("archive", { workflowId }))
  bind("delete", workflowId => send("delete", { workflowId }))
}

function renderWorkflow() {
  const workflow = state.workflow
  const criteria = state.criteria || {}
  const sourceLabel = workflow.source.connectionId.toUpperCase()
  const targetLabel = workflow.target.connectionId.toUpperCase()
  const applyTitle =
    workflow.assistedApplyMode === "manual"
      ? "3. Assisted apply"
      : workflow.assistedApplyMode === "copilot"
        ? "3. Copilot-assisted apply"
        : "3. Apply changes"
  document.getElementById("subtitle").textContent = `${workflow.name} · Source: ${sourceLabel} · Target: ${targetLabel}`
  app.innerHTML = `<div class="steps">
    ${step("1. Scope and discovery", "discovery", criteriaForm(criteria, sourceLabel, targetLabel) + discoveryResults(sourceLabel, targetLabel), discoveryActions(), true)}
    ${step("2. Compare systems", "existenceComparison", comparisonStage(sourceLabel, targetLabel), "", complete("discovery"))}
    ${step(applyTitle, "assistedApply", assistedApplyStageView(), assistedApplyActions(), reviewable("sourceComparison"))}
    <section class="step"><div class="step-head"><h2>Copilot assistance</h2></div><label class="field full"><span>What should Copilot help with?</span><input id="copilotPrompt" value="Review the current workflow state and explain the next safe action"></label><div class="actions"><button id="askCopilot">Ask Copilot</button></div></section>
  </div>`
  wireWorkflow(workflow)
  wireWorkflowTables(workflow)
}

function criteriaForm(criteria, sourceLabel, targetLabel) {
  const field = (id, label, value) => `<label class="field"><span>${label}</span><input id="${id}" value="${escapeHtml(value)}"></label>`
  return `<div class="grid">
    <label class="field"><span>Object name pattern</span><input id="includeNames" value="${escapeHtml((criteria.includeNames || [])[0] || "")}"><small>Object name or package is required. When both are entered, objects must match both.</small></label>
    ${field("excludeNames", "Exclude object names", list(criteria.excludeNames))}
    <label class="field"><span>Package patterns</span><input id="packages" value="${escapeHtml(list(criteria.packages))}"><small>Object name or package is required. Use Z*, Y*, or /XYZ/*. * and /* are not allowed.</small></label>
    ${objectTypeSelect("objectTypes", criteria.objectTypes || [])}
    ${field("namespaces", "Customer namespaces", list(criteria.namespaces))}
    ${field("authors", "Authors", list(criteria.authors))}
    ${field("createdFrom", "Created from (YYYYMMDD)", criteria.createdFrom || "")}
    ${field("createdTo", "Created to (YYYYMMDD)", criteria.createdTo || "")}
  </div><div class="actions">
    ${check("includeSubpackages", "Include subpackages", criteria.includeSubpackages)}
    ${check("includeDeleted", "Include deleted", criteria.includeDeleted)}
    ${check("includeGenerated", "Include generated", criteria.includeGenerated)}
    ${check("includeTemporary", "Include $TMP", criteria.includeTemporary)}
  </div><div class="actions"><button id="saveCriteria">Save criteria</button></div>`
}

function step(title, id, body, actions, enabled) {
  const stepId = displayedStepId(id)
  const value = state.workflow.steps[stepId] || {}
  const progress = stepProgress(id, stepId, value)
  const actionBlock = actions
    ? `<div class="actions" data-step-actions="${id}">${actions}</div>`
    : ""
  const progressBlock =
    id === "existenceComparison"
      ? ""
      : `<div data-step-progress="${id}">${progress}</div>`
  const content = enabled ? `${body}${progressBlock}${actionBlock}` : '<p class="muted">Complete the previous stage to continue.</p>'
  return `<section class="step ${enabled ? "" : "locked"}" data-section="${id}"><div class="step-head"><h2>${title}</h2><div class="step-status"><span class="status" data-step-status="${id}">${escapeHtml(value.status)}</span><span data-step-timings="${id}">${stepTimings(id)}</span></div></div><div id="error-${id}" class="section-error">${escapeHtml(value.lastError || "")}</div><div data-run-policy="${id}">${runPolicy(value)}</div>${content}</section>`
}

function runPolicy(value) {
  return value.status === "running"
    ? '<p class="run-policy"><strong>Closing this panel pauses the active workflow.</strong> Copilot will be told that you stopped it and must not restart it automatically.</p>'
    : ""
}

function stepProgress(id, stepId, value) {
  if (value.total !== undefined && ["running", "paused"].includes(value.status))
    return `<div class="progress-label">${escapeHtml(progressLabel(stepId, value))}</div><progress max="${value.total}" value="${value.completed || 0}"></progress>`
  if (value.status === "complete" && id === "discovery")
    return `<div class="progress-label">Discovery complete on ${escapeHtml(state.workflow.source.connectionId.toUpperCase())} and ${escapeHtml(state.workflow.target.connectionId.toUpperCase())}.</div>`
  return ""
}

function updateProgressDisplay() {
  for (const id of ["discovery", "existenceComparison", "assistedApply"]) {
    const stepId = displayedStepId(id)
    const value = state.workflow.steps[stepId] || {}
    const status = document.querySelector(`[data-step-status="${id}"]`)
    if (status) status.textContent = value.status || ""
    const progress = document.querySelector(`[data-step-progress="${id}"]`)
    if (progress) progress.innerHTML = stepProgress(id, stepId, value)
  }
}

function updateWorkflowChrome() {
  updateProgressDisplay()
  clearStaleSourceResults()
  for (const id of ["discovery", "existenceComparison", "assistedApply"]) {
    const stepId = displayedStepId(id)
    const value = state.workflow.steps[stepId] || {}
    const policy = document.querySelector(`[data-run-policy="${id}"]`)
    if (policy) policy.innerHTML = runPolicy(value)
    const timings = document.querySelector(`[data-step-timings="${id}"]`)
    if (timings) timings.innerHTML = stepTimings(id)
    const error = document.getElementById(`error-${id}`)
    if (error) error.textContent = value.lastError || ""
  }
  updateWorkflowActions()
  updateElapsedCounters()
  applyBusy()
}

function clearStaleSourceResults() {
  const sourceWorkRunning =
    state.workflow.runState === "running" &&
    ["sourceSelection", "sourceDownload", "sourceComparison"].includes(
      state.workflow.currentStep
    )
  if (!sourceWorkRunning) return
  clearSourceResultViews()
}

function clearSourceResultViews() {
  destroyWorkflowTable("sourceComparison")
  document.querySelector("[data-source-comparison-results]")?.remove()
  destroyWorkflowTable("assistedApplyPlan")
  document.querySelector("[data-assisted-apply-results]")?.remove()
}

function displayedStepId(id) {
  if (id === "assistedApply")
    return state.workflow.currentStep === "transportCheck"
      ? "transportCheck"
      : "assistedApplyPlan"
  if (id === "existenceComparison") {
    if (
      ["sourceSelection", "sourceDownload", "sourceComparison"].includes(
        state.workflow.currentStep
      )
    )
      return state.workflow.currentStep
    if (state.workflow.steps.sourceComparison.status === "partial") return "sourceComparison"
  }
  return id
}

function stepTimings(id) {
  const timingSteps = {
    discovery: [["discovery", "Discovery"], ["existenceComparison", "Inventory comparison"]],
    existenceComparison: [["sourceDownload", "Download"], ["sourceComparison", "Source comparison"]],
    assistedApply: [["assistedApplyPlan", "Plan"], ["transportCheck", "Transport check"]]
  }[id] || []
  const timings = timingSteps.flatMap(([stepId, label]) => {
    const value = state.workflow.steps[stepId] || {}
    if (!value.startedAt) return []
    return [`<span class="step-timing" data-timing-label="${escapeHtml(label)}" data-timing-status="${escapeHtml(value.status)}" data-elapsed-ms="${escapeHtml(value.elapsedMs ?? "")}" data-started-at="${escapeHtml(value.startedAt)}" data-completed-at="${escapeHtml(value.completedAt || "")}"></span>`]
  })
  return timings.length ? `<span class="step-timings">${timings.join("")}</span>` : ""
}

function updateElapsedCounters() {
  document.querySelectorAll("[data-started-at]").forEach(element => {
    const startedAt = Date.parse(element.dataset.startedAt)
    const completedAt = Date.parse(element.dataset.completedAt)
    if (!Number.isFinite(startedAt)) return
    const hasSavedElapsed = element.dataset.elapsedMs !== ""
    const savedElapsed = hasSavedElapsed ? Number(element.dataset.elapsedMs) : 0
    const elapsed = hasSavedElapsed
      ? savedElapsed + (element.dataset.timingStatus === "running" ? Math.max(0, Date.now() - startedAt) : 0)
      : Math.max(0, (Number.isFinite(completedAt) ? completedAt : Date.now()) - startedAt)
    element.textContent = `${element.dataset.timingLabel}: ${formatElapsed(elapsed)}`
  })
}

function formatElapsed(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const seconds = String(totalSeconds % 60).padStart(2, "0")
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}:${seconds}`
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, "0")}:${seconds}`
}

function progressLabel(id, value) {
  if (id === "discovery") {
    const side = String(value.checkpoint || "").startsWith("target:") ? "target" : "source"
    const connection = state.workflow[side].connectionId.toUpperCase()
    const packageCount = String(value.checkpoint || "").split(":")[1]
    const scope = (state.criteria?.includeNames || []).length
      ? ` by object name ${state.criteria.includeNames[0]}`
      : packageCount
        ? ` across ${packageCount} resolved package${packageCount === "1" ? "" : "s"}`
        : ""
    return `Scanning ${side} inventory on ${connection}${scope}: ${value.completed || 0} of ${value.total} systems`
  }
  if (id === "sourceDownload" && ["resuming", "verifying"].includes(value.checkpoint))
    return `Verifying current state before resuming… ${value.completed || 0} of ${value.total}`
  if (id === "sourceDownload" && value.checkpoint === "preparing")
    return `Preparing source and target snapshot downloads: ${value.completed || 0} of ${value.total}`
  if (id === "sourceDownload" && value.checkpoint === "resolving object URIs")
    return `Resolving source and target objects before download: ${value.completed || 0} of ${value.total}`
  if (id === "sourceDownload")
    return `Downloading source and target snapshots: ${value.completed || 0} of ${value.total}`
  if (id === "sourceComparison" && value.checkpoint === "getting object structures")
    return `Getting object structures for formatted comparison: ${value.completed || 0} of ${value.total}`
  if (id === "sourceComparison" && value.checkpoint === "formatting")
    return `Formatting source and target snapshots: ${value.completed || 0} of ${value.total}`
  if (id === "sourceComparison")
    return `Comparing downloaded source snapshots: ${value.completed || 0} of ${value.total}`
  if (id === "transportCheck")
    return `Checking target transport status: ${value.completed || 0} of ${value.total}`
  return `${value.completed || 0} of ${value.total} complete`
}

function discoveryResults(sourceLabel, targetLabel) {
  if (!complete("discovery")) return ""
  return `<div class="result-stack">
    ${inventoryBlock(`Source inventory — ${sourceLabel}`, state.previews.sourceDiscovery, "sourceDiscovery")}
    ${inventoryBlock(`Target inventory — ${targetLabel}`, state.previews.targetDiscovery, "targetDiscovery")}
  </div>`
}

function inventoryBlock(title, rows, output) {
  const count = state.exportAvailability?.[output]?.rows ?? rows?.length ?? 0
  const typeCounts = countBy(rows || [], row => row.objectType)
  const views = [...typeCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, typeCount]) => ({
      value: `type:${type}`,
      label: type,
      count: typeCount
    }))
  return `<section class="result-block"><div class="result-head"><div class="result-heading"><h3>${escapeHtml(title)}</h3></div><span>${count.toLocaleString()} objects</span></div>${tableTools(output, rows?.length || 0, views, "All object types", singleExport(output, `Export ${title}`))}${inventoryTable(rows, output)}</section>`
}

function inventoryTable(rows, output) {
  if (!rows || !rows.length) return '<p class="muted">No objects matched.</p>'
  return `<div id="table-${output}" class="workflow-table"></div>`
}

function comparisonStage(sourceLabel, targetLabel) {
  const existence = state.previews.existenceComparison || []
  const source = state.previews.sourceComparison || []
  const explanation = existence.length
    ? `<p class="muted">Choose which objects found on both systems should have their source downloaded and compared. Objects found on only one system cannot be source-compared.</p>`
    : `<p class="muted">Compare the two inventories to see which objects exist on both systems and which exist on only one.</p>`
  const concurrency = existence.length ? downloadConcurrency(sourceLabel, targetLabel) : ""
  const existenceResults = existence.length ? existenceTable(existence) : ""
  const actions = `<div class="actions" data-step-actions="existenceComparison">${comparisonActions()}</div>`
  const stepId = displayedStepId("existenceComparison")
  const progress = `<div data-step-progress="existenceComparison">${stepProgress("existenceComparison", stepId, state.workflow.steps[stepId] || {})}</div>`
  const sourceResults = source.length
    ? `<div data-source-comparison-results><div class="result-head source-comparison-head"><div class="result-heading"><h3>Source-code differences</h3></div><span>${source.length.toLocaleString()} objects</span></div>${sourceTable(source)}</div>`
    : ""
  return `${explanation}${concurrency}${existenceResults}${actions}${progress}${sourceResults}`
}

function downloadConcurrency(sourceLabel, targetLabel) {
  const criteria = state.criteria || {}
  return `<div class="grid compact-grid">
    <label class="field"><span>Parallel downloads from ${sourceLabel}</span><input id="sourceConcurrency" type="number" min="1" max="10" value="${escapeHtml(criteria.sourceConcurrency || 5)}"><small>Maximum source objects downloaded simultaneously.</small></label>
    <label class="field"><span>Parallel downloads from ${targetLabel}</span><input id="targetConcurrency" type="number" min="1" max="10" value="${escapeHtml(criteria.targetConcurrency || 5)}"><small>Maximum target objects downloaded simultaneously.</small></label>
    <label class="field"><span>Parallel local snapshot verification</span><input id="verificationConcurrency" type="number" min="1" max="128" value="${escapeHtml(criteria.verificationConcurrency || 32)}"><small>Local filesystem work only; does not increase SAP requests.</small></label>
  </div>`
}

function existenceTable(rows) {
  const presentOnBoth = rows.filter(row => row.status === "both")
  const comparable = rows.filter(sourceComparable)
  const excludedContainers = presentOnBoth.length - comparable.length
  const sourceOnly = rows.filter(row => row.status === "source-only").length
  const targetOnly = rows.filter(row => row.status === "target-only").length
  const comparableKeys = new Set(comparable.map(row => row.key))
  const workflowId = state.workflow.workflowId
  const comparisonRevision = state.workflow.steps.existenceComparison?.completedAt || ""
  if (sourceSelectionRevisions[workflowId] !== comparisonRevision) {
    sourceSelectionRevisions[workflowId] = comparisonRevision
    const persisted = state.previews.sourceSelection?.keys
    sourceSelections[workflowId] = new Set(
      Array.isArray(persisted)
        ? persisted.filter(key => comparableKeys.has(key))
        : comparableKeys
    )
  } else
    sourceSelections[workflowId] = new Set(
      [...sourceSelections[workflowId]].filter(key => comparableKeys.has(key))
    )
  const selected = sourceSelections[workflowId]
  const allSelected = comparable.length > 0 && comparable.every(row => selected.has(row.key))
  const selectionLocked = sourceSelectionLocked()
  const views = [
    { value: "comparable", label: "Comparable", count: comparable.length },
    { value: "selected", label: "Selected comparable", count: selected.size },
    {
      value: "unselected",
      label: "Unselected comparable",
      count: comparable.length - selected.size
    },
    { value: "source-only", label: "Source only", count: sourceOnly },
    { value: "target-only", label: "Target only", count: targetOnly },
    { value: "packages", label: "Excluded packages", count: excludedContainers }
  ]
  return `<p class="muted">${rows.length.toLocaleString()} unique repository keys: ${presentOnBoth.length.toLocaleString()} present on both, ${sourceOnly.toLocaleString()} source-only, and ${targetOnly.toLocaleString()} target-only. ${excludedContainers ? `${excludedContainers.toLocaleString()} packages excluded from source comparison.` : ""}</p><div class="selection-tools"><label><input id="selectAllSources" data-has-comparable="${comparable.length ? "true" : "false"}" type="checkbox" ${allSelected ? "checked" : ""} ${comparable.length && !selectionLocked ? "" : "disabled"}> Select all comparable objects</label><button id="selectFilteredSources" class="secondary" type="button">Select filtered</button><button id="clearFilteredSources" class="secondary" type="button">Clear filtered</button><button id="importSourceSelection" class="secondary" type="button">Import selection</button><span id="selectedSourceCount">${selected.size.toLocaleString()} of ${comparable.length.toLocaleString()} selected</span></div><p class="muted">For a bulk selection, export the inventory comparison, mark wanted rows with <strong>X</strong> in the first <strong>Selected</strong> column, then import the XLSX or CSV. Existing checks are replaced; unknown, source-only, target-only, and package rows are ignored even when marked.</p><p id="selectionImportStatus" class="muted"></p>${tableTools("existenceComparison", rows.length, views, "All inventory results", singleExport("existenceComparison", "Export inventory comparison"))}<div id="table-existenceComparison" class="workflow-table"></div>`
}

function comparisonActions() {
  const existenceReady = complete("existenceComparison")
  const selected = sourceSelections[state.workflow.workflowId]?.size || 0
  const sourceStep = state.workflow.currentStep
  const incomplete =
    state.workflow.steps.sourceDownload.status === "partial" ||
    state.workflow.steps.sourceComparison.status === "partial"
  const resumable =
    incomplete ||
    (["paused", "interrupted", "failed"].includes(state.workflow.runState) &&
      ["sourceDownload", "sourceComparison"].includes(sourceStep))
  const selectionChanged = sourceSelectionChanged(state.workflow.workflowId)
  const primaryAction = !existenceReady
    ? '<button id="existence">Compare inventories</button>'
    : resumable
      ? `<button id="resumeSourceComparison">${selectionChanged ? "Apply changed selection and resume" : incomplete ? "Retry incomplete objects" : "Resume source comparison"}</button>`
      : `<button id="compareSourceCode" ${selected ? "" : "disabled"}>Compare selected source code</button>`
  return `${primaryAction}${pauseButton("existenceComparison", "sourceSelection", "sourceDownload", "sourceComparison")}`
}

function sourceTable(rows) {
  if (!rows || !rows.length) return '<div class="muted">No persisted output yet.</div>'
  const statusCounts = countBy(rows, row => row.status)
  const rawDifferent = rows.filter(isRawDifferent).length
  const formattedDifferent = rows.filter(row => row.formattedIdentical === false).length
  const incomplete = rows.filter(
    row => !["different", "identical"].includes(row.status)
  ).length
  const views = [
    {
      value: "attention",
      label: "Needs attention",
      count: rows.length - (statusCounts.get("identical") || 0)
    },
    {
      value: "different-raw",
      label: "Different (raw)",
      count: rawDifferent
    },
    {
      value: "different-formatted",
      label: "Different (formatted)",
      count: formattedDifferent
    },
    { value: "incomplete", label: "Incomplete or failed", count: incomplete },
    {
      value: "identical",
      label: "Identical",
      count: statusCounts.get("identical") || 0
    }
  ]
  return `<p class="muted">Line counts describe the textual diff. Reordered code may appear as removed and added lines.</p>${tableTools("sourceComparison", rows.length, views, "All source results", singleExport("sourceComparison", "Export source comparison"))}<div id="table-sourceComparison" class="workflow-table"></div>`
}

function assistedApplyStageView() {
  if (state.workflow.assistedApplyMode === "manual") return assistedApplyView()
  if (state.workflow.assistedApplyMode === "copilot") return copilotAssistedApplyView()
  const copilotButton = state.workflow.copilotAssistedApplyEnabledAt
    ? "Use Copilot-assisted apply"
    : "Enable Copilot-assisted apply"
  return `<p class="muted">Choose how changes should be applied to the target system. This choice is saved only for this workflow. You can switch later without losing the saved Copilot selection or completion status.</p><div class="apply-mode-choices"><article><h3>Assisted apply</h3><p>Review each object and stage its raw source in a target editor. You remain responsible for saving, transport selection, and activation.</p><button id="chooseManualAssistedApply">Use assisted apply</button></article><article><h3>Copilot-assisted apply</h3><p>Select the exact objects Copilot may act on. Enabling this mode requires confirmation because later execution can modify the target SAP system.</p><button id="chooseCopilotAssistedApply">${copilotButton}</button></article></div>`
}

function assistedApplyView() {
  const plan = state.previews.assistedApplyPlan
  const source = state.workflow.source.connectionId.toUpperCase()
  const target = state.workflow.target.connectionId.toUpperCase()
  const direction = `<p><strong>Source: ${escapeHtml(source)}</strong> → <strong>Target: ${escapeHtml(target)}</strong></p><p class="muted">Assisted apply can place one reviewed source file in a dirty ${escapeHtml(target)} editor. It never saves or activates SAP objects. Stage all related includes or components before saving and activate them together.</p>`
  const safety = state.assistedApplySafety || {}
  const warnings = []
  if (safety.autoSave !== "off") warnings.push(`<p class="apply-policy blocked">ABAP-effective <code>files.autoSave</code> is <strong>${escapeHtml(safety.autoSave || "enabled")}</strong>. Staging is blocked because a dirty target editor could be saved automatically. <button id="openAutoSaveSettings" class="secondary">Open ABAP auto-save setting</button></p>`)
  if (safety.chatSaveBeforeSend) warnings.push('<p class="apply-policy blocked"><code>chat.saveBeforeSend</code> is enabled. Sending a Copilot message could save a staged target editor. <button id="openChatSaveSettings" class="secondary">Open chat save setting</button></p>')
  const policy = warnings.join("") || '<p class="apply-policy allowed">Assisted-apply editor safety settings are configured: ABAP auto-save is off and chat save before send is disabled.</p>'
  if (!plan) return direction + policy + '<p class="muted">Prepare an assisted-apply plan to identify changed objects that can be staged safely and explain any exclusions.</p>'
  const eligible = plan.items.filter(item => item.eligible).length
  const unchanged = plan.items.filter(item => assistedApplyDecision(item) === "No action").length
  const blocked = plan.items.length - eligible - unchanged
  const summary = `<p>Relevance basis: <strong>${escapeHtml(plan.comparisonBasis || "raw")}</strong>. <strong>${eligible}</strong> ready for assisted apply, <strong>${unchanged}</strong> with no relevant differences, <strong>${blocked}</strong> blocked.</p>`
  return direction + policy + `<div data-assisted-apply-results>${summary}${assistedApplyPlanTable(plan.items, false)}${assistedApplyExecutionHistoryView()}</div>`
}

function copilotAssistedApplyView() {
  const plan = state.previews.assistedApplyPlan
  const source = state.workflow.source.connectionId.toUpperCase()
  const target = state.workflow.target.connectionId.toUpperCase()
  const direction = `<p><strong>Source: ${escapeHtml(source)}</strong> → <strong>Target: ${escapeHtml(target)}</strong></p><p class="apply-policy blocked"><strong>Copilot-assisted apply is enabled for this workflow.</strong> Only objects you select and save below are approved candidates. Copilot can save all changed text resources for one reviewed object at a time with a user-directed transport. Every attempt is recorded; activation remains a separate verified step.</p>`
  if (!plan)
    return direction + '<p class="muted">Prepare the assisted-apply plan, then select the exact eligible objects Copilot may act on.</p>'
  initializeCopilotAssistedApplySelection(plan)
  const eligible = plan.items.filter(item => item.eligible).length
  const selected = copilotAssistedApplySelections[state.workflow.workflowId]?.size || 0
  const completed = new Set(
    state.previews.copilotAssistedApplySelection?.completedKeys || []
  )
  const done = [...(copilotAssistedApplySelections[state.workflow.workflowId] || [])].filter(
    key => completed.has(key)
  ).length
  const summary = `<p>Relevance basis: <strong>${escapeHtml(plan.comparisonBasis || "raw")}</strong>. <strong>${eligible}</strong> eligible; <strong>${selected}</strong> selected, <strong>${done}</strong> done, and <strong>${selected - done}</strong> pending.</p>`
  return direction + `<div data-assisted-apply-results>${summary}${assistedApplyPlanTable(plan.items, true)}${assistedApplyExecutionHistoryView()}</div>`
}

function assistedApplyExecutionHistoryView() {
  if (!assistedApplyExecutionHistory) return ""
  const events = assistedApplyExecutionHistory.events || []
  const rows = [...events]
    .reverse()
    .map(
      event =>
        `<tr><td>${escapeHtml(event.timestamp)}</td><td>${escapeHtml(event.attemptId)}</td><td>${escapeHtml(event.eventId)}</td><td>${escapeHtml(event.resourcePath || "Object")}</td><td>${escapeHtml(event.stage)}</td><td>${escapeHtml(event.status)}</td><td>${escapeHtml(event.intentId || "")}</td><td>${escapeHtml(event.transportChoiceType || "")}</td><td>${escapeHtml(event.transportRequest || "")}</td><td>${escapeHtml(event.inactiveSourceVerified ?? "")}</td><td>${escapeHtml(event.sourceHash || "")}</td><td>${escapeHtml(event.targetHash || "")}</td><td>${escapeHtml((event.activationObjectUrls || []).join("\n"))}</td><td>${escapeHtml(event.error || "")}</td></tr>`
    )
    .join("")
  return `<section class="execution-history"><div class="execution-history-head"><h3>Execution history: ${escapeHtml(assistedApplyExecutionHistory.objectKey)}</h3><button id="closeAssistedApplyExecutionHistory" class="secondary" type="button">Close</button></div><p class="muted">${events.length.toLocaleString()} persisted lifecycle event${events.length === 1 ? "" : "s"}, newest first.</p><div class="execution-history-table"><table><thead><tr><th>Time</th><th>Attempt</th><th>Event</th><th>Resource</th><th>Stage</th><th>Status</th><th>Intent</th><th>Transport choice</th><th>Transport</th><th>Inactive verified</th><th>Source hash</th><th>Target hash</th><th>Activated URLs</th><th>Error</th></tr></thead><tbody>${rows || '<tr><td colspan="14">No execution history for this object.</td></tr>'}</tbody></table></div></section>`
}

function initializeCopilotAssistedApplySelection(plan) {
  const workflowId = state.workflow.workflowId
  const selection = state.previews.copilotAssistedApplySelection
  const revision = `${plan.createdAt || ""}:${selection?.updatedAt || ""}`
  const eligible = new Set(plan.items.filter(item => item.eligible).map(item => item.key))
  if (copilotAssistedApplySelectionRevisions[workflowId] !== revision) {
    copilotAssistedApplySelectionRevisions[workflowId] = revision
    copilotAssistedApplySelections[workflowId] = new Set(
      (selection?.keys || []).filter(key => eligible.has(key))
    )
    return
  }
  copilotAssistedApplySelections[workflowId] = new Set(
    [...(copilotAssistedApplySelections[workflowId] || [])].filter(key => eligible.has(key))
  )
}

function initializeManualAssistedApplySelection(plan) {
  const workflowId = state.workflow.workflowId
  const revision = plan.createdAt || ""
  const eligible = new Set(plan.items.filter(item => item.eligible).map(item => item.key))
  if (manualAssistedApplySelectionRevisions[workflowId] !== revision) {
    manualAssistedApplySelectionRevisions[workflowId] = revision
    manualAssistedApplySelections[workflowId] = new Set()
    return
  }
  manualAssistedApplySelections[workflowId] = new Set(
    [...(manualAssistedApplySelections[workflowId] || [])].filter(key => eligible.has(key))
  )
}

function currentAssistedApplySelection() {
  const workflowId = state.workflow?.workflowId
  if (!workflowId) return new Set()
  return state.workflow.assistedApplyMode === "copilot"
    ? copilotAssistedApplySelections[workflowId] || new Set()
    : manualAssistedApplySelections[workflowId] || new Set()
}

function assistedApplyPlanTable(rows, copilot) {
  if (!rows?.length) return '<p class="muted">No assisted-apply items.</p>'
  if (!copilot) initializeManualAssistedApplySelection(state.previews.assistedApplyPlan)
  const decisionCount = decision =>
    rows.filter(row => assistedApplyDecision(row) === decision).length
  const selected = currentAssistedApplySelection().size
  const completed = new Set(
    state.previews.copilotAssistedApplySelection?.completedKeys || []
  )
  const done = [...(copilotAssistedApplySelections[state.workflow.workflowId] || [])].filter(
    key => completed.has(key)
  ).length
  const views = [
    { value: "selected-ready", label: "Selected ready", count: selected },
    {
      value: "unselected-ready",
      label: "Unselected ready",
      count: decisionCount("Ready") - selected
    },
    ...(copilot
      ? [
          { value: "pending", label: "Pending", count: selected - done },
          { value: "done", label: "Done", count: done }
        ]
      : []),
    {
      value: "ready",
      label: copilot ? "Eligible" : "Ready to stage",
      count: decisionCount("Ready")
    },
    { value: "blocked", label: "Blocked", count: decisionCount("Blocked") },
    {
      value: "no-action",
      label: "No action needed",
      count: decisionCount("No action")
    }
  ]
  const exportAction = singleExport("assistedApplyPlan", "Export assisted-apply table")
  const selectionTools = copilot
    ? `<div class="action-group selection-tools"><span class="action-group-label">Selection</span><label><input id="selectAllCopilotApply" type="checkbox"> Select all eligible</label><button id="selectFilteredCopilotApply" class="secondary" type="button" title="Select every eligible row matching the current table filters">Select filtered</button><button id="clearFilteredCopilotApply" class="secondary" type="button" title="Deselect every eligible row matching the current table filters">Deselect filtered</button><button id="importCopilotAssistedApplySelection" class="secondary" type="button">Import</button><span id="selectedCopilotApplyCount" class="selection-count"></span><button id="saveCopilotAssistedApplySelection" type="button">Save selection</button><span id="copilotSelectionSaveStatus" class="selection-save-status"></span></div><p class="muted">Optional: export the table, mark wanted eligible rows with <strong>X</strong> in <strong>Selected</strong>, then import. Imported checks are not available to Copilot until you save them.</p><p id="copilotSelectionImportStatus" class="muted"></p>`
    : `<div class="action-group selection-tools"><span class="action-group-label">Selection</span><label><input id="selectAllManualApply" type="checkbox"> Select all eligible</label><button id="selectFilteredManualApply" class="secondary" type="button" title="Select every eligible row matching the current table filters">Select filtered</button><button id="clearFilteredManualApply" class="secondary" type="button" title="Deselect every eligible row matching the current table filters">Deselect filtered</button><span id="selectedManualApplyCount" class="selection-count"></span></div><p class="muted">Tick only the objects whose target transport status should be checked. This selection does not stage or save source.</p>`
  return `${selectionTools}${tableTools("assistedApplyPlan", rows.length, views, "All plan items", exportAction)}<div id="table-assistedApplyPlan" class="workflow-table"></div>`
}

function discoveryActions() {
  const resumable = ["paused", "interrupted", "failed"].includes(
    state.workflow.steps.discovery.status
  )
  return `<button id="${resumable ? "resumeDiscovery" : "discover"}">${resumable ? "Resume discovery" : complete("discovery") ? "Run discovery again" : "Run discovery"}</button>${pauseButton("discovery")}`
}

function assistedApplyActions() {
  if (!state.workflow.assistedApplyMode) return ""
  const basis = state.previews.assistedApplyPlan?.comparisonBasis || "formatted"
  const selected = currentAssistedApplySelection().size
  const concurrency = state.criteria?.transportConcurrency || 5
  const planGroup = `<div class="action-group"><span class="action-group-label">Plan</span><label class="assisted-apply-basis">Relevance <select id="assistedApplyComparisonBasis"><option value="formatted" ${basis === "formatted" ? "selected" : ""}>Formatted differences</option><option value="raw" ${basis === "raw" ? "selected" : ""}>Raw differences</option></select></label><button id="prepareAssistedApply">${complete("assistedApplyPlan") ? "Refresh plan" : "Prepare plan"}</button><button id="changeAssistedApplyMode" class="secondary" type="button">Change apply mode</button>${pauseButton("assistedApplyPlan", "transportCheck")}</div>`
  const transportGroup = state.previews.assistedApplyPlan
    ? `<div class="action-group"><span class="action-group-label">Transport</span><label class="assisted-apply-basis" title="How many selected objects to check at once on the target system">Concurrent checks <input id="transportConcurrency" type="number" min="1" max="10" value="${escapeHtml(concurrency)}"></label><button id="determineTransportRequests" ${selected ? "" : "disabled"}>Check selected objects</button></div>`
    : ""
  return `<div class="action-groups">${planGroup}${transportGroup}</div>`
}

function updateWorkflowActions() {
  const actions = {
    discovery: discoveryActions(),
    existenceComparison: comparisonActions(),
    assistedApply: assistedApplyActions()
  }
  for (const [id, content] of Object.entries(actions)) {
    const container = document.querySelector(`[data-step-actions="${id}"]`)
    if (container) container.innerHTML = content
  }
  wireWorkflowActions(state.workflow)
}

function pauseButton(...steps) {
  return state.workflow.runState === "running" && steps.includes(state.workflow.currentStep)
    ? '<button class="pause">Pause</button>'
    : ""
}

function objectKeyParts(key) {
  const [, type = "", ...name] = String(key || "").split(":")
  return { type, name: name.join(":") || key }
}

function assistedApplyDecision(row) {
  if (row.eligible) return "Ready"
  return row.relevant === false ||
    (row.relevant === undefined &&
      (row.blockingReasons || []).includes("Source status is identical"))
    ? "No action"
    : "Blocked"
}

function copilotAssistedApplyStatus(row, selected) {
  if (!row.eligible) return "Not applicable"
  if (!selected) return "Not selected"
  return (state.previews.copilotAssistedApplySelection?.completedKeys || []).includes(row.key)
    ? "Done"
    : "Pending"
}

function copilotAssistedApplyDecision(row, selected) {
  if (!row.eligible || !selected) return ""
  return (
    state.previews.copilotAssistedApplySelection?.decisions?.[row.key] || "needs-human"
  )
}

function copilotAssistedApplyDecisionReason(row, selected) {
  if (!row.eligible || !selected) return ""
  return state.previews.copilotAssistedApplySelection?.decisionReasons?.[row.key] || ""
}

function transportCheckStatusLabel(row) {
  if (row.transportCheckStatus === "locked") return "Transport found"
  if (row.transportCheckStatus === "not-locked") return "No transport lock"
  if (row.transportCheckStatus === "no-transport") return "No TR"
  if (row.transportCheckStatus === "local") return "Local object"
  if (row.transportCheckStatus === "error") return "Check failed"
  return "Not checked"
}

function countBy(rows, value) {
  const counts = new Map()
  for (const row of rows) {
    const key = String(value(row) || "")
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

function tableTools(id, total, views, allLabel, extraActions = "") {
  const stateKey = `${state.workflow.workflowId}:${id}`
  const selectedView = workflowTableViews[stateKey] || "all"
  const options = [
    `<option value="all" ${selectedView === "all" ? "selected" : ""}>${escapeHtml(allLabel)} (${total.toLocaleString()})</option>`,
    ...views.map(
      view =>
        `<option value="${escapeHtml(view.value)}" data-label="${escapeHtml(view.label)}" ${selectedView === view.value ? "selected" : ""}>${escapeHtml(view.label)} (${view.count.toLocaleString()})</option>`
    )
  ]
  return `<div class="action-group table-tools"><span class="action-group-label">Table</span><label>Show <select data-table-view="${id}">${options.join("")}</select></label><button class="secondary" type="button" data-clear-table="${id}" title="Clear column filters and the Show view">Clear filters</button>${extraActions}<span id="table-count-${id}" class="table-count">Showing ${total.toLocaleString()} of ${total.toLocaleString()}</span></div>`
}

function sourceComparable(row) {
  const objectType = String(row.objectType || "").toUpperCase()
  return (
    row.status === "both" &&
    !(state.sourceComparisonExcludedTypes || []).some(
      excluded => String(excluded).toUpperCase() === objectType
    )
  )
}

function wireWorkflowTables(workflow) {
  wireInventoryTable("sourceDiscovery")
  wireInventoryTable("targetDiscovery")
  wireExistenceTable(workflow)
  wireSourceComparisonTable()
  wireAssistedApplyTable()
}

function wireInventoryTable(output) {
  createWorkflowTable(output, state.previews[output] || [], [
    textColumn("Object", "objectName", 220),
    textColumn("Type", "objectType", 100),
    textColumn("Package", "packageName", 180),
    textColumn("Classification", "classification", 130),
    textColumn("Classification reason", "classificationReason", 280)
  ])
}

function wireExistenceTable(workflow) {
  const rows = (state.previews.existenceComparison || []).map(row => ({
    ...row,
    selected: sourceComparable(row) && sourceSelections[workflow.workflowId].has(row.key),
    result:
      row.status === "both" && !sourceComparable(row)
        ? "Present on both — container excluded"
        : {
            both: "Present on both",
            "source-only": `Only on ${workflow.source.connectionId.toUpperCase()}`,
            "target-only": `Only on ${workflow.target.connectionId.toUpperCase()}`,
            error: "Error"
          }[row.status] || row.status
  }))
  const comparableCount = rows.filter(sourceComparable).length
  const table = createWorkflowTable(
    "existenceComparison",
    rows,
    [
      {
        title: "Compare",
        field: "selected",
        width: 72,
        hozAlign: "center",
        headerHozAlign: "center",
        headerSort: false,
        headerFilter: false,
        formatter: cell => {
          const row = cell.getRow().getData()
          return `<input class="table-selection-checkbox" data-selectable="${sourceComparable(row) ? "true" : "false"}" type="checkbox" ${row.selected ? "checked" : ""} ${sourceComparable(row) && !sourceSelectionLocked() ? "" : "disabled"} aria-label="Compare ${escapeHtml(row.objectName || row.key)}">`
        },
        cellClick: (event, cell) => {
          if (!event.target?.classList?.contains("table-selection-checkbox")) return
          const row = cell.getRow().getData()
          if (!sourceComparable(row) || sourceSelectionLocked()) return
          if (event.target.checked) sourceSelections[workflow.workflowId].add(row.key)
          else sourceSelections[workflow.workflowId].delete(row.key)
          void cell.getRow().update({ selected: event.target.checked })
          updateSourceSelectionControls(workflow.workflowId, comparableCount)
        }
      },
      textColumn("Object", "objectName", 220),
      textColumn("Type", "objectType", 100),
      textColumn("Package", "packageName", 180),
      textColumn("Result", "result", 170)
    ],
    {
      index: "key",
      selectableRows: false
    }
  )
  if (!table) return
  table.on("tableBuilt", () =>
    updateSourceSelectionControls(workflow.workflowId, comparableCount)
  )
}

function wireSourceComparisonTable() {
  const rows = (state.previews.sourceComparison || []).map(row => {
    const object = objectKeyParts(row.key)
    return { ...row, objectName: object.name, objectType: object.type }
  })
  createWorkflowTable("sourceComparison", rows, [
    textColumn("Object", "objectName", 220, "Repository object name."),
    textColumn("Type", "objectType", 100, "TADIR repository object type."),
    textColumn(
      "Status",
      "status",
      130,
      "Overall raw snapshot result. Unlike Raw equal, this also reports incomplete, missing, and failed snapshots."
    ),
    textColumn(
      "Raw equal",
      "rawIdentical",
      100,
      "True when the aggregate hashes of every exact downloaded source and target resource match."
    ),
    textColumn(
      "Formatted equal",
      "formattedIdentical",
      125,
      "True when both ABAPLint-formatted snapshot trees match. ABAP files use the fixed formatter configuration; other resources are copied unchanged."
    ),
    numberColumn(
      "Raw differing files",
      "rawFilesChanged",
      "Number of exact downloaded resources that were added, removed, or have different raw hashes."
    ),
    numberColumn(
      "Formatted differing files",
      "formattedFilesChanged",
      "Number of resources that remain added, removed, or different after ABAP formatting. Formatting does not create extra files."
    ),
    numberColumn(
      "Raw source lines",
      "rawSourceLines",
      "Total text lines across all exact downloaded source resources."
    ),
    numberColumn(
      "Formatted source lines",
      "formattedSourceLines",
      "Total text lines across all formatted source resources."
    ),
    numberColumn(
      "Raw target lines",
      "rawTargetLines",
      "Total text lines across all exact downloaded target resources."
    ),
    numberColumn(
      "Formatted target lines",
      "formattedTargetLines",
      "Total text lines across all formatted target resources."
    ),
    numberColumn(
      "Raw lines added",
      "rawLinesAdded",
      "Lines present only in the raw source side after line-based diff alignment."
    ),
    numberColumn(
      "Formatted lines added",
      "formattedLinesAdded",
      "Lines present only in the formatted source side after line-based diff alignment."
    ),
    numberColumn(
      "Raw lines removed",
      "rawLinesRemoved",
      "Lines present only in the raw target side after line-based diff alignment."
    ),
    numberColumn(
      "Formatted lines removed",
      "formattedLinesRemoved",
      "Lines present only in the formatted target side after line-based diff alignment."
    ),
    numberColumn(
      "Raw lines changed",
      "rawLinesChanged",
      "Paired raw removed and added lines in the same diff hunk, counted as replacements."
    ),
    numberColumn(
      "Formatted lines changed",
      "formattedLinesChanged",
      "Paired formatted removed and added lines in the same diff hunk, counted as replacements."
    ),
    textColumn(
      "Details",
      "error",
      260,
      "Snapshot download, comparison, or ABAP formatting error details."
    ),
    {
      title: "Review",
      headerTooltip: "Open the exact downloaded diff or the ABAPLint-formatted diff.",
      headerSort: false,
      headerFilter: false,
      minWidth: 210,
      formatter: cell => {
        const row = cell.getRow().getData()
        return `<div class="compact-table-actions"><button class="secondary" data-representation="raw" ${row.rawDiffFiles ? "" : "disabled"}>Raw diff</button><button class="secondary" data-representation="formatted" ${row.formattedDiffFiles && !row.formattedError ? "" : "disabled"}>Formatted diff</button></div>`
      },
      cellClick: (event, cell) => {
        const representation = event.target?.dataset?.representation
        if (!representation || event.target.disabled) return
        const row = cell.getRow().getData()
        send("openDiff", { key: row.key, representation })
      }
    }
  ])
}

function wireAssistedApplyTable() {
  const copilot = state.workflow.assistedApplyMode === "copilot"
  const workflowId = state.workflow.workflowId
  const selections = currentAssistedApplySelection()
  const comparisons = new Map(
    (state.previews.sourceComparison || []).map(comparison => [comparison.key, comparison])
  )
  const rows = (state.previews.assistedApplyPlan?.items || []).map(row => {
    const reasons = row.blockingReasons || []
    const decision = assistedApplyDecision(row)
    const comparison = comparisons.get(row.key) || {}
    const execution = state.previews.assistedApplyExecutionSummaries?.[row.key] || {}
    return {
      ...row,
      selected: selections.has(row.key),
      copilotStatus: copilot
        ? copilotAssistedApplyStatus(
            row,
            selections.has(row.key)
          )
        : undefined,
      copilotDecision: copilot
        ? copilotAssistedApplyDecision(
            row,
            selections.has(row.key)
          )
        : undefined,
      copilotDecisionReason: copilot
        ? copilotAssistedApplyDecisionReason(row, selections.has(row.key))
        : undefined,
      transportRequest: row.transportRequest || "",
      transportCheckStatusLabel: transportCheckStatusLabel(row),
      transportDetails: row.transportCheckError || row.transportDescription || "",
      transportCheckedAt: row.transportCheckedAt || "",
      executionAttempts: execution.attemptCount || 0,
      executionStatus: execution.lastStatus || "Not started",
      executionStage: execution.lastStage || "",
      executionUpdatedAt: execution.lastUpdatedAt || "",
      executionTransport: execution.transportRequest || "",
      executionError: execution.lastError || "",
      rawDiffFiles: comparison.rawDiffFiles || 0,
      formattedDiffFiles: comparison.formattedDiffFiles || 0,
      formattedError: comparison.formattedError,
      objectName: row.sourceRecord.objectName,
      objectType: row.sourceRecord.objectType,
      decision,
      reason: row.eligible
        ? "Source differs from target"
        : decision === "No action"
          ? "Source and target are identical"
          : reasons.join("; ")
    }
  })
  const columns = [
    textColumn("Object", "objectName", 220),
    textColumn("Type", "objectType", 100),
    textColumn("Transport status", "transportCheckStatusLabel", 145),
    textColumn("Transport request", "transportRequest", 150),
    textColumn("Transport details", "transportDetails", 220),
    textColumn("Transport checked at", "transportCheckedAt", 170),
    numberColumn("Apply attempts", "executionAttempts", "Persisted Copilot apply attempts."),
    textColumn("Last execution status", "executionStatus", 150),
    textColumn("Last execution stage", "executionStage", 145),
    textColumn("Last execution at", "executionUpdatedAt", 170),
    textColumn("Actual apply transport", "executionTransport", 165),
    textColumn("Last execution error", "executionError", 260),
    textColumn("Decision", "decision", 120),
    textColumn("Reason", "reason", 300),
    {
      title: copilot ? "Review" : "Review and apply",
      headerSort: false,
      headerFilter: false,
      minWidth: 340,
      formatter: cell => {
        const row = cell.getRow().getData()
        const reviewDisabled = row.eligible ? "" : "disabled"
        const rawDiffDisabled = row.eligible && row.rawDiffFiles ? "" : "disabled"
        const formattedDiffDisabled =
          row.eligible && row.formattedDiffFiles && !row.formattedError ? "" : "disabled"
        const stageDisabled = row.eligible && state.assistedApplySafety?.safe ? "" : "disabled"
        const history = row.executionAttempts
          ? '<button class="secondary" data-action="history">History</button>'
          : ""
        const stage = copilot
          ? history
          : `<button data-action="stage" ${stageDisabled}>Stage in target editor</button>${history}`
        return `<div class="compact-table-actions"><button class="secondary" data-action="source" ${reviewDisabled}>Live source</button><button class="secondary" data-action="target" ${reviewDisabled}>Live target</button><button class="secondary" data-action="rawDiff" ${rawDiffDisabled}>Raw diff</button><button class="secondary" data-action="formattedDiff" ${formattedDiffDisabled}>Formatted diff</button>${stage}</div>`
      },
      cellClick: (event, cell) => {
        const action = event.target?.dataset?.action
        if (!action || event.target.disabled) return
        const key = cell.getRow().getData().key
        const commands = {
          source: "openAssistedSource",
          target: "openAssistedTarget",
          rawDiff: "openAssistedDiff",
          formattedDiff: "openAssistedDiff",
          stage: "stageAssistedSource",
          history: "showAssistedApplyHistory"
        }
        send(commands[action], {
          key,
          representation: action === "formattedDiff" ? "formatted" : "raw"
        })
      }
    }
  ]
  if (copilot) {
    columns.unshift(textColumn("Copilot decision reason", "copilotDecisionReason", 300))
    columns.unshift(textColumn("Copilot decision", "copilotDecision", 145))
    columns.unshift(textColumn("Status", "copilotStatus", 110))
  }
  columns.unshift({
    title: "Select",
    field: "selected",
    width: 72,
    hozAlign: "center",
    headerHozAlign: "center",
    headerSort: false,
    headerFilter: false,
    formatter: cell => {
      const row = cell.getRow().getData()
      return `<input class="assisted-apply-selection-checkbox" data-selectable="${row.eligible ? "true" : "false"}" type="checkbox" ${row.selected ? "checked" : ""} ${row.eligible && !assistedApplySelectionLocked() ? "" : "disabled"} aria-label="Select ${escapeHtml(row.objectName || row.key)} for assisted apply">`
    },
    cellClick: (event, cell) => {
      if (!event.target?.classList?.contains("assisted-apply-selection-checkbox")) return
      const row = cell.getRow().getData()
      if (!row.eligible || assistedApplySelectionLocked()) return
      const activeSelections = currentAssistedApplySelection()
      if (event.target.checked) activeSelections.add(row.key)
      else activeSelections.delete(row.key)
      void cell.getRow().update({
        selected: event.target.checked,
        copilotStatus: copilot
          ? copilotAssistedApplyStatus(row, event.target.checked)
          : undefined,
        copilotDecision: copilot
          ? copilotAssistedApplyDecision(row, event.target.checked)
          : undefined,
        copilotDecisionReason: copilot
          ? copilotAssistedApplyDecisionReason(row, event.target.checked)
          : undefined
      })
      updateAssistedApplySelectionControls()
    }
  })
  const table = createWorkflowTable("assistedApplyPlan", rows, columns, { index: "key" })
  if (table) table.on("tableBuilt", updateAssistedApplySelectionControls)
}

function createWorkflowTable(id, data, columns, options = {}) {
  const element = document.getElementById(`table-${id}`)
  if (!element) return undefined
  if (typeof Tabulator !== "function") {
    element.textContent = "Table library failed to load. Reopen the workflow and check the extension logs."
    element.classList.add("table-load-error")
    return undefined
  }
  const stateKey = `${state.workflow.workflowId}:${id}`
  const savedState = workflowTableStates[stateKey]
  const savedSorters = (savedState?.sorters || []).map(sorter => ({
    column: sorter.column || sorter.field,
    dir: sorter.dir
  }))
  const tableOptions = {
    data,
    columns,
    height: 360,
    layout: "fitColumns",
    renderVertical: "virtual",
    renderVerticalBuffer: 40,
    placeholder: "No rows",
    columnDefaults: {
      headerSort: true,
      headerFilter: "input",
      headerFilterFunc: workflowHeaderFilter,
      headerFilterPlaceholder: "Filter",
      resizable: true,
      tooltip: true
    },
    ...options
  }
  if (savedState) {
    tableOptions.initialSort = savedSorters
    tableOptions.initialHeaderFilter = savedState.headerFilters
  }
  const table = new Tabulator(element, tableOptions)
  table.workflowStateKey = stateKey
  table.on("dataSorted", () => saveWorkflowTableState(table))
  table.on("dataFiltered", (_filters, rows) => {
    saveWorkflowTableState(table)
    updateTableRowCount(id, rows.length, data.length)
  })
  table.on("tableBuilt", () => {
    element.querySelectorAll(".tabulator-header-filter input").forEach(input => {
      input.title = "Type a prefix. Add a trailing space for an exact match. * and ? are supported."
      input.setAttribute("aria-label", input.title)
    })
    if (savedState)
      requestAnimationFrame(() => {
        if (savedSorters.length) table.setSort(savedSorters)
      })
  })
  workflowTables.push(table)
  workflowTableById[id] = table
  wireWorkflowTableTools(id, table, stateKey, data.length)
  return table
}

function wireWorkflowTableTools(id, table, stateKey, total) {
  const view = document.querySelector(`[data-table-view="${id}"]`)
  const applyView = value => {
    workflowTableViews[stateKey] = value
    if (value === "all") table.clearFilter()
    else table.setFilter(row => workflowTableViewMatches(id, value, row))
  }
  if (view) {
    view.onchange = () => applyView(view.value)
  }
  const clear = document.querySelector(`[data-clear-table="${id}"]`)
  if (clear)
    clear.onclick = () => {
      workflowTableViews[stateKey] = "all"
      if (view) view.value = "all"
      table.clearFilter(true)
      updateTableRowCount(id, total, total)
    }
  table.on("tableBuilt", () => {
    if (view) applyView(workflowTableViews[stateKey] || view.value)
    else updateTableRowCount(id, table.getDataCount("active"), total)
  })
}

function workflowTableViewMatches(id, view, row) {
  if (["sourceDiscovery", "targetDiscovery"].includes(id))
    return view.startsWith("type:") && row.objectType === view.slice(5)
  if (id === "existenceComparison") {
    if (view === "comparable") return sourceComparable(row)
    if (view === "selected") return sourceComparable(row) && row.selected
    if (view === "unselected") return sourceComparable(row) && !row.selected
    if (view === "packages") return row.status === "both" && !sourceComparable(row)
    return row.status === view
  }
  if (id === "sourceComparison") {
    if (view === "attention") return row.status !== "identical"
    if (view === "different-raw") return isRawDifferent(row)
    if (view === "different-formatted") return row.formattedIdentical === false
    if (view === "incomplete")
      return !["different", "identical"].includes(row.status)
    return row.status === view
  }
  if (id === "assistedApplyPlan")
    return (
      (view === "selected-ready" && row.decision === "Ready" && row.selected) ||
      (view === "unselected-ready" && row.decision === "Ready" && !row.selected) ||
      (view === "pending" && row.copilotStatus === "Pending") ||
      (view === "done" && row.copilotStatus === "Done") ||
      (view === "ready" && row.decision === "Ready") ||
      (view === "blocked" && row.decision === "Blocked") ||
      (view === "no-action" && row.decision === "No action")
    )
  return true
}

function updateTableRowCount(id, visible, total) {
  const count = document.getElementById(`table-count-${id}`)
  if (count)
    count.textContent = `Showing ${visible.toLocaleString()} of ${total.toLocaleString()}`
}

function updateTableViewOptionCount(id, value, count) {
  const option = document.querySelector(
    `[data-table-view="${id}"] option[value="${value}"]`
  )
  if (option)
    option.textContent = `${option.dataset.label} (${count.toLocaleString()})`
}

function isRawDifferent(row) {
  return row.rawIdentical === false || (row.rawIdentical === undefined && row.status === "different")
}

function columnMinWidth(title, requested = 0) {
  return Math.max(requested, title.length * 8 + 44)
}

function textColumn(title, field, minWidth, headerTooltip) {
  return {
    title,
    field,
    minWidth: columnMinWidth(title, minWidth),
    headerTooltip
  }
}

function workflowHeaderFilter(headerValue, rowValue) {
  const rawFilter = String(headerValue ?? "")
  const exact = /\s$/.test(rawFilter)
  const filter = rawFilter.trim()
  if (!filter) return true
  const value = String(rowValue ?? "")
  if (!/[*?]/.test(filter))
    return exact
      ? value.toLocaleLowerCase() === filter.toLocaleLowerCase()
      : value.toLocaleLowerCase().startsWith(filter.toLocaleLowerCase())
  const pattern = filter
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${pattern}$`, "i").test(value)
}

function numberColumn(title, field, headerTooltip) {
  return {
    title,
    field,
    minWidth: columnMinWidth(title, 115),
    headerTooltip,
    sorter: "number",
    hozAlign: "right",
    headerHozAlign: "right"
  }
}

function updateSourceSelectionControls(workflowId, comparableCount) {
  const selected = sourceSelections[workflowId]?.size || 0
  const compare = document.getElementById("compareSourceCode")
  if (compare) compare.disabled = selected === 0
  const selectAll = document.getElementById("selectAllSources")
  if (selectAll) {
    selectAll.checked = selected === comparableCount
    selectAll.indeterminate = selected > 0 && selected < comparableCount
  }
  const count = document.getElementById("selectedSourceCount")
  if (count)
    count.textContent = `${selected.toLocaleString()} of ${comparableCount.toLocaleString()} selected`
  updateTableViewOptionCount("existenceComparison", "selected", selected)
  updateTableViewOptionCount(
    "existenceComparison",
    "unselected",
    comparableCount - selected
  )
  const resume = document.getElementById("resumeSourceComparison")
  if (resume) {
    const changed = sourceSelectionChanged(workflowId)
    resume.textContent = changed
      ? "Apply changed selection and resume"
      : state.workflow.steps.sourceDownload.status === "partial" ||
          state.workflow.steps.sourceComparison.status === "partial"
        ? "Retry incomplete objects"
        : "Resume source comparison"
    resume.disabled = changed && selected === 0
  }
}

function sourceSelectionChanged(workflowId) {
  const comparable = (state.previews.existenceComparison || []).filter(sourceComparable)
  const persisted = state.previews.sourceSelection?.keys
  const saved = new Set(
    Array.isArray(persisted) ? persisted : comparable.map(row => row.key)
  )
  const current = sourceSelections[workflowId] || new Set()
  if (saved.size !== current.size) return true
  return [...saved].some(key => !current.has(key))
}

function sourceSelectionLocked() {
  return busy || pendingTransition || state.workflow?.runState === "running"
}

function copilotAssistedApplySelectionLocked() {
  return busy || pendingTransition || state.workflow?.runState === "running"
}

function assistedApplySelectionLocked() {
  return copilotAssistedApplySelectionLocked()
}

function copilotAssistedApplySelectionChanged() {
  const saved = new Set(state.previews.copilotAssistedApplySelection?.keys || [])
  const current = copilotAssistedApplySelections[state.workflow.workflowId] || new Set()
  if (saved.size !== current.size) return true
  return [...saved].some(key => !current.has(key))
}

function updateCopilotAssistedApplySelectionControls() {
  const plan = state.previews.assistedApplyPlan
  if (!plan) return
  const workflowId = state.workflow.workflowId
  const selected = copilotAssistedApplySelections[workflowId]?.size || 0
  const eligible = plan.items.filter(item => item.eligible).length
  const completed = new Set(
    state.previews.copilotAssistedApplySelection?.completedKeys || []
  )
  const done = [...(copilotAssistedApplySelections[workflowId] || [])].filter(key =>
    completed.has(key)
  ).length
  const selectAll = document.getElementById("selectAllCopilotApply")
  if (selectAll) {
    selectAll.checked = eligible > 0 && selected === eligible
    selectAll.indeterminate = selected > 0 && selected < eligible
    selectAll.disabled = !eligible || copilotAssistedApplySelectionLocked()
  }
  const count = document.getElementById("selectedCopilotApplyCount")
  if (count)
    count.textContent = `${selected.toLocaleString()} of ${eligible.toLocaleString()} eligible selected`
  const changed = copilotAssistedApplySelectionChanged()
  const save = document.getElementById("saveCopilotAssistedApplySelection")
  if (save) save.disabled = !changed || copilotAssistedApplySelectionLocked()
  const saved = state.previews.copilotAssistedApplySelection
  const status = document.getElementById("copilotSelectionSaveStatus")
  if (status)
    status.innerHTML = changed
      ? `<strong>${selected.toLocaleString()}</strong> objects are selected. Save the selection to make it available to Copilot.`
      : saved
        ? `<strong>${saved.keys.length.toLocaleString()} objects have been selected for Copilot-assisted apply:</strong> ${done.toLocaleString()} done and ${(saved.keys.length - done).toLocaleString()} pending.`
        : "No Copilot-assisted apply selection has been saved."
  updateTableViewOptionCount("assistedApplyPlan", "selected-ready", selected)
  updateTableViewOptionCount("assistedApplyPlan", "unselected-ready", eligible - selected)
  updateTableViewOptionCount("assistedApplyPlan", "pending", selected - done)
  updateTableViewOptionCount("assistedApplyPlan", "done", done)
  const determine = document.getElementById("determineTransportRequests")
  if (determine) determine.disabled = !selected || assistedApplySelectionLocked()
}

function updateManualAssistedApplySelectionControls() {
  const plan = state.previews.assistedApplyPlan
  if (!plan) return
  const selected = currentAssistedApplySelection().size
  const eligible = plan.items.filter(item => item.eligible).length
  const selectAll = document.getElementById("selectAllManualApply")
  if (selectAll) {
    selectAll.checked = eligible > 0 && selected === eligible
    selectAll.indeterminate = selected > 0 && selected < eligible
    selectAll.disabled = !eligible || assistedApplySelectionLocked()
  }
  const count = document.getElementById("selectedManualApplyCount")
  if (count)
    count.textContent = `${selected.toLocaleString()} of ${eligible.toLocaleString()} eligible selected`
  updateTableViewOptionCount("assistedApplyPlan", "selected-ready", selected)
  updateTableViewOptionCount("assistedApplyPlan", "unselected-ready", eligible - selected)
  const determine = document.getElementById("determineTransportRequests")
  if (determine) determine.disabled = !selected || assistedApplySelectionLocked()
}

function updateAssistedApplySelectionControls() {
  if (state.workflow.assistedApplyMode === "copilot")
    updateCopilotAssistedApplySelectionControls()
  else updateManualAssistedApplySelectionControls()
}

function saveWorkflowTableState(table) {
  try {
    workflowTableStates[table.workflowStateKey] = {
      sorters: table.getSorters().map(sorter => ({
        column: sorter.field,
        dir: sorter.dir
      })),
      headerFilters: table.getHeaderFilters().map(filter => ({
        field: filter.field,
        value: filter.value
      }))
    }
  } catch {}
}

function destroyWorkflowTable(id) {
  const table = workflowTableById[id]
  if (!table) return
  saveWorkflowTableState(table)
  const index = workflowTables.indexOf(table)
  if (index >= 0) workflowTables.splice(index, 1)
  delete workflowTableById[id]
  table.destroy()
}

function destroyWorkflowTables() {
  for (const id of Object.keys(workflowTableById)) destroyWorkflowTable(id)
}

function singleExport(output, label) {
  const availability = state.exportAvailability?.[output]
  if (!availability?.rows) return ""
  const type = availability.xlsx ? "xlsx" : "csv"
  return `<button class="secondary" data-export="${output}" data-type="${type}">${escapeHtml(label)}${type === "csv" ? " (CSV)" : ""}</button>`
}

function objectTypeSelect(id, values) {
  const chosen = new Set(values || [])
  const options = (state.objectTypes || []).map(item => `<option value="${escapeHtml(item.value)}" ${chosen.has(item.value) ? "selected" : ""}>${escapeHtml(item.value)} — ${escapeHtml(item.label)}</option>`).join("")
  return `<label class="field"><span>Object types</span><select id="${id}" multiple size="8">${options}</select><small>Leave all unselected to include every supported type.</small></label>`
}

function criteriaValue() {
  const value = id => document.getElementById(id).value
  const checked = id => document.getElementById(id).checked
  return { includeNames: value("includeNames"), excludeNames: value("excludeNames"), packages: value("packages"), objectTypes: selected("objectTypes"), namespaces: value("namespaces"), authors: value("authors"), createdFrom: value("createdFrom"), createdTo: value("createdTo"), sourceConcurrency: state.criteria?.sourceConcurrency || 5, targetConcurrency: state.criteria?.targetConcurrency || 5, verificationConcurrency: state.criteria?.verificationConcurrency || 32, includeSubpackages: checked("includeSubpackages"), includeDeleted: checked("includeDeleted"), includeGenerated: checked("includeGenerated"), includeTemporary: checked("includeTemporary") }
}

function wireWorkflow(workflow) {
  document.getElementById("saveCriteria").onclick = () => send("saveCriteria", { criteria: criteriaValue() })
  const selectAllSources = document.getElementById("selectAllSources"); if (selectAllSources) selectAllSources.onchange = () => {
    if (sourceSelectionLocked()) return
    const table = workflowTableById.existenceComparison
    if (!table) return
    const comparable = (state.previews.existenceComparison || []).filter(sourceComparable)
    sourceSelections[workflow.workflowId] = selectAllSources.checked
      ? new Set(comparable.map(row => row.key))
      : new Set()
    void table.updateData(
      (state.previews.existenceComparison || []).map(row => ({
        key: row.key,
        selected: selectAllSources.checked && sourceComparable(row)
      }))
    )
    updateSourceSelectionControls(workflow.workflowId, comparable.length)
  }
  const updateFilteredSources = selected => {
    if (sourceSelectionLocked()) return
    const table = workflowTableById.existenceComparison
    if (!table) return
    const rows = table.getRows("active").filter(row => sourceComparable(row.getData()))
    for (const row of rows) {
      const data = row.getData()
      if (selected) sourceSelections[workflow.workflowId].add(data.key)
      else sourceSelections[workflow.workflowId].delete(data.key)
      void row.update({ selected })
    }
    const comparableCount = (state.previews.existenceComparison || []).filter(sourceComparable).length
    updateSourceSelectionControls(workflow.workflowId, comparableCount)
  }
  const selectFilteredSources = document.getElementById("selectFilteredSources"); if (selectFilteredSources) selectFilteredSources.onclick = () => updateFilteredSources(true)
  const clearFilteredSources = document.getElementById("clearFilteredSources"); if (clearFilteredSources) clearFilteredSources.onclick = () => updateFilteredSources(false)
  const importSourceSelection = document.getElementById("importSourceSelection"); if (importSourceSelection) importSourceSelection.onclick = () => send("importSourceSelection")
  const chooseManualAssistedApply = document.getElementById("chooseManualAssistedApply"); if (chooseManualAssistedApply) chooseManualAssistedApply.onclick = () => send("chooseAssistedApplyMode", { mode: "manual" })
  const chooseCopilotAssistedApply = document.getElementById("chooseCopilotAssistedApply"); if (chooseCopilotAssistedApply) chooseCopilotAssistedApply.onclick = () => send("chooseAssistedApplyMode", { mode: "copilot" })
  const selectAllCopilotApply = document.getElementById("selectAllCopilotApply"); if (selectAllCopilotApply) selectAllCopilotApply.onchange = () => {
    if (copilotAssistedApplySelectionLocked()) return
    const table = workflowTableById.assistedApplyPlan
    const eligible = (state.previews.assistedApplyPlan?.items || []).filter(item => item.eligible)
    copilotAssistedApplySelections[workflow.workflowId] = selectAllCopilotApply.checked
      ? new Set(eligible.map(item => item.key))
      : new Set()
    if (table)
      void table.updateData(
        (state.previews.assistedApplyPlan?.items || []).map(item => ({
          key: item.key,
          selected: selectAllCopilotApply.checked && item.eligible,
          copilotStatus: copilotAssistedApplyStatus(
            item,
            selectAllCopilotApply.checked && item.eligible
          ),
          copilotDecision: copilotAssistedApplyDecision(
            item,
            selectAllCopilotApply.checked && item.eligible
          ),
          copilotDecisionReason: copilotAssistedApplyDecisionReason(
            item,
            selectAllCopilotApply.checked && item.eligible
          )
        }))
      )
    updateCopilotAssistedApplySelectionControls()
  }
  const updateFilteredCopilotApply = selected => {
    if (copilotAssistedApplySelectionLocked()) return
    const table = workflowTableById.assistedApplyPlan
    if (!table) return
    const rows = table.getRows("active").filter(row => row.getData().eligible)
    for (const row of rows) {
      const data = row.getData()
      if (selected) copilotAssistedApplySelections[workflow.workflowId].add(data.key)
      else copilotAssistedApplySelections[workflow.workflowId].delete(data.key)
      void row.update({
        selected,
        copilotStatus: copilotAssistedApplyStatus(data, selected),
        copilotDecision: copilotAssistedApplyDecision(data, selected),
        copilotDecisionReason: copilotAssistedApplyDecisionReason(data, selected)
      })
    }
    updateCopilotAssistedApplySelectionControls()
  }
  const selectFilteredCopilotApply = document.getElementById("selectFilteredCopilotApply"); if (selectFilteredCopilotApply) selectFilteredCopilotApply.onclick = () => updateFilteredCopilotApply(true)
  const clearFilteredCopilotApply = document.getElementById("clearFilteredCopilotApply"); if (clearFilteredCopilotApply) clearFilteredCopilotApply.onclick = () => updateFilteredCopilotApply(false)
  const importCopilotSelection = document.getElementById("importCopilotAssistedApplySelection"); if (importCopilotSelection) importCopilotSelection.onclick = () => send("importCopilotAssistedApplySelection")
  const saveCopilotSelection = document.getElementById("saveCopilotAssistedApplySelection"); if (saveCopilotSelection) saveCopilotSelection.onclick = () => send("saveCopilotAssistedApplySelection", { keys: [...(copilotAssistedApplySelections[workflow.workflowId] || [])] })
  const selectAllManualApply = document.getElementById("selectAllManualApply"); if (selectAllManualApply) selectAllManualApply.onchange = () => {
    if (assistedApplySelectionLocked()) return
    const table = workflowTableById.assistedApplyPlan
    const eligible = (state.previews.assistedApplyPlan?.items || []).filter(item => item.eligible)
    manualAssistedApplySelections[workflow.workflowId] = selectAllManualApply.checked
      ? new Set(eligible.map(item => item.key))
      : new Set()
    if (table)
      void table.updateData(
        (state.previews.assistedApplyPlan?.items || []).map(item => ({
          key: item.key,
          selected: selectAllManualApply.checked && item.eligible
        }))
      )
    updateManualAssistedApplySelectionControls()
  }
  const updateFilteredManualApply = selected => {
    if (assistedApplySelectionLocked()) return
    const table = workflowTableById.assistedApplyPlan
    if (!table) return
    const rows = table.getRows("active").filter(row => row.getData().eligible)
    for (const row of rows) {
      const data = row.getData()
      if (selected) manualAssistedApplySelections[workflow.workflowId].add(data.key)
      else manualAssistedApplySelections[workflow.workflowId].delete(data.key)
      void row.update({ selected })
    }
    updateManualAssistedApplySelectionControls()
  }
  const selectFilteredManualApply = document.getElementById("selectFilteredManualApply"); if (selectFilteredManualApply) selectFilteredManualApply.onclick = () => updateFilteredManualApply(true)
  const clearFilteredManualApply = document.getElementById("clearFilteredManualApply"); if (clearFilteredManualApply) clearFilteredManualApply.onclick = () => updateFilteredManualApply(false)
  const closeAssistedApplyExecutionHistory = document.getElementById("closeAssistedApplyExecutionHistory"); if (closeAssistedApplyExecutionHistory) closeAssistedApplyExecutionHistory.onclick = () => {
    assistedApplyExecutionHistory = undefined
    render()
  }
  wireWorkflowActions(workflow)
  const openAutoSaveSettings = document.getElementById("openAutoSaveSettings"); if (openAutoSaveSettings) openAutoSaveSettings.onclick = () => send("openAutoSaveSettings")
  const openChatSaveSettings = document.getElementById("openChatSaveSettings"); if (openChatSaveSettings) openChatSaveSettings.onclick = () => send("openChatSaveSettings")
  document.getElementById("askCopilot").onclick = () => send("askCopilot", { prompt: document.getElementById("copilotPrompt").value })
  document.querySelectorAll("[data-export]").forEach(button => (button.onclick = () => {
    const output = button.dataset.export
    const selectedKeys =
      output === "existenceComparison"
        ? [...(sourceSelections[workflow.workflowId] || [])]
        : output === "assistedApplyPlan" && workflow.assistedApplyMode === "copilot"
          ? [...(copilotAssistedApplySelections[workflow.workflowId] || [])]
          : undefined
    const completedKeys =
      output === "assistedApplyPlan" && workflow.assistedApplyMode === "copilot"
        ? state.previews.copilotAssistedApplySelection?.completedKeys || []
        : undefined
    const decisions =
      output === "assistedApplyPlan" && workflow.assistedApplyMode === "copilot"
        ? state.previews.copilotAssistedApplySelection?.decisions || {}
        : undefined
    const decisionReasons =
      output === "assistedApplyPlan" && workflow.assistedApplyMode === "copilot"
        ? state.previews.copilotAssistedApplySelection?.decisionReasons || {}
        : undefined
    send("export", {
      output,
      type: button.dataset.type,
      selectedKeys,
      completedKeys,
      decisions,
      decisionReasons
    })
  }))
}

function wireWorkflowActions(workflow) {
  const discover = document.getElementById("discover"); if (discover) discover.onclick = () => send("runDiscovery", { criteria: criteriaValue() })
  const resumeDiscovery = document.getElementById("resumeDiscovery"); if (resumeDiscovery) resumeDiscovery.onclick = () => send("resumeDiscovery")
  const existence = document.getElementById("existence"); if (existence) existence.onclick = () => send("compareExistence")
  const startSourceComparison = command => {
    pendingTransition = true
    clearSourceResultViews()
    const progress = document.querySelector(
      '[data-step-progress="existenceComparison"]'
    )
    if (progress)
      progress.innerHTML =
        '<div class="progress-label">Preparing source comparison…</div>'
    applyBusy()
    send(command, { keys: [...(sourceSelections[workflow.workflowId] || [])], sourceConcurrency: Number(document.getElementById("sourceConcurrency").value), targetConcurrency: Number(document.getElementById("targetConcurrency").value), verificationConcurrency: Number(document.getElementById("verificationConcurrency").value) })
  }
  const compareSourceCode = document.getElementById("compareSourceCode"); if (compareSourceCode) compareSourceCode.onclick = () => startSourceComparison("compareSourceCode")
  const resumeSourceComparison = document.getElementById("resumeSourceComparison"); if (resumeSourceComparison) resumeSourceComparison.onclick = () => startSourceComparison(sourceSelectionChanged(workflow.workflowId) ? "compareSourceCode" : "resumeSourceComparison")
  const prepareAssistedApply = document.getElementById("prepareAssistedApply"); if (prepareAssistedApply) prepareAssistedApply.onclick = () => send("prepareAssistedApply", { comparisonBasis: document.getElementById("assistedApplyComparisonBasis")?.value || "formatted" })
  const determineTransportRequests = document.getElementById("determineTransportRequests"); if (determineTransportRequests) determineTransportRequests.onclick = () => {
    pendingTransition = true
    applyBusy()
    send("determineTransportRequests", {
      keys: [...currentAssistedApplySelection()],
      transportConcurrency: Number(document.getElementById("transportConcurrency")?.value) || 5
    })
  }
  const changeAssistedApplyMode = document.getElementById("changeAssistedApplyMode"); if (changeAssistedApplyMode) changeAssistedApplyMode.onclick = () => send("resetAssistedApplyMode")
  document.querySelectorAll(".pause").forEach(button => (button.onclick = () => {
    pendingTransition = true
    applyBusy()
    send("pause")
  }))
}

function check(id, label, checked) { return `<label><input id="${id}" type="checkbox" ${checked ? "checked" : ""}> ${label}</label>` }
function bind(attribute, action) { document.querySelectorAll(`[data-${attribute}]`).forEach(button => (button.onclick = () => action(button.dataset[attribute], button))) }
function selected(id) { return Array.from(document.getElementById(id)?.selectedOptions || []).map(option => option.value) }
function applyBusy() {
  const workflowRunning = state.workflow?.runState === "running"
  document.querySelectorAll("button").forEach(button => {
    const shouldDisable = button.classList.contains("pause")
      ? pendingTransition
      : busy || pendingTransition || workflowRunning
    if (shouldDisable) {
      if (!busyDisabledStates.has(button)) busyDisabledStates.set(button, button.disabled)
      button.disabled = true
    } else if (busyDisabledStates.has(button)) {
      button.disabled = busyDisabledStates.get(button)
      busyDisabledStates.delete(button)
    }
  })
  const selectionLocked = sourceSelectionLocked()
  document.querySelectorAll(".table-selection-checkbox").forEach(input => {
    input.disabled = selectionLocked || input.dataset.selectable !== "true"
  })
  document.querySelectorAll(".assisted-apply-selection-checkbox").forEach(input => {
    input.disabled = assistedApplySelectionLocked() || input.dataset.selectable !== "true"
  })
  const selectAll = document.getElementById("selectAllSources")
  if (selectAll)
    selectAll.disabled = selectionLocked || selectAll.dataset.hasComparable !== "true"
}
function workflowName(source, target) { const now = new Date(); const pad = value => String(value).padStart(2, "0"); return `${source}_${target}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`.toUpperCase() }
function clearErrors() { globalError.textContent = ""; document.querySelectorAll(".section-error").forEach(element => (element.textContent = "")) }
function showSectionError(section, message) { clearErrors(); const target = document.getElementById(`error-${section || "home"}`); if (target) { target.textContent = message || ""; if (message) target.scrollIntoView({ behavior: "smooth", block: "center" }) } else globalError.textContent = message || "" }

setInterval(updateElapsedCounters, 1000)
send("ready")
