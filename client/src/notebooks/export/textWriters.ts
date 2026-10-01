/** JSON, XML, HTML, Markdown and CSV writers for the export model. */
import { escapeXml, statusKind, toXml, STATUS_COLORS } from "../display"
import {
  cellLabel,
  safeJson,
  type ExportItem,
  type ExportModel,
  type ExportTable
} from "./exportModel"
import {
  codeCaption,
  FENCE_LANG,
  itemCodeLang,
  LANG_ID,
  langOf,
  tokenize,
  TOKEN_COLORS,
  type CodeLang
} from "./codeFormat"

// ------------------------------------------------------------------ JSON

export function writeJson(m: ExportModel): string {
  return safeJson({
    title: m.title,
    source: m.source,
    generated: m.generated,
    parts: m.parts,
    items: m.items.map(i => ({
      cell: i.index,
      ...(i.name ? { name: i.name } : {}),
      ...(i.system ? { system: i.system } : {}),
      kind: i.kind,
      ...(i.language && i.language !== "markdown" ? { language: LANG_ID[langOf(i.language)] } : {}),
      ...(i.language === "markdown" ? { language: "markdown" } : {}),
      ...(i.kind === "code" ? { format: "code" } : {}),
      ...(i.table
        ? { columns: i.table.columns, rowCount: i.table.totalRows, rows: tableObjects(i.table) }
        : i.kind === "data"
          ? { contentType: i.contentType, content: i.contentType === "json" ? i.value : i.text }
          : { text: i.text })
    }))
  })
}

function tableObjects(t: ExportTable): Record<string, string>[] {
  return t.rows.map(r => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])))
}

// ------------------------------------------------------------------ XML

export function writeXml(m: ExportModel): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>']
  lines.push(
    `<workbook title="${escapeXml(m.title)}" generated="${escapeXml(m.generated)}"${m.source ? ` source="${escapeXml(m.source)}"` : ""} parts="${m.parts.join(" ")}">`
  )
  for (const i of m.items) {
    const attrs =
      `cell="${i.index}"` +
      (i.name ? ` name="${escapeXml(i.name)}"` : "") +
      (i.system ? ` system="${escapeXml(i.system)}"` : "") +
      (i.language
        ? ` language="${i.language === "markdown" ? "markdown" : LANG_ID[langOf(i.language)]}"`
        : "") +
      (i.kind === "code" ? ` format="code"` : "")
    if (i.kind !== "data") {
      lines.push(`  <${i.kind} ${attrs}><![CDATA[${cdata(i.text ?? "")}]]></${i.kind}>`)
      continue
    }
    if (i.table) {
      lines.push(`  <data ${attrs} rows="${i.table.totalRows}">`)
      lines.push(
        `    <columns>${i.table.columns.map(c => `<column>${escapeXml(c)}</column>`).join("")}</columns>`
      )
      for (const r of i.table.rows) {
        lines.push(
          `    <row>${i.table.columns.map((c, k) => `<field name="${escapeXml(c)}">${escapeXml(r[k])}</field>`).join("")}</row>`
        )
      }
      lines.push("  </data>")
    } else if (i.contentType === "json") {
      lines.push(`  <data ${attrs} contentType="json">`)
      lines.push(toXml(i.value, "value", "    "))
      lines.push("  </data>")
    } else {
      lines.push(
        `  <data ${attrs} contentType="${i.contentType}"><![CDATA[${cdata(i.text ?? "")}]]></data>`
      )
    }
  }
  lines.push("</workbook>")
  return lines.join("\n")
}

const cdata = (s: string) => s.replace(/]]>/g, "]]]]><![CDATA[>")

// ------------------------------------------------------------------ HTML

const escHtml = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")

export function htmlTable(t: ExportTable): string {
  if (t.columns.length === 0) return `<p class="muted">(no rows)</p>`
  const head = t.columns.map(c => `<th>${escHtml(c)}</th>`).join("")
  const body = t.rows
    .map(
      r =>
        `<tr>${r
          .map(v => {
            const k = statusKind(v)
            return `<td${k ? ` style="background:#${STATUS_COLORS[k]};font-weight:600"` : ""}>${escHtml(v)}</td>`
          })
          .join("")}</tr>`
    )
    .join("\n")
  return `<div class="tw"><table><thead><tr>${head}</tr></thead><tbody>\n${body}\n</tbody></table></div><p class="muted">${t.totalRows} row(s)</p>`
}

/** A labelled, syntax-highlighted code block (<figure><figcaption>ABAP SQL · name</figcaption><pre><code>). */
export function htmlCodeBlock(
  code: string,
  lang: CodeLang,
  name?: string,
  system?: string
): string {
  const body = tokenize(code, lang)
    .map(line =>
      line
        .map(t =>
          t.kind === "plain"
            ? escHtml(t.text)
            : `<span class="tok-${t.kind}">${escHtml(t.text)}</span>`
        )
        .join("")
    )
    .join("\n")
  return `<figure class="codeblock"><figcaption>${escHtml(codeCaption(lang, name, system))}</figcaption><pre><code class="language-${FENCE_LANG[lang]}">${body}</code></pre></figure>`
}

const TOKEN_CSS = (Object.keys(TOKEN_COLORS) as Array<keyof typeof TOKEN_COLORS>)
  .filter(k => k !== "plain")
  .map(
    k =>
      `.tok-${k}{color:#${TOKEN_COLORS[k]}${k === "kw" ? ";font-weight:600" : k === "com" ? ";font-style:italic" : ""}}`
  )
  .join("")

export function writeHtml(m: ExportModel, renderMarkdown: (md: string) => string): string {
  const sections = m.items.map(i => {
    const label = `<div class="label">${escHtml(cellLabel(i))} <span class="kind ${i.kind}">${i.kind}</span></div>`
    if (i.kind === "comment")
      return `<section class="comment">${label}${renderMarkdown(i.text ?? "")}</section>`
    if (i.kind === "code")
      return `<section class="code">${label}${htmlCodeBlock(i.text ?? "", langOf(i.language), i.name, i.system)}</section>`
    if (i.table) return `<section class="data">${label}${htmlTable(i.table)}</section>`
    if (i.contentType === "html")
      return `<section class="data">${label}<div class="html">${i.text}</div></section>`
    if (i.contentType === "markdown")
      return `<section class="data">${label}${renderMarkdown(i.text ?? "")}</section>`
    const lang = itemCodeLang(i)
    if (!lang)
      return `<section class="data">${label}<div class="text">${escHtml(i.text)}</div></section>`
    return `<section class="data">${label}${htmlCodeBlock(i.text ?? "", lang)}</section>`
  })
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escHtml(m.title)}</title>
<style>
:root{--bg:#fff;--fg:#1d1f23;--muted:#6b7280;--line:#e5e7eb;--head:#f3f4f6;--code:#f6f8fa}
@media (prefers-color-scheme:dark){:root{--bg:#16181d;--fg:#e6e6e6;--muted:#9aa0a6;--line:#30343b;--head:#23262d;--code:#1e2127}}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;margin:0 auto;max-width:1400px;padding:24px 16px}
h1{font-size:22px;margin:0 0 4px}.meta{color:var(--muted);margin-bottom:24px}
section{border-top:1px solid var(--line);padding:14px 0}
.label{font-size:12px;color:var(--muted);margin-bottom:6px}
.kind{border:1px solid var(--line);border-radius:10px;padding:0 6px;margin-left:6px}
pre{background:var(--code);padding:10px 12px;border-radius:0 0 6px 6px;overflow:auto;font:12px/1.45 ui-monospace,Consolas,monospace;margin:0}
figure.codeblock{margin:0;border:1px solid var(--line);border-left:4px solid #0b4f9c;border-radius:6px;overflow:hidden}
figure.codeblock figcaption{font:600 11px/1.6 system-ui,sans-serif;letter-spacing:.02em;color:var(--muted);background:var(--head);padding:3px 10px;border-bottom:1px solid var(--line)}
${TOKEN_CSS}
@media (prefers-color-scheme:dark){.tok-kw{color:#6cb6ff}.tok-str{color:#f69d50}.tok-com{color:#8b949e}.tok-num{color:#96d0ff}.tok-var{color:#dcbdfb}.tok-tag{color:#8ddb8c}}
.tw{overflow:auto;max-height:70vh;border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th{position:sticky;top:0;background:var(--head);text-align:left;padding:6px 8px;border-bottom:2px solid var(--line)}
td{padding:4px 8px;border-bottom:1px solid var(--line);vertical-align:top;overflow-wrap:break-word}
.muted{color:var(--muted);font-size:12px}
.text{white-space:pre-wrap}
@media print{.tw{max-height:none;overflow:visible}section{break-inside:avoid-page}}
</style></head><body>
<h1>${escHtml(m.title)}</h1>
<div class="meta">Exported ${escHtml(m.generated)}${m.source ? ` from ${escHtml(m.source)}` : ""} · ${m.parts.join(", ")}</div>
${sections.join("\n")}
</body></html>`
}

// ------------------------------------------------------------------ Markdown

const mdCell = (v: string) => v.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")

export function markdownTable(t: ExportTable): string {
  if (t.columns.length === 0) return "_(no rows)_"
  return [
    `| ${t.columns.map(mdCell).join(" | ")} |`,
    `| ${t.columns.map(() => "---").join(" | ")} |`,
    ...t.rows.map(r => `| ${r.map(mdCell).join(" | ")} |`)
  ].join("\n")
}

/** Caption line + fenced code block; the fence grows if the code itself contains ``` . */
export function mdCodeBlock(
  code: string,
  lang: CodeLang,
  name?: string,
  system?: string
): string[] {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map(r => r.length))
  const fence = "`".repeat(longest + 1)
  return [`*${codeCaption(lang, name, system)}*`, "", fence + FENCE_LANG[lang], code, fence]
}

export function writeMarkdown(m: ExportModel): string {
  const out: string[] = [
    `# ${m.title}`,
    "",
    `_Exported ${m.generated}${m.source ? ` from ${m.source}` : ""}_`,
    ""
  ]
  for (const i of m.items) {
    out.push(`---`, "", `**${cellLabel(i)}** — ${i.kind}`, "")
    if (i.kind === "comment") out.push(i.text ?? "")
    else if (i.kind === "code")
      out.push(...mdCodeBlock(i.text ?? "", langOf(i.language), i.name, i.system))
    else if (i.table) out.push(markdownTable(i.table), "", `_${i.table.totalRows} row(s)_`)
    else if (i.contentType === "markdown") out.push(i.text ?? "")
    else {
      const lang = itemCodeLang(i)
      out.push(...(lang ? mdCodeBlock(i.text ?? "", lang) : [i.text ?? ""]))
    }
    out.push("")
  }
  return out.join("\n")
}

// ------------------------------------------------------------------ CSV

export function csvTable(t: ExportTable): string {
  const q = (v: string) =>
    /[",\r\n;]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return (
    "﻿" + [t.columns.map(q).join(","), ...t.rows.map(r => r.map(q).join(","))].join("\r\n") + "\r\n"
  )
}

/** One CSV per data table. File suffix: _cell<N>[_name]. Non-table results are skipped. */
export function writeCsvFiles(
  m: ExportModel
): Array<{ suffix: string; content: string; item: ExportItem }> {
  return m.items
    .filter(i => i.kind === "data" && i.table && i.table.columns.length > 0)
    .map(i => ({
      suffix: `_cell${i.index}${i.name ? "_" + i.name.replace(/[^\w-]/g, "_") : ""}`,
      content: csvTable(i.table!),
      item: i
    }))
}
