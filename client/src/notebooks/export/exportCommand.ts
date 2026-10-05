import * as vscode from "vscode"
import * as path from "path"
import { NOTEBOOK_TYPE, SQL_LANGUAGE_ID } from "../types"
import { funWindow as window } from "../../services/funMessenger"
import { type AbapNotebookController } from "../abapNotebookController"
import { cellName, effectiveSystems } from "../cellMetadata"
import {
  buildExportModel,
  describeModel,
  FORMAT_INFO,
  type ExportCellInput,
  type ExportFormat,
  type ExportModel,
  type ExportPart
} from "./exportModel"
import { writeCsvFiles, writeHtml, writeJson, writeMarkdown, writeXml } from "./textWriters"
import { writePdf } from "./pdfWriter"
import { writeDocx, writeXlsx } from "./officeWriters"

const PARTS: Array<{ part: ExportPart; label: string; detail: string }> = [
  {
    part: "data",
    label: "$(table) Data",
    detail: "Results of the cells that have been run (full data, not just the rows on screen)"
  },
  { part: "code", label: "$(code) Code", detail: "SQL and JavaScript cell sources" },
  { part: "comments", label: "$(markdown) Comments", detail: "Markdown cells" }
]

export function collectCells(
  notebook: vscode.NotebookDocument,
  controller: AbapNotebookController
): ExportCellInput[] {
  const view = controller.getResultsView(notebook)
  const eff = effectiveSystems(notebook)
  return notebook.getCells().map(c => {
    const lang = c.document.languageId
    const kind: ExportCellInput["kind"] =
      c.kind === vscode.NotebookCellKind.Markup
        ? "markdown"
        : lang === SQL_LANGUAGE_ID
          ? "sql"
          : "javascript"
    return {
      index: c.index,
      kind,
      source: c.document.getText(),
      name: cellName(c),
      system: kind === "sql" ? eff[c.index]?.system : undefined,
      result: view.byIndex.get(c.index)
    }
  })
}

async function renderMarkdownHtml(md: string): Promise<string> {
  try {
    const html = await vscode.commands.executeCommand<string>("markdown.api.render", md)
    if (typeof html === "string") return html
  } catch {
    /* markdown extension unavailable: fall back */
  }
  return `<pre>${md.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`
}

export async function renderModel(
  m: ExportModel,
  format: Exclude<ExportFormat, "csv">
): Promise<Uint8Array> {
  const utf8 = (s: string) => new TextEncoder().encode(s)
  switch (format) {
    case "json":
      return utf8(writeJson(m))
    case "xml":
      return utf8(writeXml(m))
    case "md":
      return utf8(writeMarkdown(m))
    case "pdf":
      return writePdf(m)
    case "xlsx":
      return writeXlsx(m)
    case "docx":
      return writeDocx(m)
    case "html": {
      // pre-render markdown (async) then build the page
      const rendered = new Map<string, string>()
      for (const i of m.items)
        if (
          (i.kind === "comment" || i.contentType === "markdown") &&
          i.text &&
          !rendered.has(i.text)
        )
          rendered.set(i.text, await renderMarkdownHtml(i.text))
      return utf8(writeHtml(m, md => rendered.get(md) ?? md))
    }
  }
}

export async function exportNotebook(controller: AbapNotebookController): Promise<void> {
  const editor = vscode.window.activeNotebookEditor
  if (!editor || editor.notebook.notebookType !== NOTEBOOK_TYPE) {
    window.showWarningMessage("Open an SAP Data Workbook (.sapwb) to export it.")
    return
  }
  const notebook = editor.notebook
  const cells = collectCells(notebook, controller)
  const withResults = cells.filter(c => c.result && !c.result.error).length

  const partPick = await window.showQuickPick(
    PARTS.map(p => ({
      label: p.label,
      detail: p.part === "data" ? `${p.detail} — ${withResults} cell(s) have results` : p.detail,
      picked: p.part !== "data" || withResults > 0,
      part: p.part
    })),
    {
      canPickMany: true,
      title: "Export SAP Data Workbook (1/2): what to include",
      placeHolder: "Pick any one, two or all three"
    }
  )
  if (!partPick || partPick.length === 0) return
  const parts = partPick.map(p => p.part)

  const formatPick = await window.showQuickPick(
    (Object.keys(FORMAT_INFO) as ExportFormat[]).map(f => ({
      label: FORMAT_INFO[f].label,
      description: `.${FORMAT_INFO[f].ext}`,
      detail: FORMAT_INFO[f].description,
      format: f
    })),
    { title: "Export SAP Data Workbook (2/2): format" }
  )
  if (!formatPick) return
  const format = formatPick.format

  const base = path.basename(notebook.uri.fsPath || notebook.uri.path, ".sapwb") || "workbook"
  const title = (notebook.metadata?.title as string) || base
  const model = buildExportModel(
    cells,
    parts,
    title,
    path.basename(notebook.uri.fsPath || notebook.uri.path)
  )

  if (model.items.length === 0) {
    window.showWarningMessage(
      parts.includes("data") && withResults === 0
        ? "Nothing to export: no cell has results yet. Run the workbook first, or export code/comments."
        : "Nothing to export for the selected parts."
    )
    return
  }
  if (format === "csv" && !parts.includes("data")) {
    window.showWarningMessage("CSV can only hold data. Include 'Data' or pick another format.")
    return
  }

  const dir =
    notebook.uri.scheme === "file" ? vscode.Uri.file(path.dirname(notebook.uri.fsPath)) : undefined
  const ext = FORMAT_INFO[format].ext
  const target = await window.showSaveDialog({
    defaultUri: dir ? vscode.Uri.joinPath(dir, `${base}.${ext}`) : undefined,
    filters: { [FORMAT_INFO[format].label]: [ext] },
    title:
      format === "csv"
        ? "Base name for the CSV files (one file per result table)"
        : `Export as ${FORMAT_INFO[format].label}`
  })
  if (!target) return

  try {
    const written: vscode.Uri[] = []
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Exporting ${FORMAT_INFO[format].label}…`
      },
      async () => {
        if (format === "csv") {
          const files = writeCsvFiles(model)
          if (files.length === 0) throw new Error("No result tables to write as CSV.")
          const stem = target.path.replace(/\.csv$/i, "")
          for (const f of files) {
            const uri = target.with({ path: `${stem}${f.suffix}.csv` })
            await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(f.content))
            written.push(uri)
          }
        } else {
          await vscode.workspace.fs.writeFile(target, await renderModel(model, format))
          written.push(target)
        }
      }
    )
    const summary = `${describeModel(model)} → ${written.length === 1 ? path.basename(written[0].fsPath) : `${written.length} CSV files`}`
    const action = await window.showInformationMessage(
      `Exported ${summary}`,
      "Open",
      "Reveal in Explorer"
    )
    if (action === "Open") await vscode.env.openExternal(written[0])
    if (action === "Reveal in Explorer")
      await vscode.commands.executeCommand("revealFileInOS", written[0])
  } catch (e: unknown) {
    window.showErrorMessage(`Export failed: ${e instanceof Error ? e.message : String(e)}`)
  }
}
