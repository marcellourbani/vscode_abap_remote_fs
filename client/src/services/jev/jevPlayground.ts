import { randomBytes, randomUUID } from "crypto"
import { basename } from "path"
import * as vscode from "vscode"
import { AdtObjectFinder } from "../../adt/operations/AdtObjectFinder"
import { pickAdtRoot } from "../../config"
import { askJev } from "./jevService"
import type {
  JevChoiceQuestion,
  JevNoulQuestion,
  JevQuestion,
  JevScoreQuestion
} from "./types"

const CONTEXT_WARNING_CHARS = 80_000

interface AskMessage {
  command: "ask"
  primitive: "choice" | "score" | "noul"
  state: string
  instructions: string
  model?: string
  timeoutMs?: number
  options?: Array<{ label?: string; description?: string }>
  levels?: string[]
  trueCriteria?: string
  falseCriteria?: string
}

interface AttachMessage {
  command: "attachFile" | "attachAbapObject"
}

interface Attachment {
  placeholder: string
  label: string
  content: string
}

export function registerJevPlayground(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("abapfs.askJev", () => JevPlaygroundPanel.open(context))
  )
}

class JevPlaygroundPanel {
  private static instance?: JevPlaygroundPanel
  private controller?: AbortController
  private readonly attachments = new Map<string, Attachment>()

  static open(context: vscode.ExtensionContext): void {
    if (this.instance) {
      this.instance.panel.reveal()
      return
    }
    const panel = vscode.window.createWebviewPanel(
      "abapfs.askJev",
      "Ask Jev",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    )
    this.instance = new JevPlaygroundPanel(panel)
    panel.webview.html = html(panel.webview)
  }

  private constructor(private readonly panel: vscode.WebviewPanel) {
    panel.onDidDispose(() => {
      this.controller?.abort()
      JevPlaygroundPanel.instance = undefined
    })
    panel.webview.onDidReceiveMessage(message => this.handleMessage(message))
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (isAttachMessage(message)) {
      await this.attach(message)
      return
    }
    if (!isAskMessage(message)) return
    this.controller?.abort()
    const controller = new AbortController()
    this.controller = controller
    try {
      const state = this.expandState(message.state)
      if (!state) throw new Error("Enter the state Jev should evaluate.")
      const question = buildQuestion(message)
      const result = await askJev(
        {
          state,
          questions: { answer: question },
          ...(message.model?.trim() ? { model: message.model.trim() } : {})
        },
        {
          signal: controller.signal,
          timeoutMs: validTimeout(message.timeoutMs)
        }
      )
      if (this.controller !== controller) return
      await this.panel.webview.postMessage({ command: "result", result })
    } catch (error) {
      if (this.controller !== controller) return
      await this.panel.webview.postMessage({
        command: "validationError",
        message: error instanceof Error ? error.message : "The request is invalid."
      })
    }
  }

  private async attach(message: AttachMessage): Promise<void> {
    try {
      const attachment =
        message.command === "attachFile"
          ? await this.pickLocalFile()
          : await this.pickAbapObject()
      if (!attachment) {
        await this.panel.webview.postMessage({ command: "attachmentCancelled" })
        return
      }
      this.attachments.set(attachment.placeholder, attachment)
      await this.panel.webview.postMessage({
        command: "attachment",
        attachment: {
          placeholder: attachment.placeholder,
          label: attachment.label,
          characterCount: attachment.content.length
        }
      })
    } catch (error) {
      await this.panel.webview.postMessage({
        command: "attachmentError",
        message: error instanceof Error ? error.message : "The attachment could not be added."
      })
    }
  }

  private async pickLocalFile(): Promise<Attachment | undefined> {
    const selected = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: "Attach to Jev state"
    })
    const uri = selected?.[0]
    if (!uri) return undefined
    const bytes = await vscode.workspace.fs.readFile(uri)
    let content: string
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new Error("Only UTF-8 text files can be attached.")
    }
    return this.createAttachment("file", basename(uri.fsPath), content)
  }

  private async pickAbapObject(): Promise<Attachment | undefined> {
    const root = await pickAdtRoot()
    if (!root) return undefined
    const connectionId = root.uri.authority
    const finder = new AdtObjectFinder(connectionId)
    const selected = await finder.findObjectWithTypeFilter("Select an ABAP object to attach")
    if (!selected) return undefined
    const resolved = await finder.vscodeUriWithFile(selected.uri, true)
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(resolved.uri))
    return this.createAttachment(
      "abap",
      `${connectionId}:${selected.name}`,
      document.getText()
    )
  }

  private createAttachment(kind: "file" | "abap", label: string, content: string): Attachment {
    return {
      placeholder: `[[${kind}:${label}:${randomUUID()}]]`,
      label,
      content
    }
  }

  private expandState(state: string): string {
    let expanded = state
    for (const attachment of this.attachments.values())
      expanded = expanded.split(attachment.placeholder).join(attachment.content)
    return expanded.trim()
  }
}

function isAskMessage(value: unknown): value is AskMessage {
  if (!isRecord(value) || value.command !== "ask") return false
  return (
    (value.primitive === "choice" ||
      value.primitive === "score" ||
      value.primitive === "noul") &&
    typeof value.state === "string" &&
    typeof value.instructions === "string"
  )
}

function isAttachMessage(value: unknown): value is AttachMessage {
  return (
    isRecord(value) &&
    (value.command === "attachFile" || value.command === "attachAbapObject")
  )
}

function buildQuestion(message: AskMessage): JevQuestion {
  const instructions = message.instructions.trim()
  if (!instructions) throw new Error("Enter a focused question for Jev.")
  if (message.primitive === "noul") {
    const criteria = {
      ...(message.trueCriteria?.trim() ? { true: message.trueCriteria.trim() } : {}),
      ...(message.falseCriteria?.trim() ? { false: message.falseCriteria.trim() } : {})
    }
    const question: JevNoulQuestion = {
      type: "noul",
      instructions,
      ...(Object.keys(criteria).length ? { criteria } : {})
    }
    return question
  }
  if (message.primitive === "choice") {
    const criteria = Object.create(null) as Record<string, string>
    for (const option of message.options ?? []) {
      const label = option.label?.trim()
      if (!label) continue
      if (Object.prototype.hasOwnProperty.call(criteria, label))
        throw new Error(`Choice label "${label}" is duplicated.`)
      criteria[label] = option.description?.trim() || label
    }
    if (Object.keys(criteria).length < 2) throw new Error("Choice needs at least two labeled options.")
    const question: JevChoiceQuestion = { type: "choice", instructions, criteria }
    return question
  }
  const levels = (message.levels ?? []).map(level => level.trim()).filter(Boolean)
  if (levels.length < 2 || levels.length > 10)
    throw new Error("Score needs between 2 and 10 described levels.")
  const question: JevScoreQuestion = {
    type: "score",
    instructions,
    criteria: levels as [string, string, ...string[]]
  }
  return question
}

function validTimeout(value: number | undefined): number {
  if (value === undefined) return 10000
  if (!Number.isFinite(value) || value < 1000 || value > 120000)
    throw new Error("Timeout must be between 1,000 and 120,000 milliseconds.")
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function html(webview: vscode.Webview): string {
  const nonce = randomBytes(16).toString("base64")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ask Jev</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font-size)/1.5 var(--vscode-font-family); }
    main { max-width: 980px; margin: 0 auto; padding: 28px 32px 48px; }
    h1 { margin: 0; font-size: 26px; } .lead { margin: 4px 0 24px; color: var(--vscode-descriptionForeground); }
    .card { padding: 20px; border: 1px solid var(--vscode-panel-border); border-radius: 8px; background: var(--vscode-sideBar-background); margin-bottom: 18px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    label { display: block; font-weight: 600; margin-bottom: 6px; }
    input, textarea, select { box-sizing: border-box; width: 100%; border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); background: var(--vscode-input-background); padding: 8px 10px; border-radius: 3px; font: inherit; }
    textarea { min-height: 112px; resize: vertical; } #state { min-height: 170px; font-family: var(--vscode-editor-font-family); }
    .field { margin-bottom: 14px; } .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
    .option-row { display: grid; grid-template-columns: minmax(120px, .6fr) minmax(180px, 1.4fr) auto; gap: 8px; margin-bottom: 8px; align-items: center; }
    .score-row { grid-template-columns: 34px 1fr auto; } .index { text-align: center; color: var(--vscode-descriptionForeground); }
    button { border: 1px solid transparent; border-radius: 3px; padding: 8px 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; font: inherit; }
    button:hover { background: var(--vscode-button-hoverBackground); } button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    button.icon { padding: 5px 9px; background: transparent; color: var(--vscode-foreground); border-color: var(--vscode-panel-border); }
    .state-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; }
    .attachment-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 6px; padding: 6px 8px; background: var(--vscode-textBlockQuote-background); border-radius: 3px; }
    .actions { display: flex; align-items: center; gap: 10px; } #ask { font-weight: 600; min-width: 110px; } #ask:disabled { opacity: .65; cursor: wait; }
    .hidden { display: none; } .status { padding: 14px; border-left: 4px solid var(--vscode-notificationsWarningIcon-foreground); background: var(--vscode-textBlockQuote-background); }
    .status.error { border-color: var(--vscode-notificationsErrorIcon-foreground); } .status.success { border-color: var(--vscode-testing-iconPassed); }
    .summary { display: flex; flex-wrap: wrap; gap: 8px 22px; margin-bottom: 16px; } .summary strong { font-size: 18px; }
    table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--vscode-panel-border); } th { color: var(--vscode-descriptionForeground); font-size: 12px; text-transform: uppercase; }
    .bar-cell { width: 45%; } .bar-track { height: 9px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 5px; overflow: hidden; } .bar { height: 100%; background: var(--vscode-button-background); }
    .winner { font-weight: 700; } .meta { margin-top: 14px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    dialog { width: min(820px, calc(100vw - 48px)); max-height: calc(100vh - 64px); box-sizing: border-box; color: var(--vscode-foreground); background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px; padding: 20px; }
    dialog::backdrop { background: rgba(0, 0, 0, .55); } dialog h2 { margin-top: 0; } dialog pre { max-height: calc(100vh - 190px); overflow: auto; padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); border-radius: 4px; font-family: var(--vscode-editor-font-family); }
    .result-actions { margin-top: 14px; }
    @media (max-width: 700px) { main { padding: 18px; } .grid { grid-template-columns: 1fr; } .option-row { grid-template-columns: 1fr; } .option-row .icon { justify-self: end; } }
  </style>
</head>
<body>
<main>
  <h1>Ask Jev</h1>
  <p class="lead">Your state, question, options or criteria, selected model, and attachment contents are sent to TypeSafe when you click Ask Jev. Results are structured, not generated text.</p>
  <section class="card">
    <div class="field">
      <label for="state">State</label>
      <textarea id="state" placeholder="Enter any text, including JSON"></textarea>
      <div class="hint">Jev limits tokens, not characters. Around ${CONTEXT_WARNING_CHARS.toLocaleString()} expanded characters may exceed its context limit, but the actual boundary depends on the content and question.</div>
      <div class="state-tools">
        <button id="attach-file" class="secondary" type="button">Add file</button>
        <button id="attach-abap" class="secondary" type="button">Add ABAP object</button>
      </div>
      <div id="attachments"></div>
      <div id="attachment-status" class="hint">Attachments are inserted at the cursor and expanded when sent.</div>
    </div>
    <div class="field"><label for="primitive">Question type</label><select id="primitive"><option value="choice">Choice</option><option value="score">Score</option><option value="noul">Noul</option></select><div id="type-hint" class="hint"></div></div>
    <div class="field"><label for="instructions">Question</label><textarea id="instructions" placeholder="Ask one narrow judgment about the state"></textarea></div>
    <div id="choice-fields" class="field"><label>Options</label><div id="options"></div><button id="add-option" class="secondary" type="button">Add option</button></div>
    <div id="score-fields" class="field hidden"><label>Ordered levels (lowest to highest)</label><div id="levels"></div><button id="add-level" class="secondary" type="button">Add level</button></div>
    <div id="noul-fields" class="grid hidden">
      <div class="field"><label for="true-criteria">True means (optional)</label><input id="true-criteria" placeholder="Condition clearly holds"></div>
      <div class="field"><label for="false-criteria">False means (optional)</label><input id="false-criteria" placeholder="Condition does not hold"></div>
    </div>
    <div class="grid">
      <div class="field"><label for="model">Model (optional)</label><input id="model" placeholder="jev-latest"></div>
      <div class="field"><label for="timeout">Timeout (ms)</label><input id="timeout" type="number" min="1000" max="120000" value="10000"></div>
    </div>
    <div class="actions"><button id="ask" type="button">Ask Jev</button><span id="activity" class="hint"></span></div>
  </section>
  <section id="result" class="card hidden" aria-live="polite"></section>
  <dialog id="raw-dialog">
    <h2>Raw Jev output</h2>
    <pre id="raw-output"></pre>
    <button id="close-raw" type="button">Close</button>
  </dialog>
</main>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi()
  const byId = id => document.getElementById(id)
  const primitive = byId("primitive"), options = byId("options"), levels = byId("levels")
  const state = byId("state"), ask = byId("ask"), activity = byId("activity"), result = byId("result")
  const attachmentStatus = byId("attachment-status"), attachments = byId("attachments")
  const rawDialog = byId("raw-dialog"), rawOutput = byId("raw-output")
  const attachedItems = new Map()
  const contextWarningCharacters = ${CONTEXT_WARNING_CHARS}
  const typeHints = {
    choice: "Use Choice to select one option from a defined set.",
    score: "Use Score for degree along ordered, concrete levels. The result is a probability-weighted position from 0 to the highest level. For yes/no questions, use Noul.",
    noul: "Use Noul for yes/no judgments. The result is the probability that the answer is yes."
  }

  function input(placeholder, value = "") {
    const element = document.createElement("input"); element.placeholder = placeholder; element.value = value; return element
  }
  function removeButton(row) {
    const button = document.createElement("button"); button.type = "button"; button.className = "icon"; button.textContent = "Remove"; button.onclick = () => row.remove(); return button
  }
  function addOption(label = "", description = "") {
    const row = document.createElement("div"); row.className = "option-row"
    const name = input("Label", label), detail = input("Description", description)
    name.className = "option-label"; detail.className = "option-description"
    row.append(name, detail, removeButton(row)); options.append(row)
  }
  function renumberLevels() { [...levels.children].forEach((row, index) => row.querySelector(".index").textContent = index) }
  function addLevel(description = "") {
    const row = document.createElement("div"); row.className = "option-row score-row"
    const index = document.createElement("span"); index.className = "index"
    const detail = input("Describe this level", description); detail.className = "level-description"
    const remove = removeButton(row); remove.onclick = () => { row.remove(); renumberLevels() }
    row.append(index, detail, remove); levels.append(row); renumberLevels()
  }
  addOption("option_a"); addOption("option_b")
  addLevel("Condition does not apply"); addLevel("Condition partly applies"); addLevel("Condition clearly applies")
  byId("add-option").onclick = () => addOption()
  byId("add-level").onclick = () => addLevel()
  function requestAttachment(command) {
    attachmentStatus.textContent = "Choose an attachment…"
    vscode.postMessage({ command })
  }
  byId("attach-file").onclick = () => requestAttachment("attachFile")
  byId("attach-abap").onclick = () => requestAttachment("attachAbapObject")
  function insertAttachment(attachment) {
    const start = state.selectionStart, end = state.selectionEnd
    const before = state.value.slice(0, start), after = state.value.slice(end)
    const leading = before && !before.endsWith("\\n") ? "\\n" : ""
    const trailing = after && !after.startsWith("\\n") ? "\\n" : ""
    const insertion = leading + attachment.placeholder + trailing
    state.value = before + insertion + after
    const cursor = before.length + insertion.length
    state.focus(); state.setSelectionRange(cursor, cursor)
    attachedItems.set(attachment.placeholder, attachment)
    renderAttachments()
  }
  function renderAttachments() {
    attachments.replaceChildren()
    let expandedCharacters = state.value.length, activeCount = 0
    for (const attachment of attachedItems.values()) {
      const occurrences = state.value.split(attachment.placeholder).length - 1
      if (!occurrences) continue
      activeCount++
      expandedCharacters += occurrences * (attachment.characterCount - attachment.placeholder.length)
      const row = text("div", "", "attachment-item")
      const label = text("span", attachment.label + " — " + attachment.characterCount.toLocaleString() + " characters")
      const remove = text("button", "Remove", "icon"); remove.type = "button"
      remove.onclick = () => {
        state.value = state.value.split(attachment.placeholder).join("")
        renderAttachments()
      }
      row.append(label, remove); attachments.append(row)
    }
    if (!activeCount) {
      attachmentStatus.textContent = "Attachments are inserted at the cursor and expanded when sent."
      return
    }
    attachmentStatus.textContent = "Expanded state: approximately " + expandedCharacters.toLocaleString() + " characters." + (expandedCharacters >= contextWarningCharacters ? " This may exceed Jev's context limit; the actual token count depends on the content." : "")
  }
  state.addEventListener("input", renderAttachments)
  function updateQuestionType() {
    byId("choice-fields").classList.toggle("hidden", primitive.value !== "choice")
    byId("score-fields").classList.toggle("hidden", primitive.value !== "score")
    byId("noul-fields").classList.toggle("hidden", primitive.value !== "noul")
    byId("type-hint").textContent = typeHints[primitive.value]
    result.classList.add("hidden")
  }
  primitive.onchange = updateQuestionType
  updateQuestionType()
  ask.onclick = () => {
    ask.disabled = true; activity.textContent = "Evaluating…"; result.classList.add("hidden")
    vscode.postMessage({
      command: "ask", primitive: primitive.value, state: state.value,
      instructions: byId("instructions").value, model: byId("model").value,
      timeoutMs: Number(byId("timeout").value),
      options: [...options.children].map(row => ({ label: row.querySelector(".option-label").value, description: row.querySelector(".option-description").value })),
      levels: [...levels.querySelectorAll(".level-description")].map(element => element.value),
      trueCriteria: byId("true-criteria").value, falseCriteria: byId("false-criteria").value
    })
  }
  function clearResult(className) { result.replaceChildren(); result.className = "card " + className }
  function text(tag, value, className) { const element = document.createElement(tag); element.textContent = value; if (className) element.className = className; return element }
  function status(message, isError = true) { clearResult("status " + (isError ? "error" : "")); result.append(text("strong", message)) }
  function rawOutputButton(value) {
    const actions = text("div", "", "result-actions"), button = text("button", "Show raw output", "secondary")
    button.type = "button"
    button.onclick = () => { rawOutput.textContent = JSON.stringify(value, null, 2); rawDialog.showModal() }
    actions.append(button)
    return actions
  }
  byId("close-raw").onclick = () => rawDialog.close()
  function probabilityTable(rows) {
    const table = document.createElement("table"), head = document.createElement("thead"), body = document.createElement("tbody")
    const header = document.createElement("tr"); ["Outcome", "Probability", ""].forEach(value => header.append(text("th", value))); head.append(header)
    rows.forEach(row => {
      const tr = document.createElement("tr"); if (row.winner) tr.className = "winner"
      tr.append(text("td", row.label + (row.winner ? "  ✓" : "")), text("td", (row.probability * 100).toFixed(1) + "%"))
      const barCell = document.createElement("td"); barCell.className = "bar-cell"
      const track = text("div", "", "bar-track"), bar = text("div", "", "bar")
      track.setAttribute("role", "progressbar"); track.setAttribute("aria-valuemin", "0"); track.setAttribute("aria-valuemax", "100"); track.setAttribute("aria-valuenow", String(Math.round(row.probability * 100)))
      bar.style.width = Math.max(0, Math.min(100, row.probability * 100)) + "%"
      track.append(bar); barCell.append(track); tr.append(barCell); body.append(tr)
    })
    table.append(head, body); return table
  }
  function showSuccess(response) {
    clearResult("success")
    const answer = response.answers.answer, summary = text("div", "", "summary")
    let rows = [], confidenceMeta = ""
    if (answer.type === "noul") {
      const likelyAnswer = answer.noul >= .5 ? "Yes" : "No"
      const likelyProbability = answer.noul >= .5 ? answer.noul : 1 - answer.noul
      summary.append(text("div", "Jev leans "), text("strong", likelyAnswer), text("div", "Probability "), text("strong", (likelyProbability * 100).toFixed(1) + "%"))
      rows = [{ label: "Yes", probability: answer.noul, winner: answer.noul >= .5 }, { label: "No", probability: 1 - answer.noul, winner: answer.noul < .5 }]
    } else if (answer.type === "choice") {
      const selectedProbability = answer.probabilities[answer.choice]
      summary.append(text("div", "Jev chose "), text("strong", answer.choice), text("div", "Confidence "), text("strong", (answer.confidence * 100).toFixed(1) + "%"))
      confidenceMeta = " · Selected probability: " + (selectedProbability * 100).toFixed(1) + "% · Confidence summarizes how concentrated the full distribution is"
      rows = Object.entries(answer.probabilities).sort((a,b) => b[1] - a[1]).map(([label, probability]) => ({ label, probability, winner: label === answer.choice }))
    } else {
      const maximumScore = Math.max(0, Object.keys(answer.legend).length - 1)
      summary.append(text("div", "Jev scored "), text("strong", answer.score.toFixed(2) + " / " + maximumScore), text("div", "Distribution confidence "), text("strong", (answer.confidence * 100).toFixed(1) + "%"))
      confidenceMeta = " · Weighted score is the average position implied by all level probabilities"
      rows = Object.entries(answer.probabilities).map(([key, probability]) => ({ label: key + " — " + String(answer.legend[key] ?? ""), probability, winner: false }))
    }
    result.append(summary, probabilityTable(rows), text("div", "Model: " + response.model + " · Input tokens: " + response.usage.inputTokens + " · Output tokens: " + response.usage.outputTokens + confidenceMeta, "meta"), rawOutputButton(response))
  }
  window.addEventListener("message", event => {
    if (event.data.command === "attachment") return insertAttachment(event.data.attachment)
    if (event.data.command === "attachmentCancelled") {
      attachmentStatus.textContent = "Attachment selection cancelled."
      return
    }
    if (event.data.command === "attachmentError") {
      attachmentStatus.textContent = event.data.message
      return
    }
    ask.disabled = false; activity.textContent = ""
    if (event.data.command === "validationError") return status(event.data.message)
    if (event.data.command !== "result") return
    const outcome = event.data.result
    if (outcome.status === "success") return showSuccess(outcome.response)
    if (outcome.status === "cancelled") return status(outcome.message, false)
    status(outcome.message + (outcome.reason === "context-limit" ? " Reduce the state and try again." : ""))
  })
</script>
</body>
</html>`
}
