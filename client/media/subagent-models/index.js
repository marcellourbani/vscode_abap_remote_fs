const vscode = acquireVsCodeApi()

const statusElement = document.getElementById("status")
const agentsElement = document.getElementById("agents")
const refreshButton = document.getElementById("refresh")
const saveButton = document.getElementById("save")

let agents = []
let models = []
let enabledAgents = {}
let testingEnabled = false

function setBusy(busy) {
  refreshButton.disabled = busy
  saveButton.disabled = busy || models.length === 0
}

function showStatus(message, kind = "info") {
  statusElement.textContent = message
  statusElement.className = `status ${kind}`
}

function modelLabel(model) {
  const details = [model.vendor, model.family, model.version].filter(Boolean).join(" · ")
  return details ? `${model.name} — ${details}` : model.name
}

function updateModelDetails(select, detailsElement) {
  const selected = models.find(model => model.name === select.value)
  detailsElement.textContent = selected
    ? [selected.vendor, selected.family, selected.version].filter(Boolean).join(" · ")
    : ""
}

function createAgentCard(agent, configuredModel) {
  const card = document.createElement("article")
  card.className = "agent-card"

  const heading = document.createElement("div")
  heading.className = "agent-heading"

  const title = document.createElement("h2")
  title.textContent = agent.displayName
  const id = document.createElement("span")
  id.className = "agent-id"
  id.textContent = agent.id
  heading.append(title, id)

  const guidance = document.createElement("p")
  guidance.className = "guidance"
  guidance.textContent = agent.guidance

  const select = document.createElement("select")
  select.dataset.agentId = agent.id
  select.setAttribute("aria-label", `Model for ${agent.displayName}`)

  const placeholder = document.createElement("option")
  placeholder.value = ""
  placeholder.textContent = "Select a model"
  select.appendChild(placeholder)

  if (configuredModel && !models.some(model => model.name === configuredModel)) {
    const unavailable = document.createElement("option")
    unavailable.value = configuredModel
    unavailable.textContent = `Unavailable: ${configuredModel}`
    unavailable.disabled = true
    unavailable.selected = true
    select.appendChild(unavailable)
  }

  for (const model of models) {
    const option = document.createElement("option")
    option.value = model.name
    option.textContent = modelLabel(model)
    option.selected = model.name === configuredModel
    select.appendChild(option)
  }

  const details = document.createElement("p")
  details.className = "model-details"
  select.addEventListener("change", () => updateModelDetails(select, details))
  updateModelDetails(select, details)

  if (agent.section === "general") {
    const controls = document.createElement("div")
    controls.className = "agent-controls"
    const toggle = document.createElement("input")
    toggle.type = "checkbox"
    toggle.checked = enabledAgents[agent.id] === true
    toggle.dataset.agentEnabled = agent.id
    const label = document.createElement("label")
    label.textContent = "Available to Copilot"
    label.prepend(toggle)
    controls.appendChild(label)
    card.append(heading, controls, guidance, select, details)
  } else {
    card.append(heading, guidance, select, details)
  }
  return card
}

function renderModelSelectors(configuredModels) {
  agentsElement.replaceChildren()
  for (const section of ["general", "testing"]) {
    const sectionAgents = agents.filter(agent => agent.section === section)
    if (sectionAgents.length === 0) continue
    const wrapper = document.createElement("details")
    wrapper.className = "agent-section"
    const heading = document.createElement("summary")
    heading.textContent = section === "general" ? "General agents" : "Testing agents"
    wrapper.appendChild(heading)
    if (section === "testing") {
      const note = document.createElement("p")
      note.className = testingEnabled ? "section-note" : "section-note warning"
      note.textContent = testingEnabled
        ? "Available because the SAP testing folder is configured."
        : "Unavailable until the SAP testing folder is configured. Models can still be selected."
      wrapper.appendChild(note)
    }
    for (const agent of sectionAgents) {
      wrapper.appendChild(createAgentCard(agent, configuredModels[agent.id] || ""))
    }
    agentsElement.appendChild(wrapper)
  }
}

function selections() {
  const models = {}
  for (const select of agentsElement.querySelectorAll("select[data-agent-id]")) {
    models[select.dataset.agentId] = select.value
  }
  const enabled = {}
  for (const toggle of agentsElement.querySelectorAll("input[data-agent-enabled]")) {
    enabled[toggle.dataset.agentEnabled] = toggle.checked
  }
  return { models, enabledAgents: enabled }
}

window.addEventListener("message", event => {
  const message = event.data
  switch (message.type) {
    case "loading":
      setBusy(true)
      showStatus("Loading available models…")
      break
    case "models":
      agents = message.agents || []
      models = message.models || []
      enabledAgents = message.enabledAgents || {}
      testingEnabled = message.testingEnabled === true
      if (models.length === 0) {
        agentsElement.replaceChildren()
        showStatus(
          message.error ||
            "No language models are currently available. Make sure GitHub Copilot is installed, signed in, and ready, then select Refresh Models.",
          "error"
        )
        setBusy(false)
        saveButton.disabled = true
        return
      }
      renderModelSelectors(message.configuredModels || {})
      showStatus(`Found ${models.length} available model${models.length === 1 ? "" : "s"}.`)
      setBusy(false)
      break
    case "saving":
      setBusy(true)
      showStatus("Validating and saving subagent models…")
      break
    case "saved":
      setBusy(false)
      showStatus("Models saved. The new assignments are active.", "success")
      break
    case "error":
      setBusy(false)
      showStatus(message.message || "The model configuration could not be saved.", "error")
      break
  }
})

refreshButton.addEventListener("click", () => {
  vscode.postMessage({ command: "refresh" })
})

saveButton.addEventListener("click", () => {
  vscode.postMessage({ command: "save", selections: selections() })
})

vscode.postMessage({ command: "ready" })
