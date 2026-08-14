/**
 * SE16N driver — the one helper a spec calls to prove "this is what the table actually
 * holds", in the transaction business users recognise and trust.
 *
 * WHY THIS EXISTS AS A HELPER AND NOT AS SPEC CODE
 * SE16N's selection screen is a 300+ row dynpro table control with a paging scrollbar, a
 * modal option picker whose container id changes on every open, a nested multiple-selection
 * popup, and a "silently ignores what it doesn't understand" input field. Hand-driving that
 * per test is how a value ends up in the wrong field and the test passes green on the wrong
 * data. Everything below is the deterministic recipe, verified live against MARA (361
 * selection fields), so a caller only ever supplies table + fields + criteria.
 *
 * THE THREE MECHANISMS THAT MAKE IT DETERMINISTIC
 *
 * 1. SID LOCATORS. Every ITS control carries `lsdata` containing the SAP GUI scripting
 *    path emitted by SAPLSE16N itself, e.g.
 *      wnd[0]/usr/subTAB_SUB:SAPLSE16N:0121/tblSAPLSE16NSELFIELDS_TC/ctxtGS_SELFIELDS-LOW[2,1]
 *    The DOM id (`M0:46:1:1[2,3]_c`) and the option popup's container (`grid#C102#...`,
 *    which was observed changing to `C113` then `C132` for the SAME popup) are generated
 *    and drift. The SID does not. Nothing here uses ids, refs, CSS classes, accessible
 *    names, or positional guessing.
 *
 * 2. "GET FIELD" PLACES FIELDS AT KNOWN ROWS. `ctxtGD_ADD_COLUMN` moves a named field to
 *    the end of the already-fetched block at the top of the grid, so requesting fields in
 *    order puts field i at ABSOLUTE row i+1 (row 0 is always MANDT).
 *    CRITICAL, verified: Get Field only searches FORWARD from the current window top. With
 *    the grid scrolled to row 33, asking for MATNR (row 2) does nothing at all and reports
 *    no error. Hence `scrollToTop()` before every single Get Field.
 *
 *    Row indexes inside a SID are WINDOW-relative: absolute = scrollTop - 1 + visibleRow.
 *    How many rows a window holds is NOT a constant and is never assumed — measured 16 for
 *    MARA and T000, 17 for T001D — so it is read from the table control's own scrollbar,
 *    and every verification pages until it has seen what it needs rather than trusting a
 *    single window. Nothing here breaks when a table has fewer fields than fit on screen.
 *
 * 3. READ-BACK BEFORE EVERY WRITE. `txtGS_SELFIELDS-FIELDNAME[6,r]` renders the technical
 *    name of row r. Nothing is ever written to a row without first asserting that cell
 *    equals the intended field. That is what makes "value landed in the wrong field"
 *    structurally impossible rather than merely unlikely.
 *
 * THE TRAPS THIS ENCODES (each cost a debugging session to find)
 *  - A dynpro cell renders as <span> and swaps to <input> only on activation, and a single
 *    click does NOT reopen a cell that already has focus. `setCell` escalates click →
 *    dblclick and polls for the <input>.
 *  - `fill()` on an already-open ITS input does not commit — the value silently reverts on
 *    the next round trip. We click, select-all, and TYPE.
 *  - A field-level validation failure (e.g. a date in the wrong user format) makes SAP mark
 *    every other input on the screen `readonly` until it is fixed. `setCell` detects that
 *    before attempting to edit the next field and surfaces SAP's status-bar message.
 *  - Toolbar buttons collapse into the `>>` overflow and then refuse to click even with
 *    `force: true`. We press the keyboard shortcut parsed from the button's own title.
 *  - `wnd[1]/tbar[0]/btn[21]` in the multiple-selection popup is titled "Separator for
 *    From-To" but opened a File Upload dialog. Toolbar buttons are resolved by title, and
 *    that one is never used.
 */
import type { Page, Frame } from "@playwright/test"
import type { SapSession } from "./sap-session"

/** ABAP range sign: I = include (select), E = exclude (do not select). */
export type Se16nSign = "I" | "E"

/** ABAP range option. BT/NB use `high`; CP/NP take a pattern with `*`. */
export type Se16nOption = "EQ" | "NE" | "BT" | "NB" | "CP" | "NP" | "GT" | "LT" | "GE" | "LE"

export type Se16nValue = {
  /** Defaults to "I". */
  sign?: Se16nSign
  /** Defaults to "EQ", or "BT" when `high` is supplied. */
  option?: Se16nOption
  low: string
  high?: string
}

export type Se16nCriterion = Se16nValue & {
  /** Technical field name, e.g. "MATNR". */
  field: string
  /** Multiple selection: each entry becomes one row of SE16N's "More" popup. */
  values?: Se16nValue[]
}

export type Se16nSpec = {
  /** Table or view name, e.g. "MARA". */
  table: string
  /**
   * Technical field names to include. SE16N chooses its own output order unless a layout
   * overrides it, so the order supplied here is not significant. Pass `"*"` for every field.
   */
  outputFields: string[] | "*"
  where?: Se16nCriterion[]
  /** SE16N "Max. Number of Hits". Left as-is when omitted. */
  maxHits?: number
  /**
   * SE16N display variant / layout name. Supplying one opts IN to layout-driven output —
   * see `assertNoStrayLayout`, which otherwise refuses to run when a layout is present,
   * because a layout silently overrides the requested output columns.
   */
  layout?: string
  /** Assertions on the result. `empty: true` explicitly expects no result list. */
  expect?: { minRows?: number; maxRows?: number; exactRows?: number; empty?: boolean }
  /** Screenshots. Both default to true — the evidence is the point of using SE16N. */
  evidence?: { output?: boolean; criteria?: boolean }
}

export type Se16nResult = {
  table: string
  /** SE16N's own "Number of Hits" field. Authoritative. */
  hits: number
  /** SE16N's own "Runtime" field. */
  runtime: string
  /** Technical field names in actual screen order, e.g. MATNR, ERSDA. */
  fields: string[]
  /** Output column headings, in screen order. */
  columns: string[]
  /**
   * Rows currently rendered by the ALV. WebGUI only materialises visible rows, so this is
   * a window onto the result, not necessarily all of it — `hits` is the full count.
   */
  rows: string[][]
  /** True when `rows.length < hits`, i.e. the ALV rendered only part of the result. */
  partial: boolean
  /** Status-bar text after execution, e.g. "No values found". */
  message: string
}

// ---------------------------------------------------------------------------
// Screen constants — all verified live, none guessed.
// ---------------------------------------------------------------------------

/** Selection-criteria table control. Column indexes below are ITS's, not the rendered order. */
const LOW = (r: number) => `tblSAPLSE16NSELFIELDS_TC/ctxtGS_SELFIELDS-LOW[2,${r}]`
const HIGH = (r: number) => `tblSAPLSE16NSELFIELDS_TC/ctxtGS_SELFIELDS-HIGH[3,${r}]`
const OPTION_BTN = (r: number) => `tblSAPLSE16NSELFIELDS_TC/btnOPTION[1,${r}]`
const MORE_BTN = (r: number) => `tblSAPLSE16NSELFIELDS_TC/btnPUSH[4,${r}]`
const MARK = (r: number) => `tblSAPLSE16NSELFIELDS_TC/chkGS_SELFIELDS-MARK[5,${r}]`
const FIELDNAME = (r: number) => `tblSAPLSE16NSELFIELDS_TC/txtGS_SELFIELDS-FIELDNAME[6,${r}]`

/** Multiple-selection popup (SAPLSE16N1) — one grid row per (option, from, to). */
const M_OPTION = (r: number) => `tblSAPLSE16NMULTI_TC/btnOPTION[0,${r}]`
const M_LOW = (r: number) => `tblSAPLSE16NMULTI_TC/ctxtGS_MULTI_SELECT-LOW[1,${r}]`
const M_HIGH = (r: number) => `tblSAPLSE16NMULTI_TC/ctxtGS_MULTI_SELECT-HIGH[2,${r}]`

/** Header fields. */
const TABLE_FIELD = "ctxtGD-TAB"
const LAYOUT_FIELD = "ctxtGD-VARIANT"
const MAXHITS_FIELD = "txtGD-MAX_LINES"
const GET_FIELD = "ctxtGD_ADD_COLUMN"
const HITS_FIELD = "txtGD-NUMBER"
const RUNTIME_FIELD = "txtGD-RUNTIME"

/** Icon shown by a row's option button when no option was ever chosen. */
const OPTION_UNSET_ICON = "s_b_selc"
/** "More" button icon once the multiple-selection popup holds values. */
const MORE_FILLED_ICON = "s_bgmore"

/**
 * Popup label + verification icon for every one of SE16N's 20 options.
 *
 * The label picks the row (English, which the toolchain already requires); the icon proves
 * it landed. `s_bg*` = green = include, `s_br*` = red = exclude — so a reordered or
 * mistranslated popup is caught rather than silently applying the wrong operator.
 */
const OPTIONS: Record<string, { label: string; icon: string }> = {
  "I:BT": { label: "Select: Include range", icon: "s_bgivin" },
  "I:CP": { label: "Select: Include pattern", icon: "s_bgpatt" },
  "I:NP": { label: "Select: Exclude pattern", icon: "s_bgnpat" },
  "I:EQ": { label: "Select: Equal to", icon: "s_bgequa" },
  "I:NB": { label: "Select: Exclude range", icon: "s_bgivex" },
  "I:NE": { label: "Select: Not equal to", icon: "s_bgnequ" },
  "I:GT": { label: "Select: Greater than", icon: "s_bggrea" },
  "I:LT": { label: "Select: Less than", icon: "s_bgless" },
  "I:GE": { label: "Select: Greater than/equal to", icon: "s_bggreq" },
  "I:LE": { label: "Select: Less than/equal to", icon: "s_bgleeq" },
  "E:BT": { label: "Do not select: Include range", icon: "s_brivin" },
  "E:CP": { label: "Do not select: Include pattern", icon: "s_brpatt" },
  "E:NP": { label: "Do not select: Exclude pattern", icon: "s_brnpat" },
  "E:EQ": { label: "Do not select: Equal to", icon: "s_brequa" },
  "E:NB": { label: "Do not select: Exclude range", icon: "s_brivex" },
  "E:NE": { label: "Do not select: Not equal to", icon: "s_brnequ" },
  "E:GT": { label: "Do not select: Greater than", icon: "s_brgrea" },
  "E:LT": { label: "Do not select: Less than", icon: "s_brless" },
  "E:GE": { label: "Do not select: Greater/equal", icon: "s_brgreq" },
  "E:LE": { label: "Do not select: Less than/equal", icon: "s_brleeq" }
}

/** Above this many single values, the clipboard upload beats one round trip per row. */
const CLIPBOARD_THRESHOLD = 5

/**
 * How long execute() will keep polling for a terminal state (result screen / recognised
 * message) before giving up. A query against a huge table with unselective criteria can
 * legitimately run for minutes — this is deliberately generous rather than tuned to "normal"
 * cases. The caller's own Playwright test timeout (via test.setTimeout for long-running
 * cases) is the real backstop if SAP is genuinely stuck rather than just slow.
 */
const EXECUTE_MAX_WAIT_MS = 10 * 60 * 1000
const EXECUTE_POLL_INTERVAL_MS = 250

type RowState = {
  field: string
  low: string
  high: string
  marked: boolean
  optionIcon: string
  moreIcon: string
}

// ---------------------------------------------------------------------------

export async function runSe16n(sap: SapSession, spec: Se16nSpec): Promise<Se16nResult> {
  const driver = new Se16nDriver(sap, spec)
  return driver.run()
}

class Se16nDriver {
  private page: Page
  private scope!: Page | Frame
  /** field -> absolute row, populated once by placeFields(). See resolvedRow(). */
  private fieldRow = new Map<string, number>()

  constructor(
    private sap: SapSession,
    private spec: Se16nSpec
  ) {
    this.page = sap.raw()
  }

  async run(): Promise<Se16nResult> {
    const { table, outputFields } = this.spec
    if (outputFields !== "*" && !outputFields.length) {
      throw new Error(`se16n: outputFields must not be empty (pass "*" for every field).`)
    }
    const expected = this.spec.expect
    if (
      expected?.empty === true &&
      ((expected.exactRows !== undefined && expected.exactRows !== 0) ||
        (expected.minRows !== undefined && expected.minRows > 0))
    ) {
      throw new Error(`se16n: expect.empty cannot be combined with a positive row expectation.`)
    }

    // Re-entering the transaction by URL starts a fresh ITS session, which is what actually
    // clears SE16N's remembered field order and criteria — verified: a dirtied MARA screen
    // came back in plain DDIC order afterwards. The table name itself is persisted per user
    // in the database and survives, so it is always set explicitly below.
    await this.sap.openTx("SE16N", { captureEvidence: false })
    this.scope = await this.sap.contentScope()

    // A session that just executed a query (a prior se16n() call in the same test) can
    // leave SAP on something other than a fresh selection screen — this is what turned
    // into a silent hang instead of a clear error. Confirm the table-name input actually
    // exists before touching anything.
    const onSelectionScreen = await this.loc(`input[lsdata*="${TABLE_FIELD}"]`)
      .count()
      .catch(() => 0)
    if (!onSelectionScreen) {
      throw new Error(
        `se16n: SE16N did not return to its selection screen for ${table} — the table-name ` +
          `input is not present. If a previous se16n() call in this session just executed a ` +
          `query, SAP may have left the result list open instead of a fresh selection screen.`
      )
    }

    await this.openTable()
    await this.reset()
    await this.placeFields()
    await this.setOutputColumns()
    const criteria = [...(this.spec.where ?? [])].sort(
      (a, b) =>
        (this.fieldRow.get(a.field.toUpperCase()) ?? Number.MAX_SAFE_INTEGER) -
        (this.fieldRow.get(b.field.toUpperCase()) ?? Number.MAX_SAFE_INTEGER)
    )
    for (const c of criteria) await this.applyCriterion(c)
    if (this.spec.maxHits !== undefined) {
      await this.setHeaderField(MAXHITS_FIELD, String(this.spec.maxHits))
    }

    if (this.spec.evidence?.criteria !== false) {
      await this.sap.note(`SE16N ${table}: selection criteria`)
    }
    return this.execute()
  }

  // ---------- phase 1: table + reset ----------

  private async openTable(): Promise<void> {
    await this.setHeaderField(TABLE_FIELD, this.spec.table)

    // SAP's header text field echoes back whatever was typed regardless of validity, so a
    // matching displayed value is NOT proof the table was accepted — verified live: typing a
    // nonexistent table still shows it in the field while SAP raises an ERROR-severity status
    // message ("XYZ does not exist; check the name") and leaves the OLD table's field grid
    // in place underneath. The message check is the one that actually catches this.
    const shown = await this.headerValue(TABLE_FIELD)
    const { isError, text: message } = await this.messageInfo()
    if (shown.toUpperCase() !== this.spec.table.toUpperCase() || isError) {
      throw new Error(
        `se16n: table "${this.spec.table}" did not stick — SE16N shows "${shown}". ` +
          `The table/view probably does not exist in this client, or the user lacks ` +
          `authorisation for it (S_TABU_DIS / S_TABU_NAM).${message ? ` SAP says: "${message}".` : ""}`
      )
    }
    await this.assertNoStrayLayout()
    // The technical-name column is the safety anchor for every write below.
    const names = await this.readRows()
    if (!Object.values(names).some(r => r.field)) {
      throw new Error(
        `se16n: the "Technical Name" column is not rendered on the SE16N selection screen, ` +
          `so field placement cannot be verified and driving it would be unsafe. Open SE16N, ` +
          `press Ctrl+F12 (Change Settings) and make sure the technical name column is shown, ` +
          `then re-run.`
      )
    }
  }

  /**
   * A display variant wins over the output ticks: once one is attached to the table, SE16N
   * renders ITS columns no matter which fields were selected — and clearing the Layout
   * field on the selection screen does not detach it. Silently producing a screenshot with
   * the wrong columns is exactly the kind of quietly-wrong evidence this helper exists to
   * prevent, so an unrequested layout is a hard stop rather than a warning.
   */
  private async assertNoStrayLayout(): Promise<void> {
    if (this.spec.layout) {
      await this.setHeaderField(LAYOUT_FIELD, this.spec.layout)
      // Unlike the table-name field, an unconfirmed layout write used to be trusted blindly
      // — an invalid/unrecognised layout name left SE16N on some OTHER real variant instead
      // of rejecting it, which then made a LATER call's reset() fail against a leftover
      // field/criteria state (see TC-015a). Verify it stuck, the same way openTable() does
      // for the table name.
      const shown = (await this.headerValue(LAYOUT_FIELD)).trim()
      const { isError, text: message } = await this.messageInfo()
      if (shown.toUpperCase() !== this.spec.layout.toUpperCase() || isError) {
        throw new Error(
          `se16n: layout "${this.spec.layout}" did not stick for ${this.spec.table} — SE16N ` +
            `shows "${shown || "(blank)"}". The layout/variant name probably doesn't exist for ` +
            `this table, or the user lacks authorisation for it.` +
            (message ? ` SAP says: "${message}".` : "")
        )
      }
      return
    }
    const layout = (await this.headerValue(LAYOUT_FIELD)).trim()
    if (!layout) return
    throw new Error(
      `se16n: ${this.spec.table} has display variant "${layout}" applied. A variant decides ` +
        `the output columns itself and overrides the fields requested here, and blanking the ` +
        `Layout field does not detach it — so the screenshot would not show what this test ` +
        `asked for. Remove the default variant for ${this.spec.table} (SE16N → execute → ` +
        `Manage Layouts → uncheck "default setting"), or pass layout: "${layout}" to accept ` +
        `the variant's columns deliberately.`
    )
  }

  /**
   * SE16N remembers field order, criteria and output ticks PER USER between runs — a
   * previous run (or a human using the same account) leaks straight into this one. Order
   * matters: undo the field sorting first, then clear values, then clear the output ticks.
   */
  private async reset(): Promise<void> {
    await this.pressToolbar("Delete Sorting of Selection Fields")
    await this.pressToolbar("Delete All Entries")
    await this.pressToolbar("Deselect All")

    if (Object.values(await this.readRows()).some(row => row.marked)) {
      await this.focusGrid()
      await this.page.keyboard.press("Shift+F6")
      await this.sap.settle("Deselect All")
    }

    await this.scrollToTop()
    const rows = await this.readRows()
    const dirty = Object.entries(rows).filter(
      ([, r]) => r.low || r.high || r.marked || (r.optionIcon && r.optionIcon !== OPTION_UNSET_ICON)
    )
    if (dirty.length) {
      throw new Error(
        `se16n: reset did not clear the selection screen — rows still dirty: ` +
          dirty.map(([i, r]) => `${r.field || `#${i}`}`).join(", ") +
          `. Something is holding state (an open popup, or a SE16N variant loaded via the ` +
          `Layout field). Close SE16N and retry.`
      )
    }
  }

  // ---------- phase 2: field placement ----------

  /** Output fields first for predictable placement, then criteria-only fields. */
  private wantedFields(): string[] {
    const out: string[] = []
    const requested = this.spec.outputFields === "*" ? [] : this.spec.outputFields
    for (const f of [...requested, ...(this.spec.where ?? []).map(c => c.field)]) {
      const u = f.toUpperCase()
      if (u === "MANDT")
        throw new Error(
          `se16n: MANDT cannot be selected or filtered in SE16N — it is fixed to the logon ` +
            `client. Remove it from outputFields/where.`
        )
      if (!out.includes(u)) out.push(u)
    }
    return out
  }

  private async placeFields(): Promise<void> {
    const wanted = this.wantedFields()
    if (!wanted.length) return
    for (const field of wanted) {
      await this.scrollToTop() // Get Field only searches forward from the window top.
      await this.setHeaderField(GET_FIELD, field)
    }

    // Get Field moves most requested fields into a top block, but valid fields can remain
    // elsewhere (verified live: TC-002 left MATNR at absolute row 20 and GEWEI at row 34).
    // Scan the grid ONCE by name, stopping as soon as all requested fields are found.
    // This is order-independent without the N full-grid searches that caused the earlier
    // timeout regression; an invalid field costs one complete scan, not one per field.
    this.fieldRow = await this.scanFields(wanted)
    const missing = wanted.filter(f => !this.fieldRow.has(f))
    if (missing.length) {
      throw new Error(
        `se16n: field placement failed for ${this.spec.table}: ${missing.join(", ")} ` +
          `${missing.length === 1 ? "is" : "are"} missing from the selection grid after ` +
          `requesting ${wanted.join(", ")}. SE16N silently ignores a field name it does not ` +
          `recognise, so ${missing.length === 1 ? "it is" : "they are"} most likely not ` +
          `${missing.length === 1 ? "a field" : "fields"} of ${this.spec.table} (check the ` +
          `spelling against DD03L).${await this.messageSuffix()}`
      )
    }
  }

  /**
   * Absolute row for a field placed by placeFields(). A field's absolute row never
   * changes once placed, but which WINDOW-RELATIVE row it renders at does (that mapping
   * only holds while the grid is scrolled so the row is visible) — so this doesn't just
   * return a cached number, it pages the grid to bring that absolute row into view and
   * returns its current relative row, ready to use immediately in MARK/LOW/HIGH/etc.
   * Callers may supply fields in any order; setOutputColumns() and the criteria phase sort
   * them by this map before interacting, so normal operation pages forward rather than
   * jumping around the grid.
   */
  private async resolvedRow(field: string): Promise<number> {
    const absolute = this.fieldRow.get(field)
    if (absolute === undefined) {
      throw new Error(
        `se16n: internal error — "${field}" was used before placeFields() placed it. This ` +
          `indicates a bug in wantedFields()/placeFields(), not a data problem.`
      )
    }
    return this.pageToAbsoluteRow(absolute)
  }

  /**
   * Page the selection grid until `absoluteRow` is visible, returning its current
   * window-relative row. Rewinds first if we've scrolled past it — pageDown() only goes
   * forward.
   */
  private async pageToAbsoluteRow(absoluteRow: number): Promise<number> {
    if ((await this.scrollPos()).top > absoluteRow) await this.scrollToTop()
    for (;;) {
      const { top } = await this.scrollPos()
      if (top > absoluteRow) {
        if (!(await this.lineUp())) break
        continue
      }
      const relative = absoluteRow - top + 1
      if (relative >= 1 && (await this.readRows())[relative]) return relative
      if (!(await this.pageDown())) break
    }
    throw new Error(
      `se16n: internal error — could not page the selection grid to absolute row ` +
        `${absoluteRow} for ${this.spec.table}.`
    )
  }

  // ---------- phase 3: output columns ----------

  private async setOutputColumns(): Promise<void> {
    if (this.spec.outputFields === "*") {
      await this.pressToolbar("Select All")
      const rows = await this.readRows()
      const unticked = Object.values(rows).filter(r => r.field && r.field !== "MANDT" && !r.marked)
      if (unticked.length) {
        throw new Error(
          `se16n: "Select All" did not tick every output column (e.g. ` +
            `${unticked[0].field}).${await this.messageSuffix()}`
        )
      }
      return
    }

    const wanted = this.spec.outputFields
      .map(f => f.toUpperCase())
      .sort(
        (a, b) =>
          (this.fieldRow.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (this.fieldRow.get(b) ?? Number.MAX_SAFE_INTEGER)
      )
    const missing: string[] = []
    for (const field of wanted) {
      const row = await this.resolvedRow(field)
      if (!(await this.readRows())[row]?.marked) {
        await this.click(MARK(row), `tick output column ${field}`)
      }
      if (!(await this.readRows())[row]?.marked) missing.push(field)
    }
    if (missing.length) {
      throw new Error(
        `se16n: output columns not ticked for ${missing.join(", ")} — the report would come ` +
          `back without them.${await this.messageSuffix()}`
      )
    }
  }

  // ---------- phase 4: criteria ----------

  private async applyCriterion(c: Se16nCriterion): Promise<void> {
    const field = c.field.toUpperCase()
    if (c.values?.length) {
      await this.applyMultiple(field, c.values)
      return
    }
    if (c.low === undefined) {
      throw new Error(`se16n: criterion for ${field} has neither "low" nor "values".`)
    }
    if (c.high !== undefined && c.high !== "" && !this.isRangeOption(c)) {
      throw new Error(
        `se16n: criterion for ${field} supplies a "high" value but option ` +
          `"${c.option ?? "EQ"}" is not a range option (BT/NB) — SE16N has no To-value cell ` +
          `for it. Remove "high", or use option: "BT"/"NB".`
      )
    }
    const row = await this.resolvedRow(field)
    await this.setOption(row, field, c)
    await this.setCell(LOW(row), c.low, `${field} from-value`)
    if (c.high !== undefined && c.high !== "") {
      await this.setCell(HIGH(row), c.high, `${field} to-value`)
    }
    await this.commit(`criterion ${field}`)

    const row2 = await this.resolvedRow(field)
    const state = (await this.readRows())[row2]
    if (
      !this.valuesMatch(c.low, state.low) ||
      (c.high ? !this.valuesMatch(c.high, state.high) : false)
    ) {
      throw new Error(
        `se16n: criterion for ${field} did not stick. Wrote low="${c.low}"` +
          (c.high ? `, high="${c.high}"` : "") +
          ` but the screen shows low="${state.low}", high="${state.high}".` +
          (await this.messageSuffix())
      )
    }
  }

  /**
   * BT/NB are the only options with a To-value cell; every other option has none —
   * supplying `high` alongside one used to crash with a raw "cell not found" instead of a
   * clear, actionable error.
   */
  private isRangeOption(v: Se16nValue): boolean {
    const option = v.option ?? (v.high ? "BT" : "EQ")
    return option === "BT" || option === "NB"
  }

  /**
   * Tolerant equality for a written-vs-echoed criterion value. SAP reformats numeric
   * (QUAN/DEC) fields on echo — e.g. "0" comes back as "            0.000" — so a strict
   * string comparison used to false-positive "did not stick" on a criterion that actually
   * worked. Text fields (MATNR, MTART, ...) are never reformatted, so this only ever
   * changes the outcome for the numeric case.
   */
  private valuesMatch(written: string, echoed: string): boolean {
    const w = written.trim()
    const e = echoed.trim()
    if (w === e) return true
    if (w === "") return e === ""
    const writtenNumbers = this.numericValues(w)
    const echoedNumbers = this.numericValues(e)
    return writtenNumbers.some(value => echoedNumbers.includes(value))
  }

  /** Parse SAP numbers in either 1,234.56 or 1.234,56 notation. */
  private numericValues(value: string): number[] {
    if (!/^[+-]?[\d.,]+$/.test(value)) return []
    const comma = value.lastIndexOf(",")
    const dot = value.lastIndexOf(".")
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? "," : "."
      const grouping = decimal === "," ? /\./g : /,/g
      return [Number(value.replace(grouping, "").replace(decimal, "."))]
    }
    const separator = comma >= 0 ? "," : dot >= 0 ? "." : ""
    if (!separator) return [Number(value)]
    const parts = value.split(separator)
    if (parts.length > 2 && parts.slice(1).every(part => part.length === 3)) {
      return [Number(parts.join(""))]
    }
    const decimal = Number(parts.join("."))
    if (parts.length === 2 && parts[1].length === 3) {
      return [decimal, Number(parts.join(""))].filter(Number.isFinite)
    }
    return Number.isFinite(decimal) ? [decimal] : []
  }

  /**
   * SE16N's multiple-selection popup is a flat grid — one row per (option, from, to) — not
   * the four-tab standard dialog. For a long list of plain values the clipboard upload is
   * dramatically faster than a round trip per row; anything with mixed options or ranges
   * goes row by row.
   */
  private async applyMultiple(field: string, values: Se16nValue[]): Promise<void> {
    const row = await this.resolvedRow(field)
    await this.click(MORE_BTN(row), `open multiple selection for ${field}`)
    await this.waitModal(true)

    await this.pressToolbar("All Entries", 1) // clears the popup grid
    const uploadable =
      values.length > CLIPBOARD_THRESHOLD &&
      values.every(v => !v.high && (v.option ?? "EQ") === "EQ" && (v.sign ?? "I") === "I")

    if (uploadable) {
      await this.uploadValues(values.map(v => v.low))
    } else {
      for (let i = 0; i < values.length; i++) {
        const r = await this.multiRow(i)
        const v = values[i]
        if (v.high && !this.isRangeOption(v)) {
          throw new Error(
            `se16n: multiple-selection value ${i + 1} for ${field} supplies a "high" value ` +
              `but option "${v.option ?? "EQ"}" is not a range option (BT/NB) — SE16N has no ` +
              `To-value cell for it. Remove "high", or use option: "BT"/"NB".`
          )
        }
        await this.setPopupOption(r, field, v)
        await this.setCell(M_LOW(r), v.low, `${field} multiple value ${i + 1}`)
        if (v.high) await this.setCell(M_HIGH(r), v.high, `${field} multiple to-value ${i + 1}`)
      }
      await this.commit(`multiple selection for ${field}`)
    }

    const used = Number(await this.valueOf("txtGD_LINES_USED"))
    if (used !== values.length) {
      throw new Error(
        `se16n: multiple selection for ${field} holds ${used} criteria but ${values.length} ` +
          `were requested.${await this.messageSuffix()}`
      )
    }

    await this.pressToolbar("Transfer Data", 1)
    await this.waitModal(false)
    await this.sap.settle(`transfer multiple selection for ${field}`)

    const row2 = await this.resolvedRow(field)
    const after = (await this.readRows())[row2]
    if (after.moreIcon !== MORE_FILLED_ICON) {
      throw new Error(
        `se16n: multiple selection for ${field} was not transferred back to the selection ` +
          `screen (the "More" button still shows as empty).${await this.messageSuffix()}`
      )
    }
  }

  /**
   * Clipboard upload. WebGUI reads the real browser clipboard, guarded by its own
   * "SAP GUI for HTML Clipboard Access" dialog that wants a genuine Ctrl+V. The page is
   * served over http, so `navigator.clipboard` is unavailable — `execCommand("copy")` from
   * a throwaway textarea is what actually works here.
   */
  private async uploadValues(values: string[]): Promise<void> {
    const text = values.join("\n")
    const copied = await this.scope.evaluate((t: string) => {
      const ta = document.createElement("textarea")
      ta.value = t
      ta.style.position = "fixed"
      ta.style.opacity = "0"
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      let ok = false
      try {
        ok = document.execCommand("copy")
      } catch {
        ok = false
      }
      ta.remove()
      return ok
    }, text)
    if (!copied) {
      throw new Error(
        `se16n: could not place ${values.length} values on the clipboard, so SE16N's ` +
          `"Upload from Clipboard" cannot be used. Pass fewer than ${CLIPBOARD_THRESHOLD + 1} ` +
          `values, or give each value an explicit option so the row-by-row path is taken.`
      )
    }

    await this.pressToolbar("Upload from Clipboard", 1)
    let opened = false
    for (let i = 0; i < 60; i++) {
      if (await this.clipboardPromptOpen()) {
        opened = true
        break
      }
      await this.page.waitForTimeout(250)
    }
    if (!opened) {
      throw new Error(
        `se16n: SAP's "Clipboard Access" confirmation did not appear after "Upload from ` +
          `Clipboard" — the toolbar action may not have registered.${await this.messageSuffix()}`
      )
    }
    await this.page.keyboard.press("Control+V")
    for (let i = 0; i < 60; i++) {
      if (!(await this.clipboardPromptOpen())) {
        await this.sap.settle("clipboard upload")
        return
      }
      await this.page.waitForTimeout(250)
    }
    // Falling through here would leave SAP's own dialog open while every later action
    // burns ~10s in settle()'s DOM-stability wait against it, surfacing 50+ seconds later
    // as an opaque Playwright test timeout instead of this actionable cause. execCommand
    // ("copy") frequently doesn't seed the real OS clipboard in a headless/automated
    // browser, which is the most likely reason SAP never sees a valid paste.
    throw new Error(
      `se16n: SAP's "Clipboard Access" dialog did not close after Control+V — SAP never ` +
        `registered a paste of the ${values.length} clipboard value(s). This commonly means ` +
        `document.execCommand("copy") did not actually populate the OS clipboard in this ` +
        `browser context. Give each value an explicit option so the row-by-row path is taken ` +
        `instead of the clipboard upload.${await this.messageSuffix()}`
    )
  }

  private clipboardPromptOpen(): Promise<boolean> {
    return this.scope
      .evaluate(() =>
        Array.from(document.querySelectorAll('[role="dialog"]')).some(d =>
          /Clipboard Access/i.test(d.textContent ?? "")
        )
      )
      .catch(() => false)
  }

  /** Skip the popup entirely when SAP's own default already means what the caller asked. */
  private isDefaultOption(v: Se16nValue): boolean {
    const sign = v.sign ?? "I"
    const option = v.option ?? (v.high ? "BT" : "EQ")
    return sign === "I" && ((option === "EQ" && !v.high) || (option === "BT" && !!v.high))
  }

  private optionKey(v: Se16nValue): string {
    const sign = v.sign ?? "I"
    const option = v.option ?? (v.high ? "BT" : "EQ")
    const key = `${sign}:${option}`
    if (!OPTIONS[key])
      throw new Error(
        `se16n: unsupported option "${key}". Supported: ${Object.keys(OPTIONS).join(", ")}.`
      )
    return key
  }

  private async setOption(row: number, field: string, v: Se16nValue): Promise<void> {
    if (this.isDefaultOption(v)) {
      // SE16N applies EQ for a lone from-value and BT for a from/to pair without any
      // explicit selection, so leaving the row untouched is both correct and one round
      // trip cheaper. Verified against MARA: 24 rows total, ERSDA 01.01.2000–31.12.2099
      // returned all 24, MTART "ROH" alone returned 9.
      const icon = (await this.readRows())[row]?.optionIcon
      if (icon && icon !== OPTION_UNSET_ICON) {
        throw new Error(
          `se16n: row for ${field} carries a leftover option (icon "${icon}") but the ` +
            `criterion relies on SE16N's default. Reset did not clean the screen.`
        )
      }
      return
    }
    await this.pickOption(OPTION_BTN(row), this.optionKey(v), field)
  }

  private async setPopupOption(row: number, field: string, v: Se16nValue): Promise<void> {
    if (this.isDefaultOption(v)) return
    await this.pickOption(M_OPTION(row), this.optionKey(v), field)
  }

  /**
   * Open the option picker and choose a row by its unique text, then prove it took by the
   * icon. The picker's container id is regenerated on every open, so it is matched by
   * cell text only. Selection is a double-click; the popup closes itself.
   */
  private async pickOption(buttonSid: string, key: string, field: string): Promise<void> {
    const { label, icon } = OPTIONS[key]
    await this.click(buttonSid, `open option picker for ${field}`)
    await this.waitModal(true)
    const cell = this.loc('td[id^="grid#"]').filter({
      hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`)
    })
    if (!(await cell.count())) {
      throw new Error(
        `se16n: option "${label}" is not offered by SE16N's option picker for ${field}. ` +
          `That option may not apply to this field's data type.`
      )
    }
    await cell
      .first()
      .evaluate(element =>
        element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }))
      )
    // NOT waitModal(false): when this picker is opened from inside the multi-selection
    // popup (setPopupOption), the shared #urPopupWindowBlockLayer stays visible because the
    // PARENT popup is still open — waiting for it to disappear here hangs forever. The
    // picker's own row list disappearing is the correct, parent-agnostic completion signal.
    for (let i = 0; i < 80; i++) {
      if (!(await cell.count())) break
      await this.page.waitForTimeout(250)
    }
    if (await cell.count()) {
      throw new Error(
        `se16n: option picker for ${field} did not close after selecting "${label}".` +
          `${await this.messageSuffix()}`
      )
    }
    await this.sap.settle(`choose option ${key} for ${field}`)

    const got = await this.iconOf(buttonSid)
    if (got !== icon) {
      throw new Error(
        `se16n: option ${key} ("${label}") for ${field} did not apply — expected icon ` +
          `"${icon}" but the button shows "${got}". The picker row order or labels differ ` +
          `on this system; do NOT proceed, the wrong operator would be used silently.`
      )
    }
  }

  // ---------- phase 5: execute + read result ----------

  private async execute(): Promise<Se16nResult> {
    await this.pressToolbar("Online")
    await this.sap.settle("execute SE16N")

    // settle()'s DOM-quiet wait can elapse while SAP is still mid-flight: "Data Selection" is
    // a transient progress-indicator pushed over an async channel (not a normal page load), so
    // the DOM can go quiet with that text showing before the real terminal state (result screen,
    // "No values found", or a genuine error) arrives. Poll for an actual terminal condition
    // instead of trusting the very first post-settle read. A blank message is NOT treated as
    // terminal by itself — it could just as easily mean "not finished yet" as "done with
    // nothing to report", and wrongly trusting it risks reading zero/stale hits mid-flight.
    let title = await this.page.title()
    let message = (await this.messageInfo()).text
    let onResult = /Display of Entries Found/i.test(title)
    let sawProgress = /data selection/i.test(message)
    let blankSince = 0
    const expectedEmptyComplete = () =>
      this.spec.expect?.empty === true &&
      sawProgress &&
      blankSince > 0 &&
      Date.now() - blankSince >= 1_000
    const isTerminal = () =>
      onResult || /no values found|no data/i.test(message) || expectedEmptyComplete()
    const deadline = Date.now() + EXECUTE_MAX_WAIT_MS
    while (!isTerminal() && Date.now() < deadline) {
      await this.page.waitForTimeout(EXECUTE_POLL_INTERVAL_MS)
      title = await this.page.title()
      message = (await this.messageInfo()).text
      onResult = /Display of Entries Found/i.test(title)
      if (/data selection/i.test(message)) sawProgress = true
      blankSince = !message ? blankSince || Date.now() : 0
    }

    if (!onResult) {
      // SE16N stays on the selection screen for an empty result ("No values found") and
      // for input errors. Both are legitimate outcomes to report, but only the first is
      // a result — anything else must not be mistaken for "zero rows". Note: SAP marks
      // "No values found" itself with messageType/aria-label "Error" severity styling, so
      // isError from messageInfo() is NOT a usable disqualifier here (unlike in openTable(),
      // where the header echoes back an invalid value regardless of validity) — the message
      // TEXT is the only reliable signal that this is a legitimate zero-row outcome.
      if (!/no values found|no data/i.test(message) && !expectedEmptyComplete()) {
        throw new Error(
          `se16n: execution did not reach the result list for ${this.spec.table}. ` +
            `Screen title is still "${title}".${message ? ` SAP says: "${message}".` : ""}`
        )
      }
      const empty: Se16nResult = {
        table: this.spec.table,
        hits: 0,
        runtime: "0",
        fields: [],
        columns: [],
        rows: [],
        partial: false,
        message
      }
      if (this.spec.evidence?.output !== false) {
        await this.sap.note(`SE16N ${this.spec.table}: no entries found`)
      }
      this.assertExpectations(empty)
      return empty
    }

    const hits = Number((await this.valueOf(HITS_FIELD)) || "0")
    const runtime = (await this.valueOf(RUNTIME_FIELD)) || "0"
    const { fields, columns, rows } = await this.readResultGrid()
    this.assertOutputFields(fields)
    const result: Se16nResult = {
      table: this.spec.table,
      hits,
      runtime,
      fields,
      columns,
      rows,
      partial: rows.length < hits,
      message
    }
    if (this.spec.evidence?.output !== false) {
      await this.sap.note(`SE16N ${this.spec.table}: ${hits} entries`)
    }
    this.assertExpectations(result)
    return result
  }

  private assertExpectations(r: Se16nResult): void {
    const e = this.spec.expect
    if (!e) return
    const fail = (what: string) => {
      throw new Error(
        `se16n: ${this.spec.table} returned ${r.hits} entries, expected ${what}.` +
          (r.message ? ` SAP says: "${r.message}".` : "")
      )
    }
    if (e.exactRows !== undefined && r.hits !== e.exactRows) fail(`exactly ${e.exactRows}`)
    if (e.minRows !== undefined && r.hits < e.minRows) fail(`at least ${e.minRows}`)
    if (e.maxRows !== undefined && r.hits > e.maxRows) fail(`at most ${e.maxRows}`)
    if (e.empty === true && r.hits !== 0) fail("no entries")
  }

  private assertOutputFields(fields: string[]): void {
    if (this.spec.outputFields === "*") return
    const actual = new Set(fields.map(field => field.toUpperCase()))
    const missing = this.spec.outputFields.filter(field => !actual.has(field.toUpperCase()))
    if (missing.length) {
      throw new Error(
        `se16n: result is missing requested output fields ${missing.join(", ")}. ` +
          `Actual technical fields: ${fields.join(", ") || "(none)"}.`
      )
    }
  }

  /**
   * Read the ALV. Cells are `grid#C<nnn>#<row>,<col>`; row 0 holds the headers and column 0
   * is the row-selector, so data starts at [1,1]. `C<nnn>` is regenerated per render and is
   * never hardcoded — it is derived from whatever the grid currently is.
   */
  private readResultGrid(): Promise<{ fields: string[]; columns: string[]; rows: string[][] }> {
    return this.scope.evaluate(() => {
      const cell = /^grid#[^#]+#(\d+),(\d+)$/
      const grid: Record<number, Record<number, string>> = {}
      const technicalFields: Record<number, string> = {}
      let maxCol = 0
      document.querySelectorAll("[id]").forEach(el => {
        const m = el.id.match(cell)
        if (!m) return
        if (el.tagName !== "TD" && el.tagName !== "TH") return
        const r = Number(m[1])
        const c = Number(m[2])
        if (c === 0) return // row-selector column
        grid[r] = grid[r] ?? {}
        // Header cells repeat the caption at several widths; the shortest full word wins.
        const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").trim()
        grid[r][c] = r === 0 ? text.split("\n")[0].trim() : text
        if (r === 0) {
          const raw = el.getAttribute("lsdata") ?? ""
          const sid = (raw.match(/"SID":"[^"]*\/col([^"]+)"/) ?? [])[1]
          if (sid) technicalFields[c] = sid
        }
        if (c > maxCol) maxCol = c
      })
      const fields: string[] = []
      const cols: string[] = []
      for (let c = 1; c <= maxCol; c++) {
        fields.push(technicalFields[c] ?? "")
        cols.push(grid[0]?.[c] ?? "")
      }
      const rows: string[][] = []
      Object.keys(grid)
        .map(Number)
        .filter(r => r > 0)
        .sort((a, b) => a - b)
        .forEach(r => {
          const line: string[] = []
          for (let c = 1; c <= maxCol; c++) line.push(grid[r][c] ?? "")
          rows.push(line)
        })
      return { fields, columns: cols, rows }
    })
  }

  // ---------- grid primitives ----------

  /** Find requested fields in one forward pass; stop early once every name is found. */
  private async scanFields(fields: string[]): Promise<Map<string, number>> {
    const wanted = new Set(fields)
    const found = new Map<string, number>()
    await this.scrollToTop()
    for (;;) {
      const top = (await this.scrollPos()).top
      for (const [visible, state] of Object.entries(await this.readRows())) {
        const absolute = top - 1 + Number(visible)
        if (wanted.has(state.field)) found.set(state.field, absolute)
      }
      if (found.size >= wanted.size) break
      if (!(await this.pageDown())) break
    }
    return found
  }

  /** All controls of the currently visible window, keyed by visible row index. */
  private readRows(): Promise<Record<number, RowState>> {
    return this.scope.evaluate(() => {
      const out: Record<number, any> = {}
      document.querySelectorAll("[lsdata]").forEach(el => {
        if (el.tagName === "TD") return
        const raw = el.getAttribute("lsdata") ?? ""
        if (
          raw.indexOf("SELFIELDS") < 0 &&
          raw.indexOf("btnOPTION") < 0 &&
          raw.indexOf("btnPUSH") < 0
        )
          return
        const m = raw
          .replace(/\\/g, "")
          .match(
            /tblSAPLSE16NSELFIELDS_TC\/(txtGS_SELFIELDS-FIELDNAME|ctxtGS_SELFIELDS-LOW|ctxtGS_SELFIELDS-HIGH|chkGS_SELFIELDS-MARK|btnOPTION|btnPUSH)\[\d+,(\d+)\]/
          )
        if (!m) return
        const row = Number(m[2])
        out[row] = out[row] ?? {
          field: "",
          low: "",
          high: "",
          marked: false,
          optionIcon: "",
          moreIcon: ""
        }
        const icon = (raw.match(/icons\.svg#(\w+)/) ?? [])[1] ?? ""
        const text = (el as HTMLInputElement).value ?? (el.textContent ?? "").trim()
        switch (m[1]) {
          case "txtGS_SELFIELDS-FIELDNAME":
            out[row].field = (el.textContent ?? "").trim()
            break
          case "ctxtGS_SELFIELDS-LOW":
            out[row].low = text
            break
          case "ctxtGS_SELFIELDS-HIGH":
            out[row].high = text
            break
          case "chkGS_SELFIELDS-MARK":
            out[row].marked = el.getAttribute("aria-checked") === "true"
            break
          case "btnOPTION":
            out[row].optionIcon = icon
            break
          case "btnPUSH":
            out[row].moreIcon = icon
            break
        }
      })
      return out
    })
  }

  private scrollPos(windowIndex = 0): Promise<{ top: number; total: number }> {
    return this.scope
      .evaluate((win: number) => {
        const sb = document.querySelector(`[ct="SCB"][id^="M${win}:"][id$="_vscroll"]`)
        if (!sb) return { top: 1, total: 1 }
        const d = JSON.parse(sb.getAttribute("lsdata") ?? "{}")
        return { top: Number(d["0"] ?? 1), total: Number(d["10"] ?? 1) }
      }, windowIndex)
      .catch(() => ({ top: 1, total: 1 }))
  }

  /** Ctrl+Home inside the table control. Mandatory before every Get Field. */
  private async scrollToTop(): Promise<void> {
    if ((await this.scrollPos()).top === 1) return
    await this.focusGrid()
    await this.page.keyboard.press("Control+Home")
    await this.sap.settle("scroll selection grid to top")
    const top = (await this.scrollPos()).top
    if (top !== 1) {
      throw new Error(`se16n: could not scroll the selection grid back to the top (at row ${top}).`)
    }
  }

  /**
   * One page down. Returns false once the grid stops moving, which is the only reliable
   * end-of-list signal: the scrollbar reports table-control capacity (trailing blank rows
   * included), not the field count — T001D advertised 21 rows for 5 fields.
   */
  private async pageDown(windowIndex = 0): Promise<boolean> {
    const before = (await this.scrollPos(windowIndex)).top
    if (windowIndex === 0) await this.focusGrid()
    else await this.focusMultiGrid()
    await this.page.keyboard.press("PageDown")
    await this.sap.settle("page selection grid")
    return (await this.scrollPos(windowIndex)).top !== before
  }

  /** Move the main selection grid up one row when PageDown skips over a boundary row. */
  private async lineUp(): Promise<boolean> {
    const before = (await this.scrollPos()).top
    const button = this.loc(`[ct="SCB"][id^="M0:"][id$="_vscroll"] [id$="_vscroll-Prev"]`).last()
    if (!(await button.count())) return false
    await button.evaluate(element => (element as HTMLElement).click())
    await this.sap.settle("move selection grid up one row")
    return (await this.scrollPos()).top !== before
  }

  /**
   * Visible row for the nth value in the multiple-selection popup, paging when the popup's
   * window fills up. The popup's scrollbar reports no page size at all, so the window
   * boundary is found by asking whether the row's control actually exists rather than by
   * arithmetic on a row count that was never published.
   */
  private async multiRow(index: number): Promise<number> {
    let expanded = false
    for (;;) {
      const top = (await this.scrollPos(1)).top
      if (top > index + 1) {
        await this.scrollMultiToTop()
        continue
      }
      const visible = index - (top - 1)
      if (visible >= 0 && (await this.sidLoc(M_LOW(visible)).count())) return visible
      if (!(await this.pageDown(1))) {
        if (!expanded) {
          await this.commit("extend multiple-selection grid")
          expanded = true
          continue
        }
        throw new Error(
          `se16n: the multiple-selection popup has no room for value ${index + 1} after ` +
            `committing the current batch.${await this.messageSuffix()}`
        )
      }
    }
  }

  /** The popup retains its scroll position even after "All Entries" clears its rows. */
  private async scrollMultiToTop(): Promise<void> {
    await this.focusMultiGrid()
    await this.page.keyboard.press("Control+Home")
    await this.sap.settle("scroll multiple-selection grid to top")
    const top = (await this.scrollPos(1)).top
    if (top !== 1) {
      throw new Error(
        `se16n: could not scroll the multiple-selection grid back to the top (at row ${top}).`
      )
    }
  }

  /** Park focus on a read-only cell so keyboard shortcuts reach the table control. */
  private async focusGrid(): Promise<void> {
    await this.loc(`[lsdata*="${FIELDNAME(1)}"]:not(td)`)
      .last()
      .click()
      .catch(() => {})
  }

  private async focusMultiGrid(): Promise<void> {
    const editor = this.loc(`[lsdata*="${M_LOW(0)}"]:not(td)`).last()
    if (await editor.count()) {
      await editor.click()
      return
    }
    await this.loc(`[lsdata*="${M_LOW(0)}"]`)
      .last()
      .click()
  }

  // ---------- control primitives ----------

  private loc(selector: string) {
    return this.scope === this.page
      ? this.page.locator(selector)
      : (this.scope as Frame).locator(selector)
  }

  private sidLoc(sid: string) {
    return this.loc(`[lsdata*="${sid}"]:not(td)`).last()
  }

  private async click(sid: string, what: string): Promise<void> {
    const el = this.sidLoc(sid)
    if (!(await el.count())) {
      throw new Error(
        `se16n: control not found for "${what}" (${sid}).${await this.messageSuffix()}`
      )
    }
    await el.click()
    await this.sap.settle(what)
  }

  private async iconOf(sid: string): Promise<string> {
    const raw = (await this.sidLoc(sid).getAttribute("lsdata")) ?? ""
    return (raw.match(/icons\.svg#(\w+)/) ?? [])[1] ?? ""
  }

  private valueOf(sid: string): Promise<string> {
    return this.scope
      .evaluate((s: string) => {
        const el = Array.from(document.querySelectorAll("[lsdata]")).find(
          e => e.tagName !== "TD" && (e.getAttribute("lsdata") ?? "").includes(s)
        ) as HTMLInputElement | undefined
        if (!el) return ""
        return el.value ?? (el.textContent ?? "").trim()
      }, sid)
      .catch(() => "")
  }

  private headerValue(sid: string): Promise<string> {
    return this.valueOf(sid)
  }

  private async setHeaderField(sid: string, value: string): Promise<void> {
    const input = this.loc(`input[lsdata*="${sid}"]`)
    if (!(await input.count())) {
      throw new Error(`se16n: header field ${sid} is not on screen.${await this.messageSuffix()}`)
    }
    await input.fill(value)
    await input.press("Enter")
    await this.sap.settle(`set ${sid} = "${value}"`)
  }

  /**
   * Write into a table-control cell.
   *
   * A cell is a <span> until it is activated, and a single click does NOT reactivate one
   * that already holds focus — hence the click → dblclick escalation. `fill()` is avoided
   * deliberately: on an already-open ITS input it sets the DOM value without arming the
   * control's commit, and the value reverts on the next round trip. Typing does commit.
   */
  private async setCell(sid: string, value: string, what: string): Promise<void> {
    const target = this.sidLoc(sid)
    if (!(await target.count())) {
      throw new Error(`se16n: cell not found for ${what} (${sid}).${await this.messageSuffix()}`)
    }
    if (await this.cellReadonly(sid)) {
      throw new Error(
        `se16n: cannot write ${what} — SE16N has locked the selection screen because another ` +
          `field failed validation.${await this.messageSuffix()} Fix that value first (dates ` +
          `must use the SAP user's own display format).`
      )
    }

    for (const action of ["click", "dblclick", "dblclick"] as const) {
      await target[action]()
      for (let i = 0; i < 20; i++) {
        const input = this.loc(`input[lsdata*="${sid}"]`)
        if (await input.count()) {
          await input.click()
          await this.page.keyboard.press("Control+a")
          if (value === "") await this.page.keyboard.press("Delete")
          else await this.page.keyboard.type(value)
          return
        }
        await this.page.waitForTimeout(100)
      }
    }
    throw new Error(
      `se16n: cell for ${what} never became editable (${sid}).${await this.messageSuffix()}`
    )
  }

  private cellReadonly(sid: string): Promise<boolean> {
    return this.scope
      .evaluate((s: string) => {
        const el = Array.from(document.querySelectorAll("[lsdata]")).find(
          e => e.tagName !== "TD" && (e.getAttribute("lsdata") ?? "").includes(s)
        )
        return !!el && (el.hasAttribute("readonly") || el.getAttribute("aria-readonly") === "true")
      }, sid)
      .catch(() => false)
  }

  /** Enter = SAP's own "check my input" round trip. */
  private async commit(what: string): Promise<void> {
    await this.page.keyboard.press("Enter")
    await this.sap.settle(what)
  }

  // ---------- toolbar, popups, messages ----------

  /**
   * Press a toolbar function by its English title.
   *
   * Resolved by title rather than function code because a code can mean something else in
   * another GUI status (`wnd[1]/tbar[0]/btn[21]`, titled "Separator for From-To", opened a
   * File Upload dialog).
   *
   * Clicking is attempted first but is NOT trusted: SE16N's toolbar collapses buttons into
   * the `>>` overflow depending on window width, and a collapsed button refuses to click
   * even with `force: true` — and it can collapse between the visibility probe and the
   * click. Every SE16N toolbar function advertises its shortcut in its own title, and the
   * shortcut works whether or not the button is rendered, so that is the fallback.
   */
  private async pressToolbar(titlePrefix: string, windowIndex = 0): Promise<void> {
    const title = await this.scope.evaluate(
      ({ prefix, win }: { prefix: string; win: number }) => {
        for (const el of Array.from(document.querySelectorAll('[role="button"][title]'))) {
          const sid = ((el.getAttribute("lsdata") ?? "")
            .replace(/\\/g, "")
            .match(/"SID":"(wnd\[\d+\][^"]*)"/) ?? [])[1]
          if (!sid || !sid.startsWith(`wnd[${win}]/tbar`)) continue
          const t = (el as HTMLElement).title
          if (t.toLowerCase().startsWith(prefix.toLowerCase())) return t
        }
        return null
      },
      { prefix: titlePrefix, win: windowIndex }
    )
    if (!title) {
      throw new Error(
        `se16n: toolbar function "${titlePrefix}" is not available on this screen. Either the ` +
          `screen is not the one expected, or this SAP release names it differently.`
      )
    }

    const clicked = await this.loc(`[role="button"][title="${cssQuote(title)}"]`)
      .last()
      .click({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false)

    if (!clicked) {
      const key = shortcutFrom(title)
      if (!key) {
        throw new Error(
          `se16n: toolbar function "${title}" could not be clicked (most likely collapsed into ` +
            `the toolbar overflow) and advertises no keyboard shortcut.`
        )
      }
      if (windowIndex === 0) await this.focusGrid()
      await this.page.keyboard.press(key)
    }
    await this.sap.settle(title)
  }

  private modalOpen(): Promise<boolean> {
    return this.scope
      .evaluate(() => {
        const bl = document.getElementById("urPopupWindowBlockLayer")
        return !!bl && getComputedStyle(bl).display !== "none"
      })
      .catch(() => false)
  }

  private async waitModal(open: boolean): Promise<void> {
    for (let i = 0; i < 80; i++) {
      if ((await this.modalOpen()) === open) return
      await this.page.waitForTimeout(250)
    }
    throw new Error(
      `se16n: SE16N's modal dialog did not ${open ? "open" : "close"}.${await this.messageSuffix()}`
    )
  }

  private messageInfo(): Promise<{ text: string; isError: boolean }> {
    return this.scope
      .evaluate(() => {
        const el = document.querySelector(".lsMessageBar__text") as HTMLElement | null
        const bar = document.querySelector('[class*="lsMessageBar"]')
        if (!el || !bar || String(bar.className).includes("invisible")) {
          return { text: "", isError: false }
        }
        // aria-roledescription is a generic wrapper role ("Information Bar") even for error
        // messages — the real severity lives in aria-label ("Error Message Bar ...") and in
        // the lsdata JSON's messageType/"1" field. Verified live: SE16N's "table does not
        // exist" error carries messageType:"Error" but aria-roledescription:"Information Bar".
        const ariaLabel = bar.getAttribute("aria-label") ?? ""
        const lsdata = bar.getAttribute("lsdata") ?? ""
        const messageType = (lsdata.match(/"messageType":"(\w+)"/) ?? [])[1] ?? ""
        return {
          text: (el.innerText ?? "").trim(),
          isError: /error/i.test(`${ariaLabel} ${messageType}`)
        }
      })
      .catch(() => ({ text: "", isError: false }))
  }

  private async messageText(): Promise<string> {
    return (await this.messageInfo()).text
  }

  private async messageSuffix(): Promise<string> {
    const m = await this.messageText()
    return m ? ` SAP says: "${m}".` : ""
  }
}

/** "Delete All Entries (Ctrl+F1)" → "Control+F1". Returns "" when no shortcut is advertised. */
function shortcutFrom(title: string): string {
  const m = title.match(/\(([^)]+)\)\s*$/)
  if (!m) return ""
  const keys = m[1].split("+").map(k => k.trim())
  if (!keys.length) return ""
  const last = keys[keys.length - 1]
  if (!/^(F\d{1,2}|[A-Za-z0-9])$/.test(last)) return ""
  return keys.map(k => (k.toLowerCase() === "ctrl" ? "Control" : k)).join("+")
}

/** Escape a value for use inside a CSS attribute selector's double quotes. */
function cssQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}
