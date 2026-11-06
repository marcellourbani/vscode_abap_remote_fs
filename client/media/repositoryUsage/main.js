const vscode = acquireVsCodeApi()
const model = globalThis.RepositoryUsageView
const byId = id => document.getElementById(id)
const send = (command, data = {}) => vscode.postMessage({ command, ...data })
let saved = vscode.getState() || { views: {} }
let analysis
let systems = []
let table
let issueTable
let issueRows = []
let issueTableReady = Promise.resolve()
let rows = new Map()
let filteredRowCount = 0
let pending = false
let actionError = ""
let pausingAnalysisId
let tableReady = Promise.resolve()
let messages = Promise.resolve()
let restoreInProgress = false
let panelVisible = true
let saveSequence = 0
const saves = new Map()
const persist = () => vscode.setState(saved)
const viewState = () => saved.views[analysis?.id] || {}
const tableHeight = () => Math.max(240, window.innerWidth > 900 ? window.innerHeight - 250 : Math.floor(window.innerHeight * 0.48))
const saveView = changes => {
  if (!analysis || restoreInProgress) return
  saved.views[analysis.id] = { ...viewState(), ...changes }
  persist()
}
const error = message => { byId("error").textContent = message || ""; byId("error").hidden = !message }

function showStage(stage) {
  saveView({ stage })
  document.querySelectorAll(".stage").forEach(element => { element.hidden = element.id !== `stage-${stage}` })
  document.querySelectorAll("[data-stage]").forEach(button => button.classList.toggle("selected", button.dataset.stage === stage))
  persist()
}

function showResults(view) {
  saveView({ resultsView: view })
  byId("inventoryResults").hidden = view !== "inventory"
  byId("issuesResults").hidden = view !== "issues"
  document.querySelectorAll("[data-results]").forEach(button => {
    const selected = button.dataset.results === view
    button.classList.toggle("selected", selected)
    button.setAttribute("aria-pressed", String(selected))
  })
  if (view === "issues") {
    if (!issueTable) {
      const state = viewState()
      issueTableReady = new Promise(resolve => {
        issueTable = new Tabulator(byId("issueTable"), {
          data: issueRows, index: "id", height: tableHeight(), layout: "fitColumns", renderVertical: "virtual",
          placeholder: "No unresolved issues", initialSort: state.issueSorters || [], initialHeaderFilter: state.issueFilters || [],
          columnDefaults: { headerFilter: "input", headerFilterFunc: model.headerFilter, headerFilterPlaceholder: "Filter", resizable: true, tooltip: true, formatter: "plaintext" },
          columns: [
            { title: "Stage", field: "stage", width: 120 },
            { title: "Source", field: "source", minWidth: 120 },
            { title: "Object", field: "objectName", minWidth: 170 },
            { title: "Type", field: "objectType", width: 90 },
            { title: "Package", field: "packageName", minWidth: 150 },
            { title: "File", field: "file", minWidth: 170 },
            { title: "Issue", field: "message", minWidth: 350, variableHeight: true }
          ]
        })
        issueTable.on("tableBuilt", resolve)
        issueTable.on("dataFiltered", (_filters, filtered) => {
          byId("visibleIssueCount").textContent = `Showing ${filtered.length.toLocaleString()} of ${issueRows.length.toLocaleString()} issues`
          saveView({ issueFilters: issueTable.getHeaderFilters() })
        })
        issueTable.on("dataSorted", () => saveView({ issueSorters: issueTable.getSorters().map(sorter => ({ column: sorter.field, dir: sorter.dir })) }))
      })
    } else issueTable.redraw(true)
    renderIssues()
  } else if (table) { table.redraw(true); void restoreScroll(viewState().scroll) }
}

function renderIssues() {
  issueRows = analysis?.issueRows || []
  byId("issueCount").textContent = issueRows.length.toLocaleString()
  if (!issueTable || byId("issuesResults").hidden) return
  const next = issueRows
  issueTableReady = issueTableReady.then(async () => {
    await issueTable.replaceData(next)
    issueTable.refreshFilter()
  }).catch(failure => error(String(failure)))
}

function options() {
  return {
    connectionId: byId("connectionId").value, packages: byId("packages").value,
    discoveryMode: byId("discoveryMode").value, jobMode: byId("jobMode").value,
    jobConnection: byId("jobConnection").value, periodLabel: byId("period").value,
    includeSubpackages: byId("includeSubpackages").checked,
    includeReleasedJobs: byId("includeReleasedJobs").checked,
    includeScheduledJobs: byId("includeScheduledJobs").checked,
    dependencyConnectionId: byId("dependencyConnectionId").value,
    concurrency: Number(byId("concurrency").value), jobsFrom: byId("jobsFrom").value,
    jobsTo: byId("jobsTo").value, refreshDependencies: byId("refreshDependencies").checked,
    retryFailedOrEmptyDependencies: byId("retryFailedOrEmptyDependencies").checked
  }
}

function busy() {
  const running = analysis?.run.status === "running"
  document.querySelectorAll("[data-run], [data-reset], [data-upload], [data-remove], #restartDiscovery, #deleteAnalysis, #analysisSelect, #newAnalysis").forEach(element => { element.disabled = !analysis || pending || running })
  byId("newAnalysis").disabled = pending || running
  byId("createAnalysis").disabled = pending || running
  document.querySelectorAll("[data-open-analysis]").forEach(button => { button.disabled = pending || running })
  document.querySelectorAll("[data-delete-analysis]").forEach(button => { button.disabled = pending || running })
  byId("pause").disabled = !running || pending || pausingAnalysisId === analysis?.id
  byId("export").disabled = !analysis
  byId("exportIssues").disabled = !analysis
  document.querySelectorAll(".stage input, .stage select").forEach(element => { element.disabled = pending || running })
  const discovered = analysis?.discoveryDone === true
  document.querySelectorAll('[data-run="st03n"], [data-run="jobs"]').forEach(button => { button.disabled = !discovered || pending || running })
  document.querySelector('[data-run="dependencies"]').disabled = !analysis?.canDependencies || pending || running
  byId("dependencyRequirement").hidden = analysis?.canDependencies === true
}

function saveOptions(patch) {
  if (!analysis) return Promise.resolve()
  const requestId = ++saveSequence
  const analysisId = analysis.id
  return new Promise((resolve, reject) => {
    saves.set(requestId, { resolve, reject, analysisId })
    send("save", { analysisId, requestId, options: patch })
  })
}

const flushOptions = () => analysis ? saveOptions(options()) : Promise.resolve()

async function start(command, extra = {}) {
  const analysisId = analysis?.id
  pending = true
  actionError = ""
  error("")
  byId("runStatus").textContent = command === "pause" ? "Pausing..." : "Starting..."
  byId("progress").removeAttribute("value")
  busy()
  if (command === "pause") {
    pausingAnalysisId = analysisId
    send("pause", { analysisId })
    return
  }
  try {
    if (await flushOptions() === false) { pending = false; updateChrome(); return }
    send(command, { analysisId, options: options(), jobMode: byId("jobMode").value, jobConnection: byId("jobConnection").value, ...extra })
  } catch (failure) { pending = false; actionError = String(failure); updateChrome(); busy() }
}

function fillSystems() {
  document.querySelectorAll("select.system").forEach(select => {
    const desired = analysis?.[select.id] || ""
    select.replaceChildren(new Option("Select system", ""), ...systems.map(system => new Option(system.toUpperCase(), system)))
    if (desired && !systems.includes(desired)) select.add(new Option(`${desired.toUpperCase()} (not connected)`, desired))
    select.value = desired || ""
  })
}

function renderEntry(analyses) {
  const selected = Boolean(analysis)
  document.querySelector(".workspace").hidden = !selected
  byId("analysisHome").hidden = selected
  byId("analysisPicker").hidden = !selected
  byId("newAnalysis").hidden = !selected
  byId("deleteAnalysis").hidden = !selected
  byId("savedAnalysisSection").hidden = !analyses.length
  byId("savedAnalyses").replaceChildren(...analyses.map(item => {
    const row = document.createElement("div")
    row.className = "saved-analysis-row"
    const button = document.createElement("button")
    button.className = "secondary"
    button.dataset.openAnalysis = item.id
    button.textContent = model.analysisLabel(item, analyses)
    button.onclick = () => selectAnalysis(item.id)
    const remove = document.createElement("button")
    remove.className = "secondary"; remove.dataset.deleteAnalysis = item.id
    remove.textContent = "Delete"; remove.setAttribute("aria-label", `Delete ${item.name}`)
    remove.onclick = () => deleteAnalysis(item.id)
    row.append(button, remove)
    return row
  }))
}

async function selectAnalysis(id) {
  actionError = ""
  pending = true; error(""); busy()
  try { if (await flushOptions() === false) { pending = false; updateChrome(); return }; send("select", { id }) }
  catch (failure) { pending = false; error(String(failure)); busy() }
}

async function deleteAnalysis(id) {
  actionError = ""
  pending = true; error(""); busy()
  try { if (await flushOptions() === false) { pending = false; updateChrome(); return }; send("delete", { id }) }
  catch (failure) { pending = false; error(String(failure)); busy() }
}

function restoreForm() {
  if (!analysis) return
  byId("analysisName").textContent = analysis.name
  byId("packages").value = analysis.packages.join(", ")
  byId("includeSubpackages").checked = analysis.includeSubpackages
  byId("includeReleasedJobs").checked = analysis.includeReleasedJobs === true
  byId("includeScheduledJobs").checked = analysis.includeScheduledJobs === true
  byId("concurrency").value = String(analysis.concurrency)
  byId("jobsFrom").value = analysis.jobsFrom
  byId("jobsTo").value = analysis.jobsTo
  byId("discoveryMode").value = analysis.discoveryMode
  byId("jobMode").value = analysis.jobMode
  byId("period").value = analysis.periodLabel
  byId("jobConnection").value = analysis.jobConnection
  const view = viewState()
  byId("refreshDependencies").checked = view.refreshDependencies === true
  byId("retryFailedOrEmptyDependencies").checked = view.retryFailedOrEmptyDependencies === true && !byId("refreshDependencies").checked
  byId("exportView").value = view.exportView || "all"
  byId("exportType").value = view.exportType || "xlsx"
  byId("issueExportView").value = view.issueExportView || "all"
  byId("issueExportType").value = view.issueExportType || "xlsx"
  renderIssues()
  showResults(view.resultsView || "inventory")
  jobModeChanged()
  discoveryModeChanged()
  showStage(viewState().stage || "discovery")
  document.querySelector("aside").scrollTop = view.sidebarScroll || 0
}

function updateChrome() {
  if (!analysis) { busy(); return }
  const run = analysis.run
  if (run.stage === "dependencies" && run.status === "running") {
    for (const id of ["refreshDependencies", "retryFailedOrEmptyDependencies"]) if (byId(id).checked) {
      byId(id).checked = false
      saveView({ [id]: false })
    }
  }
  if (pausingAnalysisId === analysis.id) byId("runStatus").textContent = "Pausing..."
  else if (!pending) byId("runStatus").textContent = `${run.stage}: ${run.status}`
  byId("runActivity").hidden = run.status !== "running"
  byId("runActivity").textContent = run.status === "running" ? (run.activity || {
    discovery: "Discovering repository objects",
    st03n: "Matching workload extracts",
    jobs: "Checking background job programs",
    dependencies: "Checking object relations and where-used"
  }[run.stage] || "") : ""
  const progress = byId("progress")
  if (run.status === "running" && run.total === undefined) progress.removeAttribute("value")
  else { progress.max = Math.max(1, run.total || 1); progress.value = run.status === "complete" ? progress.max : Math.min(run.completed, progress.max) }
  byId("progressCount").textContent = run.total === undefined ? "" : `${run.completed.toLocaleString()} / ${run.total.toLocaleString()}${run.unit ? ` ${run.unit}` : ""}`
  byId("elapsed").textContent = model.formatElapsed(model.elapsed(run))
  const dependency = run.stage === "dependencies" ? run.dependencyProgress : undefined
  byId("dependencySummary").hidden = !dependency
  byId("dependencyCounts").textContent = dependency ? `${dependency.used.toLocaleString()} Used / ${dependency.unclear.toLocaleString()} Unclear` : ""
  byId("dependencyChecks").textContent = dependency ? `Cached checks reused: ${dependency.cached.toLocaleString()}; failed this pass: ${dependency.failed.toLocaleString()}` : ""
  byId("dependencyPasses").replaceChildren(...(dependency?.history || []).map(summary => {
    const item = document.createElement("li")
    item.textContent = `Pass ${summary.pass}: +${summary.newlyUsed.toLocaleString()} Used (${summary.used.toLocaleString()} Used / ${summary.unclear.toLocaleString()} Unclear)`
    return item
  }))
  byId("stageTimes").textContent = Object.entries(analysis.stages || {}).filter(([stage]) => run.status !== "running" || stage !== run.stage).map(([stage, timing]) => `${stage}: ${model.formatElapsed(timing.elapsedMs)} (${timing.status})`).join(" | ")
  byId("relationsStatus").textContent = analysis.relations === "available" ? "Object relations and where-used" : analysis.relations === "unavailable" ? "Where-used only: relations unavailable" : "Relations capability not checked"
  renderFiles()
  renderIssues()
  error(run.error || actionError)
  updateCounts()
  busy()
}

function renderFiles() {
  document.querySelectorAll("[data-files]").forEach(list => {
    list.replaceChildren(...analysis.inputs.filter(input => input.kind === list.dataset.files).map(input => {
      const item = document.createElement("li")
      const label = document.createElement("span")
      label.textContent = `${input.name} (${input.rowCount.toLocaleString()} rows${input.processed ? ", processed" : ", pending"}${input.period ? `; ${input.period}` : ""})`
      const remove = document.createElement("button")
      remove.className = "secondary"; remove.dataset.remove = input.id
      remove.title = "Remove extract"; remove.setAttribute("aria-label", `Remove ${input.name}`)
      const icon = document.createElement("span"); icon.className = "codicon codicon-close"; icon.setAttribute("aria-hidden", "true"); remove.append(icon, document.createTextNode("Remove"))
      remove.onclick = () => start("removeInput", { inputId: input.id })
      item.append(label, remove)
      return item
    }))
  })
}

function updateCounts() {
  const counts = model.counts([...rows.values()])
  byId("counts").textContent = `${counts.total.toLocaleString()} total / ${counts.used.toLocaleString()} used / ${counts.unclear.toLocaleString()} unclear`
  byId("visibleCount").textContent = `Showing ${filteredRowCount.toLocaleString()} of ${counts.total.toLocaleString()}`
}

function applyView() {
  if (!table) return
  const view = byId("view").value
  if (view === "all") table.clearFilter()
  else table.setFilter("status", "=", view)
  saveView({ view })
  updateCounts()
}

function rememberTable() {
  if (!table || !analysis) return
  saveView({ sorters: table.getSorters().map(sorter => ({ column: sorter.field, dir: sorter.dir })), filters: table.getHeaderFilters() })
}

function rememberScroll() {
  const holder = document.querySelector("#inventory .tabulator-tableholder")
  if (!panelVisible || document.hidden || !holder?.clientHeight) return
  saveView({ scroll: { top: holder.scrollTop, left: holder.scrollLeft } })
}

async function restoreScroll(scroll) {
  const currentTable = table
  const analysisId = analysis?.id
  restoreInProgress = true
  try {
    if (!scroll || !currentTable || !panelVisible) return
    await new Promise(resolve => requestAnimationFrame(resolve))
    if (table !== currentTable || analysis?.id !== analysisId || !panelVisible) return
    currentTable.redraw(true)
    await new Promise(resolve => requestAnimationFrame(resolve))
    const holder = document.querySelector("#inventory .tabulator-tableholder")
    if (table === currentTable && analysis?.id === analysisId && holder?.clientHeight) {
      holder.scrollTop = scroll.top
      holder.scrollLeft = scroll.left
    }
  } finally { restoreInProgress = false }
}

async function setRows(values, replace) {
  const holder = document.querySelector("#inventory .tabulator-tableholder")
  const scroll = holder ? { top: holder.scrollTop, left: holder.scrollLeft } : viewState().scroll
  if (replace) rows = new Map(values.map(row => [row.key, row]))
  else values.forEach(row => rows.set(row.key, row))
  if (!table) {
    const view = viewState()
    restoreInProgress = true
    tableReady = new Promise(resolve => {
      table = new Tabulator(byId("inventory"), {
        data: [...rows.values()], index: "key", height: tableHeight(), layout: "fitColumns", renderVertical: "virtual",
        placeholder: "No discovered objects", initialSort: view.sorters || [], initialHeaderFilter: view.filters || [],
        columnDefaults: { headerFilter: "input", headerFilterFunc: model.headerFilter, headerFilterPlaceholder: "Filter", resizable: true, tooltip: true },
        columns: [
          { title: "Object", field: "objectName", minWidth: 170, frozen: true },
          { title: "Type", field: "objectType", width: 85 }, { title: "Package", field: "packageName", minWidth: 130 },
          { title: "Function group", field: "functionGroup", minWidth: 145 },
          { title: "Status", field: "status", width: 100, formatter: cell => { const span = document.createElement("span"); span.className = `status-${cell.getValue()}`; span.textContent = cell.getValue() === "used" ? "Used" : "Unclear"; return span } },
          { title: "Reasons", field: "reasons", minWidth: 260, formatter: "plaintext", mutator: value => Array.isArray(value) ? value.join("\n") : value, tooltip: (_event, cell) => cell.getValue() },
          { title: "Latest observed", field: "lastObserved", minWidth: 135 },
          { title: "Observation periods", field: "periods", minWidth: 160, formatter: "plaintext", mutator: value => Array.isArray(value) ? value.join("; ") : value }
        ]
      })
      table.on("tableBuilt", async () => {
        byId("view").value = view.view || "all"; applyView()
        document.querySelectorAll("#inventory .tabulator-header-filter input").forEach(input => { input.title = "Prefix; trailing space for exact match; * and ? wildcards" })
        const tableHolder = document.querySelector("#inventory .tabulator-tableholder")
        tableHolder?.addEventListener("scroll", rememberScroll)
        await restoreScroll(view.scroll)
        resolve()
      })
      table.on("dataSorted", rememberTable)
      table.on("dataFiltered", (_filters, filteredRows) => { filteredRowCount = filteredRows.length; rememberTable(); updateCounts() })
    })
    await tableReady
  } else {
    await tableReady
    restoreInProgress = true
    if (replace) await table.replaceData([...rows.values()])
    else if (values.length) await table.updateOrAddData(values)
    table.refreshFilter()
    await restoreScroll(scroll)
  }
  updateCounts()
}

async function receive(message) {
  if (message.command === "visibility") {
    if (!message.visible) rememberScroll()
    panelVisible = message.visible
    if (panelVisible) await restoreScroll(viewState().scroll)
    return
  }
  if (message.command === "saved") {
    const request = saves.get(message.requestId)
    if (!request) return
    if (analysis?.id === message.analysisId && model.accepts(analysis, message.analysis)) {
      analysis = message.analysis
      if (message.cancelled) { fillSystems(); restoreForm() }
      updateChrome()
    }
    saves.delete(message.requestId); request.resolve(message.cancelled !== true); return
  }
  if (message.command === "idle") {
    if (message.analysisId && message.analysisId !== analysis?.id) return
    pending = false; updateChrome(); return
  }
  if (message.command === "error") {
    const request = saves.get(message.requestId)
    if (request) { saves.delete(message.requestId); request.reject(new Error(message.message)) }
    if (message.analysisId && message.analysisId !== analysis?.id) return
    pending = false; pausingAnalysisId = undefined
    actionError = analysis?.run.error ? "" : message.message
    updateChrome(); return
  }
  if (message.command === "connections") { systems = message.systems; fillSystems(); return }
  if (message.command === "state") {
    const switching = analysis?.id !== message.analysis?.id
    if (!switching && analysis && message.analysis && !model.accepts(analysis, message.analysis)) return
    if (switching) { actionError = ""; error("") }
    if (switching && table) { rememberScroll(); restoreInProgress = true; table.destroy(); table = undefined; rows.clear(); filteredRowCount = 0 }
    if (switching && issueTable) { await issueTableReady; issueTable.destroy(); issueTable = undefined; issueTableReady = Promise.resolve(); issueRows = [] }
    analysis = message.analysis; systems = message.systems; pending = false
    if (switching || analysis?.run.status !== "running") pausingAnalysisId = undefined
    renderEntry(message.analyses)
    byId("analysisSelect").replaceChildren(...message.analyses.map(item => new Option(model.analysisLabel(item, message.analyses), item.id)))
    byId("analysisSelect").value = analysis?.id || ""
    if (analysis) {
      saved.selected = analysis.id; persist(); fillSystems(); restoreForm()
      await setRows(message.rows, true)
    } else { restoreInProgress = false; byId("analysisName").textContent = "Inventory"; byId("counts").textContent = "0 total / 0 used / 0 unclear" }
    updateChrome(); return
  }
  if (message.command === "update") {
    if (!analysis || analysis.id !== message.analysis.id || !model.accepts(analysis, message.analysis)) return
    if ((analysis.run.status !== "running" && message.analysis.run.status === "running") || message.analysis.run.error) actionError = ""
    analysis = message.analysis
    if (analysis.run.status === "running") pending = pausingAnalysisId === analysis.id
    else { pending = false; pausingAnalysisId = undefined }
    if (message.rows) await setRows(message.rows, message.replaceRows === true)
    updateChrome()
  }
}

window.addEventListener("message", event => { messages = messages.then(() => receive(event.data)).catch(failure => { pending = false; error(String(failure)); busy() }) })
document.querySelectorAll("[data-stage]").forEach(button => { button.onclick = () => showStage(button.dataset.stage) })
document.querySelectorAll("[data-results]").forEach(button => { button.onclick = () => showResults(button.dataset.results) })
document.querySelectorAll("[data-run]").forEach(button => { button.onclick = () => start(button.dataset.run) })
document.querySelectorAll("[data-guide]").forEach(button => { button.onclick = () => send("guide", { stage: button.dataset.guide }) })
document.querySelectorAll("[data-template]").forEach(button => { button.onclick = () => send("template", { kind: button.dataset.template }) })
document.querySelectorAll("[data-upload]").forEach(button => { button.onclick = () => start("upload", { kind: button.dataset.upload, period: byId("period").value }) })
byId("pause").onclick = () => start("pause")
document.querySelectorAll("[data-reset]").forEach(button => { button.onclick = () => start("reset", { stage: button.dataset.reset }) })
async function createAnalysis() {
  const name = `Usage Analysis ${new Date().toISOString().slice(0, 10)}`
  actionError = ""
  pending = true; error(""); busy()
  try { if (await flushOptions() === false) { pending = false; updateChrome(); return }; send("create", { name }) }
  catch (failure) { pending = false; error(String(failure)); busy() }
}
byId("newAnalysis").onclick = createAnalysis
byId("createAnalysis").onclick = createAnalysis
byId("deleteAnalysis").onclick = () => deleteAnalysis(analysis.id)
byId("analysisSelect").onchange = () => selectAnalysis(byId("analysisSelect").value)
byId("view").onchange = applyView
byId("clearFilters").onclick = () => { byId("view").value = "all"; table?.clearFilter(true); saveView({ view: "all", filters: [] }); updateCounts() }
byId("export").onclick = () => send("export", { view: byId("exportView").value, type: byId("exportType").value, keys: table?.getData("active").map(row => row.key) || [] })
byId("clearIssueFilters").onclick = () => { issueTable?.clearFilter(true); saveView({ issueFilters: [] }) }
byId("exportIssues").onclick = async () => { await issueTableReady; send("exportIssues", { analysisId: analysis.id, view: byId("issueExportView").value, type: byId("issueExportType").value, keys: issueTable?.getData("active").map(row => row.id) || [] }) }
function jobModeChanged() {
  const connected = byId("jobMode").value === "connected"
  byId("jobConnected").hidden = !connected; byId("jobUploads").hidden = connected
}
function discoveryModeChanged() {
  const connected = byId("discoveryMode").value === "connected"
  byId("discoveryConnected").hidden = !connected; byId("discoveryUploads").hidden = connected
}
const optionFields = ["connectionId", "packages", "includeSubpackages", "includeReleasedJobs", "includeScheduledJobs", "discoveryMode", "jobMode", "jobConnection", "dependencyConnectionId", "concurrency", "jobsFrom", "jobsTo", "period"]
for (const id of optionFields) byId(id).addEventListener("change", () => {
  jobModeChanged(); discoveryModeChanged()
  const key = id === "period" ? "periodLabel" : id
  const value = byId(id).type === "checkbox" ? byId(id).checked : id === "concurrency" ? Number(byId(id).value) : byId(id).value
  const analysisId = analysis?.id
  void saveOptions({ [key]: value }).catch(failure => { if (analysis?.id !== analysisId) return; actionError = String(failure); error(actionError); if (analysis) { fillSystems(); restoreForm() } })
})
byId("exportView").onchange = () => saveView({ exportView: byId("exportView").value })
byId("exportType").onchange = () => saveView({ exportType: byId("exportType").value })
byId("issueExportView").onchange = () => saveView({ issueExportView: byId("issueExportView").value })
byId("issueExportType").onchange = () => saveView({ issueExportType: byId("issueExportType").value })
for (const id of ["refreshDependencies", "retryFailedOrEmptyDependencies"]) byId(id).onchange = () => {
  const other = id === "refreshDependencies" ? "retryFailedOrEmptyDependencies" : "refreshDependencies"
  if (byId(id).checked) byId(other).checked = false
  saveView({ [id]: byId(id).checked, [other]: byId(other).checked })
}
document.querySelector("aside").addEventListener("scroll", event => saveView({ sidebarScroll: event.currentTarget.scrollTop }))
setInterval(() => { if (analysis) byId("elapsed").textContent = model.formatElapsed(model.elapsed(analysis.run)) }, 1000)
window.addEventListener("resize", () => { if (table) table.setHeight(tableHeight()); if (issueTable) issueTable.setHeight(tableHeight()) })
showStage("discovery")
busy()
send("ready", { id: saved.selected })