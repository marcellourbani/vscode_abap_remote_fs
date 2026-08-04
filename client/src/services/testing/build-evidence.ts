/**
 * Build ONE .docx test-evidence report per program folder.
 *
 * Layout expected:
 *   tests/<PROGRAM>/test-results/<TC-ID>/manifest.json
 *   tests/<PROGRAM>/test-results/<TC-ID>/step-NN.png
 *
 * Output:
 *   tests/<PROGRAM>/test-results/<PROGRAM>-report.docx
 *     — a single document containing every TC of that program, one section per TC,
 *     with pass/fail summary at the top.
 *
 * Run: `npm run evidence`
 */
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  ImageRun,
  AlignmentType,
  TextRun,
  Table,
  TableRow,
  WidthType,
  PageBreak,
  Header
} from "docx"
import * as fs from "fs/promises"
import * as path from "path"
import type { Manifest } from "./runtime/evidence"
import { borderedTable, borderedTableCell } from "./docx-table"

/**
 * Written by the AI (via run-scripts' "Post-test verification" step), NOT by
 * playwright_test — Playwright can't run SQL or open AL11/SXMB_MONI, so this file
 * records checks the spec itself structurally cannot make. See run-scripts/SKILL.md.
 *
 * A check is either performed by the model (`by: "sql"` — an ABAP SQL query it ran)
 * or must be performed by the user (`by: "manual"` — e.g. AL11 file bytes, an
 * SXMB_MONI payload, an external-system arrival). A manual check that the user has
 * not yet confirmed is recorded with status "pending-manual" so the report never
 * silently claims a case is fully verified when a human step is still outstanding.
 */
type VerificationCheck = {
  label: string
  by?: "sql" | "manual"
  sql?: string
  /** For manual checks: the transaction/tool the user must use (AL11, SXMB_MONI, WE02, SM37, ...). */
  tool?: string
  /** For manual checks: what the user must look for. */
  instructions?: string
  actual?: string
  expected?: string
  status: "pass" | "fail" | "pending-manual"
}
type VerificationFile = {
  checks: VerificationCheck[]
  overallStatus: "pass" | "fail" | "pending-manual"
}

type Case = {
  manifestPath: string
  manifest: Manifest
  verification: VerificationFile | null
}

/**
 * The TRUE outcome of a case: a UI-level pass can still be an overall fail if its
 * post-test SQL verification came back wrong. This is the whole point of that
 * feature — a green Playwright run must never silently outrank a failed DB check.
 */
function effectiveStatus(c: Case): Manifest["status"] {
  if (c.manifest.status === "pass" && c.verification?.overallStatus === "fail") {
    return "fail"
  }
  return c.manifest.status
}

/**
 * A case that passed at the UI level and has no failed verification, but still has a
 * manual verification step the user hasn't confirmed, is NOT fully verified. We keep
 * its pass/fail status but flag it so the report never implies the object was proven
 * to have done its job when a human check is still outstanding.
 */
function verificationPending(c: Case): boolean {
  if (effectiveStatus(c) !== "pass") return false
  return (
    c.verification?.overallStatus === "pending-manual" ||
    (c.verification?.checks ?? []).some(ch => ch.status === "pending-manual")
  )
}

function checkStatusLabel(status: VerificationCheck["status"]): { text: string; color: string } {
  if (status === "pass") return { text: "PASS", color: "008000" }
  if (status === "fail") return { text: "FAIL", color: "C00000" }
  return { text: "PENDING — user must verify", color: "B8860B" }
}

/**
 * The status shown in the report. A case with an outstanding manual verification is
 * NOT counted or shown as passed — it is its own "MANUAL VERIFICATION PENDING" state
 * until the user confirms the manual check(s). Only a UI pass with no failed and no
 * pending verification is a real PASS.
 */
function displayStatus(c: Case): { text: string; color: string } {
  if (verificationPending(c)) {
    return { text: "MANUAL VERIFICATION PENDING", color: "B8860B" }
  }
  const status = effectiveStatus(c)
  return {
    text: status.toUpperCase() + (status !== c.manifest.status ? " (SQL verification failed)" : ""),
    color: statusColor(status)
  }
}

async function collectCases(systemDir: string): Promise<Case[]> {
  // systemDir = tests/<PROGRAM>/test-results/<SYSTEM>
  let entries: string[]
  try {
    entries = await fs.readdir(systemDir)
  } catch {
    return []
  }
  const cases: Case[] = []
  for (const e of entries) {
    const mp = path.join(systemDir, e, "manifest.json")
    try {
      const raw = await fs.readFile(mp, "utf8")
      const manifest: Manifest = JSON.parse(raw)
      const verification = await fs
        .readFile(path.join(systemDir, e, "verification.json"), "utf8")
        .then(v => JSON.parse(v) as VerificationFile)
        .catch(() => null)
      cases.push({ manifestPath: mp, manifest, verification })
    } catch {
      // no manifest for this folder, skip
    }
  }
  cases.sort((a, b) => a.manifest.tcId.localeCompare(b.manifest.tcId))
  return cases
}

function statusColor(status: Manifest["status"]): string {
  if (status === "pass") return "008000"
  if (status === "fail") return "C00000"
  return "808080"
}

function summaryTable(cases: Case[]): Table {
  const header = new TableRow({
    children: ["TC-ID", "Title", "Status", "Started", "Finished"].map(h =>
      borderedTableCell({
        width: { size: 20, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })]
      })
    )
  })
  const rows = cases.map(c => {
    const { manifest: m } = c
    return new TableRow({
      children: [
        borderedTableCell({
          children: [new Paragraph(m.tcId)]
        }),
        borderedTableCell({
          children: [new Paragraph(m.title)]
        }),
        borderedTableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: displayStatus(c).text,
                  color: displayStatus(c).color,
                  bold: true
                })
              ]
            })
          ]
        }),
        borderedTableCell({
          children: [new Paragraph(m.startedAt)]
        }),
        borderedTableCell({
          children: [new Paragraph(m.finishedAt ?? "(in progress)")]
        })
      ]
    })
  })
  return borderedTable({
    rows: [header, ...rows],
    width: { size: 100, type: WidthType.PERCENTAGE }
  })
}

async function caseSection(c: Case, isFirst: boolean): Promise<Paragraph[]> {
  const { manifest: m } = c
  const dir = path.dirname(c.manifestPath)
  const out: Paragraph[] = []

  // Page break before each case except the first, so each TC starts on a new page
  if (!isFirst) {
    out.push(new Paragraph({ children: [new PageBreak()] }))
  }

  out.push(
    new Paragraph({
      text: `${m.tcId} — ${m.title}`,
      heading: HeadingLevel.HEADING_1
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Status: `, bold: true }),
        new TextRun({
          text: displayStatus(c).text,
          color: displayStatus(c).color,
          bold: true
        }),
        new TextRun({ text: `    Started: `, bold: true }),
        new TextRun(m.startedAt),
        new TextRun({ text: `    Finished: `, bold: true }),
        new TextRun(m.finishedAt ?? "(in progress)")
      ]
    })
  )

  if (m.errorMessage) {
    out.push(
      new Paragraph({ text: "Error", heading: HeadingLevel.HEADING_2 }),
      new Paragraph({
        children: [new TextRun({ text: m.errorMessage, color: "C00000" })]
      })
    )
  }

  if (c.verification) {
    out.push(
      new Paragraph({
        text: "Post-test Verification",
        heading: HeadingLevel.HEADING_2
      })
    )
    for (const check of c.verification.checks) {
      const label = checkStatusLabel(check.status)
      const by = check.by === "manual" ? "manual (user)" : "SQL (automated)"
      out.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${check.label} [${by}]: `, bold: true }),
            new TextRun({ text: label.text, color: label.color, bold: true })
          ]
        })
      )
      if (check.sql) {
        out.push(
          new Paragraph({
            children: [
              new TextRun({ text: "SQL: ", italics: true }),
              new TextRun({ text: check.sql, italics: true, size: 18 })
            ]
          })
        )
      }
      if (check.tool) {
        out.push(
          new Paragraph({
            children: [
              new TextRun({ text: "Verify via: ", italics: true }),
              new TextRun({ text: check.tool, italics: true, size: 18 })
            ]
          })
        )
      }
      if (check.instructions) {
        out.push(new Paragraph({ children: [new TextRun({ text: check.instructions, size: 18 })] }))
      }
      if (check.actual !== undefined || check.expected !== undefined) {
        out.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `Actual: ${check.actual ?? "(pending)"}    Expected: ${check.expected ?? "(see instructions)"}`
              })
            ]
          })
        )
      }
    }
  }

  out.push(new Paragraph({ text: "Steps", heading: HeadingLevel.HEADING_2 }))

  for (const step of m.steps) {
    out.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_3,
        text: `Step ${step.n}: ${step.description}`
      }),
      new Paragraph({
        children: [new TextRun({ text: step.timestamp, italics: true, size: 18 })]
      })
    )
    if (step.notes) {
      out.push(new Paragraph({ children: [new TextRun({ text: step.notes })] }))
    }
    if (step.screenshot) {
      const imgPath = path.join(dir, step.screenshot)
      try {
        const buf = await fs.readFile(imgPath)
        out.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                data: buf,
                transformation: { width: 600, height: 340 }
              } as any)
            ]
          })
        )
      } catch {
        out.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `(screenshot missing: ${step.screenshot})`,
                italics: true
              })
            ]
          })
        )
      }
    }
  }

  return out
}

async function buildProgramReport(
  programDir: string,
  programName: string,
  systemName: string
): Promise<string | null> {
  const systemDir = path.join(programDir, "test-results", systemName)
  const cases = await collectCases(systemDir)
  if (!cases.length) return null

  const pendingVerification = cases.filter(verificationPending).length
  // A pending-manual case does NOT count as passed — it is only a real pass once the
  // user confirms its manual check(s). Pending, pass, and fail are mutually exclusive.
  const pass = cases.filter(c => effectiveStatus(c) === "pass" && !verificationPending(c)).length
  const fail = cases.filter(c => effectiveStatus(c) === "fail").length
  const other = cases.length - pass - fail - pendingVerification

  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text: `${programName} — Test Evidence Report`,
      heading: HeadingLevel.TITLE
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `System: `, bold: true }),
        new TextRun(systemName),
        new TextRun({ text: `    Generated: `, bold: true }),
        new TextRun(new Date().toISOString())
      ]
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Total: `, bold: true }),
        new TextRun(`${cases.length}    `),
        new TextRun({ text: `Passed: `, bold: true, color: "008000" }),
        new TextRun(`${pass}    `),
        new TextRun({ text: `Failed: `, bold: true, color: "C00000" }),
        new TextRun(`${fail}    `),
        new TextRun({ text: `Manual verification pending: `, bold: true, color: "B8860B" }),
        new TextRun(`${pendingVerification}    `),
        new TextRun({ text: `Other: `, bold: true }),
        new TextRun(`${other}`)
      ]
    }),
    new Paragraph({ text: "Summary", heading: HeadingLevel.HEADING_1 }),
    summaryTable(cases),
    new Paragraph({ text: "Details", heading: HeadingLevel.HEADING_1 })
  ]

  let isFirst = true
  for (const c of cases) {
    const paras = await caseSection(c, isFirst)
    children.push(...paras)
    isFirst = false
  }

  const runningHeader = new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({ text: `${programName}  •  `, bold: true }),
          new TextRun({ text: `System: `, bold: true }),
          new TextRun({ text: systemName, bold: true, color: "1F4E79" })
        ]
      })
    ]
  })

  const doc = new Document({
    sections: [
      {
        headers: { default: runningHeader },
        children
      }
    ]
  })
  const buf = await Packer.toBuffer(doc)
  const outPath = path.join(programDir, "test-results", `${programName}-${systemName}-report.docx`)
  await fs.writeFile(outPath, buf)
  return outPath
}

/**
 * Build the .docx evidence report for exactly one program+system.
 * Exposed to the AI as the `build_evidence_report` language model tool — see
 * src/tools/buildEvidenceReportTool.ts.
 *
 * Throws if there are no test-results (manifest.json files) for that program+system —
 * run playwright_test first.
 */
export async function buildEvidenceReport(
  testFolder: string,
  program: string,
  system: string
): Promise<string> {
  const programDir = path.resolve(testFolder, "tests", program)
  const outPath = await buildProgramReport(programDir, program, system.toUpperCase())
  if (!outPath) {
    throw new Error(
      `No test results found for ${program} on ${system.toUpperCase()} — ` +
        `run playwright_test first (results live in ${path.join(programDir, "test-results", system.toUpperCase())}).`
    )
  }
  return outPath
}
