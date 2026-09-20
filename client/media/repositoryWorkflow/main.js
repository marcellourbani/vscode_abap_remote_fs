const vscode = acquireVsCodeApi()
const app = document.getElementById("app")
const globalError = document.getElementById("error")
const home = document.getElementById("home")
let state = {}
let busy = false
let pendingTransition = false
const sourceSelections = {}
const sourceSelectionRevisions = {}
const workflowTables = []
const workflowTableById = {}

const send = (command, data = {}) => vscode.postMessage({ command, ...data })
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character])
const list = value => (value || []).join(", ")
const complete = stepId => state.workflow?.steps?.[stepId]?.status === "complete"

window.addEventListener("message", event => {
  if (event.data.command === "state") {
    if (
      state.workflow?.workflowId === event.data.workflow?.workflowId &&
      Number(event.data.workflow?.revision || 0) < Number(state.workflow?.revision || 0)
    )
      return
    pendingTransition = false
    state = event.data
    clearErrors()
    render()
  }
  if (event.data.command === "progress") {
    if (state.workflow?.workflowId !== event.data.workflow?.workflowId) return
    const renderedRevision = state.workflow.revision
    state.workflow = { ...event.data.workflow, revision: renderedRevision }
    updateProgressDisplay()
    updateElapsedCounters()
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
})

home.onclick = () => { state.workflow = undefined; render() }

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
  document.getElementById("subtitle").textContent = `${workflow.name} · Source: ${sourceLabel} · Target: ${targetLabel}`
  app.innerHTML = `<div class="steps">
    ${step("1. Scope and discovery", "discovery", criteriaForm(criteria, sourceLabel, targetLabel) + discoveryResults(sourceLabel, targetLabel), discoveryActions(), true)}
    ${step("2. Compare systems", "existenceComparison", comparisonStage(sourceLabel, targetLabel), comparisonActions(), complete("discovery"))}
    ${step("3. Assisted apply", "assistedApply", assistedApplyView(), assistedApplyActions(), complete("sourceComparison"))}
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
  </div>`
}

function step(title, id, body, actions, enabled) {
  const stepId = displayedStepId(id)
  const value = state.workflow.steps[stepId] || {}
  const progress = stepProgress(id, stepId, value)
  const content = enabled ? `${body}<div data-step-progress="${id}">${progress}</div><div class="actions">${actions}</div>` : '<p class="muted">Complete the previous stage to continue.</p>'
  return `<section class="step ${enabled ? "" : "locked"}" data-section="${id}"><div class="step-head"><h2>${title}</h2><div class="step-status"><span class="status" data-step-status="${id}">${escapeHtml(value.status)}</span>${stepTimings(id)}</div></div><div id="error-${id}" class="section-error">${escapeHtml(value.lastError || "")}</div>${content}</section>`
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

function displayedStepId(id) {
  if (id === "assistedApply") return "assistedApplyPlan"
  if (
    id === "existenceComparison" &&
    ["sourceDownload", "sourceComparison"].includes(state.workflow.currentStep)
  )
    return state.workflow.currentStep
  return id
}

function stepTimings(id) {
  const timingSteps = {
    discovery: [["discovery", "Discovery"], ["existenceComparison", "Inventory comparison"]],
    existenceComparison: [["sourceDownload", "Download"], ["sourceComparison", "Source comparison"]],
    assistedApply: [["assistedApplyPlan", "Plan"]]
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
  if (id === "sourceDownload")
    return `Downloading source and target snapshots: ${value.completed || 0} of ${value.total}`
  if (id === "sourceComparison")
    return `Comparing downloaded source snapshots: ${value.completed || 0} of ${value.total}`
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
  return `<section class="result-block"><div class="result-head"><h3>${escapeHtml(title)}</h3><span>${count.toLocaleString()} objects</span></div>${inventoryTable(rows, output)}<div class="actions">${singleExport(output, `Export ${title}`)}</div></section>`
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
  return `${explanation}${concurrency}${existence.length ? existenceTable(existence) : ""}${source.length ? `<h3>Source-code differences</h3>${sourceTable(source)}` : ""}`
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
    sourceSelections[workflowId] = new Set(comparableKeys)
  } else
    sourceSelections[workflowId] = new Set(
      [...sourceSelections[workflowId]].filter(key => comparableKeys.has(key))
    )
  const selected = sourceSelections[workflowId]
  const allSelected = comparable.length > 0 && comparable.every(row => selected.has(row.key))
  return `<p class="muted">${rows.length.toLocaleString()} unique repository keys: ${presentOnBoth.length.toLocaleString()} present on both, ${sourceOnly.toLocaleString()} source-only, and ${targetOnly.toLocaleString()} target-only. ${excludedContainers ? `${excludedContainers.toLocaleString()} container objects excluded from source comparison.` : ""}</p><div class="selection-tools"><label><input id="selectAllSources" type="checkbox" ${allSelected ? "checked" : ""} ${comparable.length ? "" : "disabled"}> Select all comparable objects</label><button id="selectFilteredSources" class="secondary" type="button">Select filtered</button><button id="clearFilteredSources" class="secondary" type="button">Clear filtered</button><span id="selectedSourceCount">${selected.size.toLocaleString()} of ${comparable.length.toLocaleString()} selected</span></div><div id="table-existenceComparison" class="workflow-table"></div>`
}

function comparisonActions() {
  const existenceReady = complete("existenceComparison")
  const selected = sourceSelections[state.workflow.workflowId]?.size || 0
  const sourceStep = state.workflow.currentStep
  const resumable = ["paused", "interrupted", "failed"].includes(state.workflow.runState) &&
    ["sourceDownload", "sourceComparison"].includes(sourceStep)
  const primaryAction = !existenceReady
    ? '<button id="existence">Compare inventories</button>'
    : resumable
      ? '<button id="resumeSourceComparison">Resume source comparison</button>'
      : `<button id="compareSourceCode" ${selected ? "" : "disabled"}>Compare selected source code</button>`
  return `${primaryAction}${singleExport("existenceComparison", "Export inventory comparison")}${singleExport("sourceComparison", "Export source comparison")}${pauseButton("sourceDownload")}`
}

function sourceTable(rows) {
  if (!rows || !rows.length) return '<div class="muted">No persisted output yet.</div>'
  return '<p class="muted">Line counts describe the textual diff. Reordered code may appear as removed and added lines.</p><div id="table-sourceComparison" class="workflow-table"></div>'
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
  const unchanged = plan.items.filter(item => (item.blockingReasons || []).includes("Source status is identical")).length
  const blocked = plan.items.length - eligible - unchanged
  const summary = `<p><strong>${eligible}</strong> ready for assisted apply, <strong>${unchanged}</strong> already identical, <strong>${blocked}</strong> blocked.</p>`
  return direction + policy + summary + assistedApplyPlanTable(plan.items)
}

function assistedApplyPlanTable(rows) {
  return rows?.length
    ? '<div id="table-assistedApplyPlan" class="workflow-table"></div>'
    : '<p class="muted">No assisted-apply items.</p>'
}

function discoveryActions() {
  const resumable = ["paused", "interrupted", "failed"].includes(
    state.workflow.steps.discovery.status
  )
  return `<button id="saveCriteria">Save criteria</button><button id="${resumable ? "resumeDiscovery" : "discover"}">${resumable ? "Resume discovery" : complete("discovery") ? "Run discovery again" : "Run discovery"}</button>${pauseButton("discovery")}`
}

function assistedApplyActions() {
  return `<button id="prepareAssistedApply">${complete("assistedApplyPlan") ? "Refresh assisted-apply plan" : "Prepare assisted apply"}</button>${pauseButton("assistedApplyPlan")}`
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
          return `<input class="table-selection-checkbox" type="checkbox" ${row.selected ? "checked" : ""} ${sourceComparable(row) ? "" : "disabled"} aria-label="Compare ${escapeHtml(row.objectName || row.key)}">`
        },
        cellClick: (event, cell) => {
          if (!event.target?.classList?.contains("table-selection-checkbox")) return
          const row = cell.getRow().getData()
          if (!sourceComparable(row)) return
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
    textColumn("Object", "objectName", 220),
    textColumn("Type", "objectType", 100),
    textColumn("Status", "status", 130),
    numberColumn("Files changed", "filesChanged"),
    numberColumn("Lines added", "linesAdded"),
    numberColumn("Lines removed", "linesRemoved"),
    numberColumn("Lines changed", "linesChanged"),
    {
      title: "Review",
      headerSort: false,
      headerFilter: false,
      width: 105,
      formatter: cell =>
        `<button class="secondary compact-table-button" ${cell.getRow().getData().status === "different" ? "" : "disabled"}>Open diff</button>`,
      cellClick: (_event, cell) => {
        const row = cell.getRow().getData()
        if (row.status === "different") send("openDiff", { key: row.key })
      }
    }
  ])
}

function wireAssistedApplyTable() {
  const rows = (state.previews.assistedApplyPlan?.items || []).map(row => {
    const reasons = row.blockingReasons || []
    const unchanged = reasons.includes("Source status is identical")
    return {
      ...row,
      objectName: row.sourceRecord.objectName,
      objectType: row.sourceRecord.objectType,
      decision: row.eligible ? "Ready" : unchanged ? "No action" : "Blocked",
      reason: row.eligible
        ? "Source differs from target"
        : unchanged
          ? "Source and target are identical"
          : reasons.join("; ")
    }
  })
  createWorkflowTable("assistedApplyPlan", rows, [
    textColumn("Object", "objectName", 220),
    textColumn("Type", "objectType", 100),
    textColumn("Decision", "decision", 120),
    textColumn("Reason", "reason", 300),
    {
      title: "Review and apply",
      headerSort: false,
      headerFilter: false,
      minWidth: 340,
      formatter: cell => {
        const row = cell.getRow().getData()
        const reviewDisabled = row.eligible ? "" : "disabled"
        const stageDisabled = row.eligible && state.assistedApplySafety?.safe ? "" : "disabled"
        return `<div class="compact-table-actions"><button class="secondary" data-action="source" ${reviewDisabled}>Live source</button><button class="secondary" data-action="target" ${reviewDisabled}>Live target</button><button class="secondary" data-action="diff" ${reviewDisabled}>Diff</button><button data-action="stage" ${stageDisabled}>Stage in target editor</button></div>`
      },
      cellClick: (event, cell) => {
        const action = event.target?.dataset?.action
        if (!action || event.target.disabled) return
        const key = cell.getRow().getData().key
        const commands = {
          source: "openAssistedSource",
          target: "openAssistedTarget",
          diff: "openAssistedDiff",
          stage: "stageAssistedSource"
        }
        send(commands[action], { key })
      }
    }
  ])
}

function createWorkflowTable(id, data, columns, options = {}) {
  const element = document.getElementById(`table-${id}`)
  if (!element) return undefined
  if (typeof Tabulator !== "function") {
    element.textContent = "Table library failed to load. Reopen the workflow and check the extension logs."
    element.classList.add("table-load-error")
    return undefined
  }
  const table = new Tabulator(element, {
    data,
    columns,
    height: 360,
    layout: "fitDataStretch",
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
  })
  table.on("tableBuilt", () => {
    element.querySelectorAll(".tabulator-header-filter input").forEach(input => {
      input.title = "Type a prefix. Add a trailing space for an exact match. * and ? are supported."
      input.setAttribute("aria-label", input.title)
    })
  })
  workflowTables.push(table)
  workflowTableById[id] = table
  return table
}

function textColumn(title, field, minWidth) {
  return { title, field, minWidth }
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

function numberColumn(title, field) {
  return {
    title,
    field,
    minWidth: 115,
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
}

function destroyWorkflowTables() {
  while (workflowTables.length) workflowTables.pop().destroy()
  for (const id of Object.keys(workflowTableById)) delete workflowTableById[id]
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
  const discover = document.getElementById("discover"); if (discover) discover.onclick = () => send("runDiscovery", { criteria: criteriaValue() })
  const resumeDiscovery = document.getElementById("resumeDiscovery"); if (resumeDiscovery) resumeDiscovery.onclick = () => send("resumeDiscovery")
  const existence = document.getElementById("existence"); if (existence) existence.onclick = () => send("compareExistence")
  const selectAllSources = document.getElementById("selectAllSources"); if (selectAllSources) selectAllSources.onchange = () => {
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
  const compareSourceCode = document.getElementById("compareSourceCode"); if (compareSourceCode) compareSourceCode.onclick = () => send("compareSourceCode", { keys: [...(sourceSelections[workflow.workflowId] || [])], sourceConcurrency: Number(document.getElementById("sourceConcurrency").value), targetConcurrency: Number(document.getElementById("targetConcurrency").value), verificationConcurrency: Number(document.getElementById("verificationConcurrency").value) })
  const resumeSourceComparison = document.getElementById("resumeSourceComparison"); if (resumeSourceComparison) resumeSourceComparison.onclick = () => send("resumeSourceComparison", { sourceConcurrency: Number(document.getElementById("sourceConcurrency").value), targetConcurrency: Number(document.getElementById("targetConcurrency").value), verificationConcurrency: Number(document.getElementById("verificationConcurrency").value) })
  const prepareAssistedApply = document.getElementById("prepareAssistedApply"); if (prepareAssistedApply) prepareAssistedApply.onclick = () => send("prepareAssistedApply")
  const openAutoSaveSettings = document.getElementById("openAutoSaveSettings"); if (openAutoSaveSettings) openAutoSaveSettings.onclick = () => send("openAutoSaveSettings")
  const openChatSaveSettings = document.getElementById("openChatSaveSettings"); if (openChatSaveSettings) openChatSaveSettings.onclick = () => send("openChatSaveSettings")
  document.querySelectorAll(".pause").forEach(button => (button.onclick = () => {
    pendingTransition = true
    applyBusy()
    send("pause")
  }))
  document.getElementById("askCopilot").onclick = () => send("askCopilot", { prompt: document.getElementById("copilotPrompt").value })
  document.querySelectorAll("[data-export]").forEach(button => (button.onclick = () => send("export", { output: button.dataset.export, type: button.dataset.type })))
}

function check(id, label, checked) { return `<label><input id="${id}" type="checkbox" ${checked ? "checked" : ""}> ${label}</label>` }
function bind(attribute, action) { document.querySelectorAll(`[data-${attribute}]`).forEach(button => (button.onclick = () => action(button.dataset[attribute], button))) }
function selected(id) { return Array.from(document.getElementById(id)?.selectedOptions || []).map(option => option.value) }
function applyBusy() { document.querySelectorAll("button").forEach(button => { if (!button.dataset.originalDisabled) button.dataset.originalDisabled = button.disabled ? "true" : "false"; button.disabled = button.classList.contains("pause") ? pendingTransition : busy || pendingTransition || button.dataset.originalDisabled === "true" }) }
function workflowName(source, target) { const now = new Date(); const pad = value => String(value).padStart(2, "0"); return `${source}_${target}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`.toUpperCase() }
function clearErrors() { globalError.textContent = ""; document.querySelectorAll(".section-error").forEach(element => (element.textContent = "")) }
function showSectionError(section, message) { clearErrors(); const target = document.getElementById(`error-${section || "home"}`); if (target) { target.textContent = message || ""; if (message) target.scrollIntoView({ behavior: "smooth", block: "center" }) } else globalError.textContent = message || "" }

setInterval(updateElapsedCounters, 1000)
send("ready")
