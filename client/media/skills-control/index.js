const vscode = acquireVsCodeApi()

const statusElement = document.getElementById("status")
const skillsElement = document.getElementById("skills")
const refreshButton = document.getElementById("refresh")
const saveButton = document.getElementById("save")

let skills = []

function setBusy(busy) {
  refreshButton.disabled = busy
  saveButton.disabled = busy || skills.length === 0
}

function showStatus(message, kind = "info") {
  statusElement.textContent = message
  statusElement.className = `status ${kind}`
}

function renderSkills(enabledSkills) {
  skillsElement.replaceChildren()
  for (const skill of skills) {
    const card = document.createElement("article")
    card.className = "skill-card"

    const heading = document.createElement("div")
    heading.className = "skill-heading"
    const title = document.createElement("h2")
    title.textContent = skill.displayName
    const id = document.createElement("span")
    id.className = "skill-id"
    id.textContent = skill.id
    heading.append(title, id)

    const description = document.createElement("p")
    description.textContent = skill.description

    const label = document.createElement("label")
    label.className = "skill-toggle"
    const toggle = document.createElement("input")
    toggle.type = "checkbox"
    toggle.checked = enabledSkills[skill.id] !== false
    toggle.dataset.skillId = skill.id
    toggle.addEventListener("change", updateEnabledStatus)
    label.append(toggle, document.createTextNode("Available to Copilot"))

    card.append(heading, description, label)
    skillsElement.appendChild(card)
  }
}

function enabledSkillCount() {
  return skillsElement.querySelectorAll("input[data-skill-id]:checked").length
}

function updateEnabledStatus() {
  showStatus(`${enabledSkillCount()}/${skills.length} general skills enabled.`)
}

function selections() {
  const enabledSkills = {}
  for (const toggle of skillsElement.querySelectorAll("input[data-skill-id]")) {
    enabledSkills[toggle.dataset.skillId] = toggle.checked
  }
  return enabledSkills
}

window.addEventListener("message", event => {
  const message = event.data
  switch (message.type) {
    case "loading":
      setBusy(true)
      showStatus("Loading skills…")
      break
    case "skills":
      skills = message.skills || []
      const enabledSkills = message.enabledSkills || {}
      renderSkills(enabledSkills)
      updateEnabledStatus()
      setBusy(false)
      break
    case "saving":
      setBusy(true)
      showStatus("Saving skill availability…")
      break
    case "saved":
      setBusy(false)
      showStatus("Skills saved. The new availability is active.", "success")
      break
    case "error":
      setBusy(false)
      showStatus(message.message || "The skill settings could not be saved.", "error")
      break
  }
})

refreshButton.addEventListener("click", () => vscode.postMessage({ command: "refresh" }))
saveButton.addEventListener("click", () =>
  vscode.postMessage({ command: "save", selections: selections() })
)
vscode.postMessage({ command: "ready" })
