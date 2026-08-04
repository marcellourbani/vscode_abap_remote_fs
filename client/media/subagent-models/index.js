const vscode = acquireVsCodeApi()

const statusElement = document.getElementById("status")
const agentsElement = document.getElementById("agents")
const refreshButton = document.getElementById("refresh")
const saveButton = document.getElementById("save")
const reloadButton = document.getElementById("reload")

let agents = []
let models = []

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

  card.append(heading, guidance, select, details)
  return card
}

function renderModelSelectors(configuredModels) {
  agentsElement.replaceChildren()
  for (const agent of agents) {
    agentsElement.appendChild(createAgentCard(agent, configuredModels[agent.id] || ""))
  }
}

function selections() {
  const result = {}
  for (const select of agentsElement.querySelectorAll("select[data-agent-id]")) {
    result[select.dataset.agentId] = select.value
  }
  return result
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
      reloadButton.classList.add("hidden")
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
      showStatus(
        message.reloadRequired
          ? "Models saved and agent files updated. Reload the window to use the new assignments."
          : "Models saved. The agent files already contain these assignments.",
        "success"
      )
      reloadButton.classList.toggle("hidden", !message.reloadRequired)
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

reloadButton.addEventListener("click", () => {
  vscode.postMessage({ command: "reload" })
})

vscode.postMessage({ command: "ready" })
