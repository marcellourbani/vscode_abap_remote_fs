/**
 * SapSession — the ONE class tests use for interactions with SAP WebGUI.
 *
 * Design:
 *  - Every action goes through `guarded()`: dismiss-popups → action → wait-server
 *    → wait-dom-stable → dismiss-popups → screenshot. Tests never call these directly.
 *  - Selectors are role + accessible name, scoped to a container (group / dialog / table).
 *    Never CSS classes, never ref numbers, never positional guessing.
 *  - No login here. The session is already authenticated by the time a spec runs: the
 *    playwright_test tool mints a SAP reentrance ticket and globalSetup turns it into the
 *    storage state every spec starts from.
 *
 * Helper names are strictly generic — they describe SAP UI mechanics (setField, pickFromValueHelp),
 * never a business domain (no setMaterial, no pickPlant).
 */
import type { Page, TestInfo, Locator, FrameLocator } from "@playwright/test"

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Normalise a label for fuzzy comparison: lowercase, non-alphanumerics → spaces. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/**
 * Cheap 0..1 similarity between a requested name and a candidate label. Deliberately
 * simple — it only ranks *diagnostic suggestions*, it never selects an element. Exact
 * match > substring > shared-token (Jaccard) overlap.
 */
function nameSimilarity(query: string, candidate: string): number {
  const q = normalizeName(query)
  const c = normalizeName(candidate)
  if (!q || !c) return 0
  if (q === c) return 1
  if (c.includes(q) || q.includes(c)) return 0.8
  const qt = q.split(" ").filter(Boolean)
  const ct = c.split(" ").filter(Boolean)
  const cset = new Set(ct)
  const shared = qt.filter(t => cset.has(t)).length
  const union = new Set([...qt, ...ct]).size
  return union ? shared / union : 0
}
import { waitForServer, waitForDomStable } from "./waiters"
import { dismissKnownPopups, Interrupter, listOpenDialogs } from "./popup-guard"
import { detectRuntimeError, detectSilentBounce } from "./dump-detector"
import { Evidence } from "./evidence"

export type SapSessionOptions = {
  tcId: string
  title: string
  extraInterrupters?: Interrupter[]
  captureSteps?: boolean // default true
}

export class SapSession {
  private evidence: Evidence
  private captureSteps: boolean
  private extraInterrupters: Interrupter[]
  /**
   * CSS selector for the iframe that actually holds the SAP ITS content. The page has
   * TWO iframes — `ITSFRAME1` (the SAP application) and `ITSTERMFRAME` ("Blank ITS Page").
   * Selecting "the first iframe" by DOM order can pick the blank one, which makes every
   * locator and assertion query an empty document and report `Last seen: []` while the
   * text is plainly on screen (the headless-vs-headed "impossible to diagnose" alert bug).
   * We target `#ITSFRAME1` explicitly, and only fall back if it genuinely isn't present.
   */
  private contentFrameSelector = "iframe#ITSFRAME1"
  private contentFrameResolved = false

  constructor(
    public readonly page: Page,
    private opts: SapSessionOptions,
    private testInfo?: TestInfo
  ) {
    this.evidence = new Evidence(page, opts.tcId, opts.title, testInfo)
    this.captureSteps = opts.captureSteps ?? true
    this.extraInterrupters = opts.extraInterrupters ?? []
  }

  // ---------- lifecycle ----------

  /**
   * Build the SAP WebGUI URL from baseURL + optional extra query params.
   * We do NOT force a theme — on ITS WebGUI the user's SU3 theme already renders
   * controls with usable accessible names, and forcing `sap_fiori_3` on some
   * systems leaves a persistent "Please wait..." splash overlay covering the app.
   * Iframe targeting + role-with-CSS-class fallbacks (see content(), selectRadio,
   * clickButton, expectAlert) handle the ITS DOM regardless of theme.
   */
  private buildUrl(extraParams: Record<string, string> = {}): string {
    const base =
      (this.page.context() as any)._options?.baseURL ??
      process.env[`SAP_URL_${(process.env.SAP_SYSTEM ?? "DEV").toUpperCase()}`] ??
      process.env.SAP_URL
    if (!base) throw new Error("No SAP URL configured")
    if (!Object.keys(extraParams).length) return base
    const sep = base.includes("?") ? "&" : "?"
    const query = Object.entries(extraParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&")
    return `${base}${sep}${query}`
  }

  /**
   * Open the SAP WebGUI base URL. The session is already authenticated — see the class
   * comment — so this navigates only.
   */
  async open(): Promise<void> {
    await this.page.goto(this.buildUrl(), { waitUntil: "domcontentloaded" })
    await waitForServer(this.page)
    await dismissKnownPopups(this.page, this.extraInterrupters)
    await this.recordStep("Opened SAP home")
  }

  /**
   * Open a transaction by OK-code.
   *
   * URL-based navigation (`?~transaction=<TCODE>`) is used unconditionally — every
   * WebGUI variant we've tested honors it.
   *
   * Also verifies that the transaction actually loaded. SAP silently bounces the
   * user back to SAP Easy Access (SAPMSYST/40 / S000) when the transaction
   * doesn't exist in this client OR the user lacks S_TCODE for it, without any
   * error message. Without this check, tests continue against the wrong screen
   * and fail with confusing selector errors much later.
   */
  async openTx(tcode: string): Promise<void> {
    await this.guarded(`Open transaction ${tcode}`, async () => {
      await this.page.goto(this.buildUrl({ "~transaction": tcode }), {
        waitUntil: "domcontentloaded"
      })
    })
    const bounced = await detectSilentBounce(this.page, tcode)
    if (bounced) {
      throw new Error(
        `openTx("${tcode}") silently bounced to ${bounced.actualScreen}. ` +
          `Most likely causes: the transaction doesn't exist in this client, the user lacks ` +
          `S_TCODE for it, or a prior transaction is still “held”. Check via SM50 / SU53.`
      )
    }
  }

  /** Start an ABAP report (equivalent to SE38 → program → Execute). */
  async runReport(programName: string): Promise<void> {
    await this.openTx("SE38")
    await this.setField("Program", programName)
    await this.pressKey("F8", `Run report ${programName}`)
  }

  // ---------- input helpers ----------

  /** Fill a textbox by accessible name, optionally scoped to a group.
   *
   * Locator strategy (in order):
   *  1. role=textbox with the accessible name, when it matches EXACTLY ONE element —
   *     the readable, preferred path; works for ~95% of ITS fields because the visible
   *     label is exposed as an accessible name on the <input>.
   *  2. If the label is AMBIGUOUS (matches >1) or ABSENT (matches 0) and opts.technicalName
   *     is provided, disambiguate via `input[lsdata*="-<TECH>"]`. ITS embeds the SAP
   *     screen-element ID in the `lsdata` JSON blob (e.g. Purchasing Org has
   *     `.../ctxtMEPO1222-EKORG` in its SID); `-<FIELD>` is the DDIC name, stable across
   *     sessions/themes/patches. This is the RIGHT tool for duplicate labels — it is used
   *     whenever the label isn't a unique match, not only when the label matches nothing.
   *  3. If the label is ambiguous and no technicalName resolves, an explicit verified
   *     `nth` is honored (a from/to range pair — normally via setRange); otherwise the
   *     call THROWS rather than silently filling the first of several identical labels.
   */
  async setField(
    fieldName: string,
    value: string,
    opts: {
      group?: string
      nth?: number
      /** SAP technical field name (e.g. "EKORG") for lsdata-based fallback. */
      technicalName?: string
    } = {}
  ) {
    if (typeof value !== "string") {
      throw new Error(
        `setField("${fieldName}", <undefined>): value is not a string. ` +
          `This usually means a data key from resolveTestData(...) is not declared in ` +
          `${this.opts.tcId}.data.md's "requires:" (an undeclared key resolves to undefined), ` +
          `is misspelled, or was never prepared. Check ` +
          `tests/<PROGRAM>/test-cases/${this.opts.tcId}.data.md and its ` +
          `tests/<PROGRAM>/test-results/<SYSTEM>/${this.opts.tcId}/data.json cache, and run ` +
          `verify_test_data_usage.`
      )
    }
    await this.guarded(
      `Set ${opts.group ? opts.group + " → " : ""}${fieldName} = "${value}"`,
      async () => {
        const root: FrameLocator | Locator = opts.group
          ? this.content().getByRole("group", { name: opts.group })
          : this.content()

        const byName = root.getByRole("textbox", { name: fieldName })
        const nameCount = await byName.count().catch(() => 0)

        // 1) UNAMBIGUOUS label match — the readable, preferred path. (Honor an explicit
        //    nth so a range helper misused on a single-box field still fails loudly, as
        //    nth(1) on a one-element locator resolves to nothing rather than overwriting.)
        if (nameCount === 1) {
          await byName.nth(opts.nth ?? 0).fill(value)
          return
        }

        // 2) Ambiguous (duplicate label) OR absent: this is exactly when technicalName
        //    earns its keep. In ITS every input carries `lsdata='{..."SID":".../ctxt<TABLE>-<FIELD>"...}'`;
        //    matching `-<FIELD>` is stable across sessions/themes/patches (it's the DDIC name,
        //    not the DOM renderer). Prefer this precise disambiguator over guessing an ordinal —
        //    a duplicate label is the documented reason technicalName exists, so use it here, not
        //    only when the label matches nothing.
        if (opts.technicalName) {
          const byLsdata = root.locator(`input[lsdata*="-${opts.technicalName}"]`)
          const lsCount = await byLsdata.count().catch(() => 0)
          if (lsCount >= 1) {
            await byLsdata.nth(opts.nth ?? 0).fill(value)
            return
          }
        }

        // 3) Duplicate label, no technicalName that resolved. An EXPLICIT, verified nth
        //    (e.g. a from/to range pair — normally via setRange) is allowed. Otherwise refuse
        //    to silently fill the first match: that's how "set From, then overwrite From with
        //    the To value" happens. Fail loudly and demand a disambiguator instead.
        if (nameCount > 1) {
          if (opts.nth !== undefined) {
            await byName.nth(opts.nth).fill(value)
            return
          }
          throw new Error(
            `setField("${fieldName}") is ambiguous: ${nameCount} textboxes share this accessible ` +
              `name. Disambiguate with { technicalName: "<SAP_FIELD>" } (preferred — the DDIC field ` +
              `name embedded in lsdata, verified from ADT), or { nth: <index> } ONLY when the order ` +
              `is verified in _screens.md (a from/to range pair — usually better handled by ` +
              `sap.setRange(...)). The default first match is deliberately NOT used, because ` +
              `silently filling the wrong one of two identical labels passes green while testing ` +
              `nothing.`
          )
        }

        // 4) nameCount === 0 — nothing matched by label or technicalName; list what IS present.
        const hint = await this.suggestTextFields(root, fieldName, opts.group).catch(() => "")
        throw new Error(
          `setField could not locate a textbox for "${fieldName}"` +
            (opts.technicalName ? ` (also tried lsdata*="-${opts.technicalName}")` : "") +
            `.` +
            hint +
            ` Fix by correcting the accessible name in _screens.md (re-explore with the ` +
            `explore-ui skill if the recorded label is wrong), or supply ` +
            `{ technicalName: "<SAP_FIELD>" } for lsdata-based disambiguation. Do NOT blindly ` +
            `paste a suggestion into the spec — confirm it against _screens.md first; a similar ` +
            `name is not proof it is the right field.`
        )
      }
    )
  }

  /**
   * Build a DIAGNOSTIC "did you mean" hint for a failed control lookup — never used to
   * select an element, only to make the error actionable. It enumerates the controls of
   * the relevant kind that ARE present in the current scope (grounded in the live DOM,
   * so it can never invent a control), reads each one's accessible-name-ish label (and,
   * for inputs, its SAP technical field name from `lsdata`), and returns the closest few
   * by name.
   *
   * Safety: this is suggestions only. The test still fails; a human/model must confirm
   * the real name against `_screens.md` (correcting it there, re-exploring if needed)
   * rather than trusting a fuzzy match. That's why we return several UNVERIFIED
   * candidates instead of auto-picking one — a similar name is not proof of the right
   * control, and a wrong pick can pass green.
   *
   * `selector` chooses which controls to list (text inputs, checkboxes, radios,
   * buttons, grid headers); `kindLabel` names them in the message.
   */
  private async suggestControls(
    root: FrameLocator | Locator,
    query: string,
    opts: { selector: string; kindLabel: string; group?: string }
  ): Promise<string> {
    let candidates = await this.collectControls(root, opts.selector)
    let scopeNote = "on this screen"
    if (opts.group && candidates.length === 0) {
      // Nothing in the named group — the group name itself may be wrong. Widen the
      // search and say so, so the reader checks the group label too.
      candidates = await this.collectControls(this.content(), opts.selector)
      scopeNote = `outside the group "${opts.group}" (the group name may also be wrong)`
    }
    if (!candidates.length) return ""

    const seen = new Set<string>()
    const unique = candidates.filter(c => {
      const key = `${c.name}|${c.tech}`
      if (seen.has(key) || (!c.name && !c.tech)) return false
      seen.add(key)
      return true
    })

    const ranked = unique
      .map(c => ({
        ...c,
        score: Math.max(nameSimilarity(query, c.name), nameSimilarity(query, c.tech))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(
        c => `"${c.name || "(no accessible name)"}"${c.tech ? ` [technicalName: ${c.tech}]` : ""}`
      )

    if (!ranked.length) return ""
    return (
      ` ${opts.kindLabel} actually present ${scopeNote} (UNVERIFIED suggestions — do not swap blindly): ` +
      ranked.join(", ") +
      `.`
    )
  }

  /** Read {name, tech} for every control matching `selector` in `scope` (best-effort, live DOM). */
  private collectControls(
    scope: FrameLocator | Locator,
    selector: string
  ): Promise<Array<{ name: string; tech: string }>> {
    return scope
      .locator(selector)
      .evaluateAll(els =>
        els.slice(0, 400).map(el => {
          let name = (
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            el.getAttribute("placeholder") ||
            (el.id
              ? (document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "")
              : "") ||
            ""
          ).trim()
          if (!name) {
            // Radios, tabs and ITS buttons carry their label as text content.
            const t = (el.textContent || "").trim().replace(/\s+/g, " ")
            if (t && t.length <= 40) name = t
          }
          let tech = ""
          const ls = el.getAttribute("lsdata")
          if (ls) {
            // SID ends with the DDIC field name, e.g. ".../ctxtMEPO1222-EKORG".
            const matches = [...ls.matchAll(/-([A-Z][A-Z0-9_]{1,})"/g)]
            if (matches.length) tech = matches[matches.length - 1][1]
          }
          return { name, tech }
        })
      )
      .catch(() => [] as Array<{ name: string; tech: string }>)
  }

  /** Thin wrapper kept for setField: list the text inputs present. */
  private suggestTextFields(
    root: FrameLocator | Locator,
    fieldName: string,
    group?: string
  ): Promise<string> {
    return this.suggestControls(root, fieldName, {
      selector: "input, textarea",
      kindLabel: "Text fields",
      group
    })
  }

  /** Fill both endpoints of a range (from/to) for a select-option.
   *  SAP select-options render as two textboxes with the SAME accessible name
   *  (both labeled after the field, e.g. "Site"). We target them by nth.
   */
  async setRange(fieldName: string, from: string, to: string, opts: { group?: string } = {}) {
    await this.setField(fieldName, from, { ...opts, nth: 0 })
    if (to !== undefined && to !== "") {
      await this.setField(fieldName, to, { ...opts, nth: 1 })
    }
  }

  async check(checkboxName: string, opts: { group?: string; value?: boolean } = {}) {
    const value = opts.value ?? true
    await this.guarded(`${value ? "Check" : "Uncheck"} ${checkboxName}`, async () => {
      const root: FrameLocator | Locator = opts.group
        ? this.content().getByRole("group", { name: opts.group })
        : this.content()
      const cb = root.getByRole("checkbox", { name: checkboxName })
      if (!(await cb.count().catch(() => 0))) {
        const hint = await this.suggestControls(root, checkboxName, {
          selector: 'input[type="checkbox"], [role="checkbox"], [class*="lsCheckBox"]',
          kindLabel: "Checkboxes",
          group: opts.group
        }).catch(() => "")
        throw new Error(
          `check could not locate a checkbox named "${checkboxName}".` +
            hint +
            ` Verify the accessible name in _screens.md (re-explore with the explore-ui skill ` +
            `if it's wrong). Do NOT blindly swap in a similar name.`
        )
      }
      if (value) await cb.first().check()
      else await cb.first().uncheck()
    })
  }

  async selectRadio(radioName: string, opts: { group?: string } = {}) {
    await this.guarded(`Select radio "${radioName}"`, async () => {
      const root: FrameLocator | Locator = opts.group
        ? this.content().getByRole("group", { name: opts.group })
        : this.content()
      const byRole = root.getByRole("radio", { name: radioName }).first()
      if (await byRole.count().catch(() => 0)) {
        await byRole.check()
        return
      }
      // ponytail: SAP ITS WebGUI renders radios as <span class="lsRadioButton--{checked,unchecked}">
      // with the label text inside and NO ARIA radio role. Fall back to text match on those spans.
      // Upgrade path: if SAP ever adds role=radio, the byRole branch above will hit first.
      const span = this.content()
        .locator('span[class*="lsRadioButton--"]', { hasText: radioName })
        .first()
      if (!(await span.count().catch(() => 0))) {
        const hint = await this.suggestControls(this.content(), radioName, {
          selector: '[role="radio"], span[class*="lsRadioButton--"]',
          kindLabel: "Radio buttons"
        }).catch(() => "")
        throw new Error(
          `selectRadio could not locate a radio named "${radioName}".` +
            hint +
            ` Verify the accessible name in _screens.md (re-explore with the explore-ui skill ` +
            `if it's wrong). Do NOT blindly swap in a similar name.`
        )
      }
      await span.click({ force: true })
    })
  }

  async clickButton(
    buttonName: string | RegExp,
    opts: { group?: string; dialog?: string; nth?: number } = {}
  ) {
    await this.guarded(`Click "${buttonName}"`, async () => {
      let root: FrameLocator | Locator = this.content()
      if (opts.dialog)
        root = this.content().getByRole("dialog", {
          name: new RegExp(opts.dialog, "i")
        })
      else if (opts.group) root = this.content().getByRole("group", { name: opts.group })

      // 1) Fiori/UI5: role=button with accessible name
      const byBtn = root.getByRole("button", { name: buttonName })
      if (await byBtn.count().catch(() => 0)) {
        await byBtn.nth(opts.nth ?? 0).click()
        return
      }

      // 2) ITS WebGUI: toolbar buttons are <div class="lsButton..." title="Execute">.
      //    The `title` attribute is the accessible label. Text content is icons + hidden
      //    label text, so filtering by hasText is unreliable — match on title/aria-label.
      const nameStr = typeof buttonName === "string" ? buttonName : null
      if (nameStr) {
        const byTitle = root.locator(`[title="${nameStr}"], [aria-label="${nameStr}"]`).first()
        if (await byTitle.count().catch(() => 0)) {
          await byTitle.click({ force: true })
          return
        }
      } else {
        // regex path — enumerate elements with title/aria-label and test
        const candidates = root.locator("[title], [aria-label]")
        const count = await candidates.count().catch(() => 0)
        for (let i = 0; i < count; i++) {
          const el = candidates.nth(i)
          const t = (await el.getAttribute("title")) ?? (await el.getAttribute("aria-label")) ?? ""
          if ((buttonName as RegExp).test(t)) {
            await el.click({ force: true })
            return
          }
        }
      }

      // 3) Last resort: link with matching text (menu items sometimes render as <a>)
      const namePattern =
        typeof buttonName === "string" ? new RegExp(`^${escapeRe(buttonName)}$`, "i") : buttonName
      const byLink = root.locator("a, [role='link']").filter({ hasText: namePattern }).first()
      if (await byLink.count().catch(() => 0)) {
        await byLink.click({ force: true })
        return
      }

      const buttonQuery = typeof buttonName === "string" ? buttonName : buttonName.source
      const hint = await this.suggestControls(root, buttonQuery, {
        selector: '[role="button"], button, a[href], [role="link"], [class*="lsButton"]',
        kindLabel: "Buttons/actions",
        group: opts.group
      }).catch(() => "")
      throw new Error(
        `Could not find clickable element for "${buttonName}" ` +
          `(tried role=button, [title], [aria-label], link).` +
          hint +
          ` Verify the button label in _screens.md (re-explore with the explore-ui skill if it's ` +
          `wrong). A header tab is NOT a button — use clickTab for tabs. Do NOT blindly swap in a ` +
          `similar name.`
      )
    })
  }

  /** Click a header tab in an ITS WebGUI tab strip (e.g. "Delivery/Invoice",
   *  "Conditions", "Org. Data" on ME21N).
   *
   * WHY NOT clickButton: ITS renders tabs as `<div class="lsTbsv5-ItemTitle">Label</div>`
   * inside a `<div class="lsTbsItem--scrollable ...">` — NO role=tab, NO title, NO
   * aria-selected, NO aria-label. The tab label text is the only stable anchor.
   * The parent lsTbsItem also contains a hidden `.lsTbsv5-ItmWidthHelper` duplicate
   * of the label (used for width measurement), so a plain hasText filter matches
   * twice and Playwright strict-mode fails.
   *
   * Strategy: (1) try role=tab for Fiori/UI5, then (2) locate the ItemTitle span by
   * exact text (unique per tab) and invoke `.click()` on its closest lsTbsItem
   * ancestor via an in-frame evaluate — DOM click is what SAP's own handlers listen
   * for and works reliably; Playwright's locator.click can miss the parent due to
   * pointer-event overlays from the ItmWidthHelper.
   *
   * The `lsTbsv5-` prefix is the current tab-strip renderer version; we match
   * `class*="lsTbsv"` so a future v6 renderer swap doesn't break the helper.
   */
  async clickTab(tabName: string): Promise<void> {
    await this.guarded(`Click tab "${tabName}"`, async () => {
      // 1) Fiori/UI5: proper role=tab with accessible name
      const byRole = this.content().getByRole("tab", { name: tabName })
      if (await byRole.count().catch(() => 0)) {
        await byRole.first().click()
        return
      }

      // 2) ITS WebGUI: find the ItemTitle by exact text, click its lsTbsItem parent
      const clicked = await this.content()
        .locator('[class*="lsTbsv"][class*="-ItemTitle"]')
        .evaluateAll((els, target) => {
          for (const el of els) {
            if ((el.textContent || "").trim() === target) {
              const parent = el.closest('[class*="lsTbsItem"]') as HTMLElement | null
              if (parent) {
                parent.click()
                return true
              }
            }
          }
          return false
        }, tabName)

      if (!clicked) {
        const hint = await this.suggestControls(this.content(), tabName, {
          selector: '[role="tab"], [class*="lsTbsv"][class*="-ItemTitle"]',
          kindLabel: "Tabs"
        }).catch(() => "")
        throw new Error(
          `clickTab could not find a tab with label "${tabName}".` +
            hint +
            ` Verify the tab label in _screens.md — labels are case-sensitive and must match exactly ` +
            `(including punctuation like "Delivery/Invoice" or "Org. Data"). Do NOT blindly swap in ` +
            `a similar name.`
        )
      }
    })
  }

  async pressKey(key: string, description?: string) {
    await this.guarded(description ?? `Press ${key}`, async () => {
      await this.page.keyboard.press(key)
    })
  }

  /** Toolbar Execute (F8 equivalent). */
  async execute() {
    await this.clickButton(/^Execute/)
  }

  /** Click Continue/OK/Enter in a dialog. */
  async continueDialog(dialogTitle?: string) {
    await this.clickButton(/^(Continue|OK|Enter)/i, {
      dialog: dialogTitle ?? undefined
    })
  }

  /** Cancel a dialog explicitly. Never use keyboard Escape — it exits the whole transaction. */
  async cancelDialog(dialogTitle?: string) {
    await this.clickButton(/^Cancel/i, { dialog: dialogTitle ?? undefined })
  }

  /** Select a row in a grid (F4, ALV, etc.) by matching a cell's text. */
  async selectGridRowByText(cellText: string | RegExp) {
    await this.guarded(`Select grid row containing "${cellText}"`, async () => {
      await this.content().getByRole("gridcell", { name: cellText }).first().click()
    })
  }

  /** Fill an editable cell in a WebGUI ALV/table by column title + 1-based row index.
   *
   * WHY NOT setField: editable ALV inputs in ITS have NO accessible name — the
   * <input> that appears when you click a cell is nameless. The column title lives
   * on the header <th title="Article">, not the cell input. So role+name lookup
   * can't find them.
   *
   * How this works:
   *   <th id="tbl317[0,5]" title="Article">     ← column 5 of table tbl317
   *   <td id="tbl317[1,5]">...</td>              ← row 1 of same column
   * click on the td → SAP renders <input id="tbl317[1,5]_c"> inside it and focuses it.
   *
   * The `tbl<N>` numeric prefix changes across sessions AND across tab switches
   * within one session — NEVER hardcode it. We derive it from the header we just
   * found by title.
   *
   * Row indexing matches SAP's own [row,col] numbering: row 0 is the header row,
   * data rows start at 1. Personalization or hidden columns move column indexes,
   * so we look them up by title every time — never cache the [row,col] pair.
   *
   * If multiple editable grids on the same screen share a column title, the first
   * grid wins. Change the layout or set a variant so titles are unique per grid;
   * see the grid section of the sap-webgui skill for disambiguation guidance.
   */
  async setGridCell(columnTitle: string, rowIndex: number, value: string): Promise<void> {
    if (typeof value !== "string") {
      throw new Error(
        `setGridCell("${columnTitle}", ${rowIndex}, <undefined>): value is not a string. ` +
          `This usually means a data key from resolveTestData(...) was misspelled ` +
          `or is missing from the .data.md / cache. Check test-cases/*/${this.opts.tcId}.data.md ` +
          `and evidence/${this.opts.tcId}/data.<SYSTEM>.json.`
      )
    }
    if (!Number.isInteger(rowIndex) || rowIndex < 1) {
      throw new Error(
        `setGridCell: rowIndex must be an integer >= 1 (got ${rowIndex}). ` +
          `Row 0 is the header row — data rows start at 1.`
      )
    }
    await this.guarded(`Set grid cell "${columnTitle}" row ${rowIndex} = "${value}"`, async () => {
      // WebGUI renders editable grids with one of TWO different DOM schemes; try the
      // classic dynpro table control first, then the CL_GUI_ALV_GRID control-framework grid.
      if (await this.trySetTableControlCell(columnTitle, rowIndex, value)) return
      if (await this.trySetAlvGridCell(columnTitle, rowIndex, value)) return

      const hint = await this.suggestControls(this.content(), columnTitle, {
        selector: "th[title], [id*='#0,'], [id*='[0,']",
        kindLabel: "Grid column headers"
      }).catch(() => "")
      throw new Error(
        `setGridCell could not locate an editable grid column "${columnTitle}" in either the ` +
          `dynpro table-control scheme (th[title], <prefix>[r,c]) or the CL_GUI_ALV_GRID scheme ` +
          `(<prefix>#r,c). ` +
          hint +
          ` The column must be visible on screen — SAP removes scrolled-off columns from the DOM ` +
          `(reset the layout or scroll it into view). Verify the column title in _screens.md. If ` +
          `the grid uses a renderer neither scheme matches, this is a runtime gap to report — do ` +
          `NOT hand-roll a raw fill(); a raw fill() skips the commit event and the cell reverts ` +
          `silently (green on empty data).`
      )
    })
  }

  /**
   * Dynpro table-control cell: header `<th title="Col">` with id `<prefix>[0,col]`, cell
   * `<prefix>[row,col]`, editor `<prefix>[row,col]_c`. Returns false (not an error) if this
   * screen isn't a table control, so the caller can try the ALV-grid scheme instead.
   */
  private async trySetTableControlCell(
    columnTitle: string,
    rowIndex: number,
    value: string
  ): Promise<boolean> {
    const header = await this.content()
      .locator(`th[title="${columnTitle}"]`)
      .first()
      .evaluate(th => {
        const match = th.id.match(/^(.+)\[(\d+),(\d+)\]$/)
        return match ? { prefix: match[1], col: parseInt(match[3], 10) } : null
      })
      .catch(() => null)
    if (!header) return false

    const cellId = `${header.prefix}[${rowIndex},${header.col}]`
    const cell = this.content().locator(`[id="${cellId}"]`)
    if (!(await cell.count().catch(() => 0))) {
      throw new Error(
        `setGridCell: no cell with id "${cellId}" — row ${rowIndex} probably does not exist ` +
          `(the grid may have fewer visible rows than requested).`
      )
    }
    // Real Playwright click activates the editor — an in-page DOM .click() does not trigger
    // SAP's event pipeline reliably.
    await cell.click()
    const input = this.content().locator(`[id="${cellId}_c"]`)
    await input.waitFor({ state: "visible", timeout: 5_000 })
    await input.fill(value)
    return true
  }

  /**
   * CL_GUI_ALV_GRID cell: header/cell ids use a `#`-separated scheme (`<prefix>#<row>,<col>`,
   * header row is row 0), the header carries the column label as TEXT (usually no `title`),
   * and the editable input id is `<cellId>#if`. Unlike a table control, the ALV grid only
   * reads the typed value into its internal buffer on a change/blur/Enter event — a bare
   * fill() leaves the buffer empty and the cell reverts on commit. So we fill, then commit
   * with a real Tab, then VERIFY the committed value stuck (throwing loudly on mismatch so a
   * failed commit can never pass green on empty data). Returns false if this isn't an ALV grid.
   */
  private async trySetAlvGridCell(
    columnTitle: string,
    rowIndex: number,
    value: string
  ): Promise<boolean> {
    // Find the header cell (row 0) whose visible text equals the column title, and read the
    // grid prefix + column index from its id (`<prefix>#0,<col>`).
    const header = await this.content()
      .locator("[id]")
      .evaluateAll((els, title) => {
        for (const el of els) {
          const m = el.id.match(/^(.+)#(\d+),(\d+)$/)
          if (!m || m[2] !== "0") continue
          const text = (el.textContent || "").trim().replace(/\s+/g, " ")
          if (text === title) return { prefix: m[1], col: parseInt(m[3], 10) }
        }
        return null
      }, columnTitle)
      .catch(() => null)
    if (!header) return false

    const cellId = `${header.prefix}#${rowIndex},${header.col}`
    const cell = this.content().locator(`[id="${cellId}"]`)
    if (!(await cell.count().catch(() => 0))) {
      throw new Error(
        `setGridCell: no ALV cell with id "${cellId}" — row ${rowIndex} probably does not ` +
          `exist (the grid may have fewer visible rows than requested).`
      )
    }
    await cell.click()
    const input = this.content().locator(`[id="${cellId}#if"]`)
    await input.waitFor({ state: "visible", timeout: 5_000 })
    await input.fill(value)
    // Commit: a real keypress fires the change/blur the ALV grid listens for. Then let the
    // server round-trip settle before reading back.
    await input.press("Tab").catch(() => {})
    await waitForServer(this.page)
    await this.verifyGridCellCommitted(cellId, value)
    return true
  }

  /**
   * After an ALV-grid commit, confirm the cell now renders the value we set. A mismatch means
   * the value did NOT commit (the classic silent-revert-to-0.00). We throw rather than let the
   * test proceed on empty data. If the cell text can't be read back at all, we also throw — an
   * unverifiable commit must not be treated as success (report it as a runtime gap instead).
   */
  private async verifyGridCellCommitted(cellId: string, value: string): Promise<void> {
    const rendered = await this.content()
      .locator(`[id="${cellId}"]`)
      .textContent()
      .then(t => (t ?? "").trim().replace(/\s+/g, " "))
      .catch(() => null)
    if (rendered === null) {
      throw new Error(
        `setGridCell: could not read back ALV cell "${cellId}" to confirm the value committed. ` +
          `An unverifiable commit is treated as a failure so it can't pass green on empty data — ` +
          `report this grid as a runtime gap (helpers-reference) rather than working around it.`
      )
    }
    const want = value.trim()
    // Loose match: SAP may reformat (e.g. "8" → "8.00", leading-zero padding). Accept when
    // either contains the other; reject a clear mismatch (empty cell, or unrelated text).
    const ok =
      want === "" || rendered.includes(want) || (rendered !== "" && want.includes(rendered))
    if (!ok) {
      throw new Error(
        `setGridCell: value did not commit into ALV cell "${cellId}". Expected it to render ` +
          `"${value}" but the cell shows "${rendered}". The fill likely did not fire the grid's ` +
          `change/blur event — this is exactly the silent-revert failure setGridCell exists to ` +
          `catch. Do NOT hand-roll a raw fill(); report as a runtime gap if setGridCell can't ` +
          `commit on this grid.`
      )
    }
  }

  /** F4 value help: open, pick a row by text, click OK. Compound action. */
  async pickFromValueHelp(fieldName: string, valueText: string, opts: { group?: string } = {}) {
    await this.guarded(`Pick "${valueText}" via F4 on ${fieldName}`, async () => {
      const root: FrameLocator | Locator = opts.group
        ? this.content().getByRole("group", { name: opts.group })
        : this.content()
      await root.getByRole("textbox", { name: fieldName }).first().click()
      await this.page.keyboard.press("F4")
      await this.content().getByRole("dialog").first().waitFor()
      await this.content().getByRole("gridcell", { name: valueText }).first().click()
      await this.content()
        .getByRole("dialog")
        .first()
        .getByRole("button", { name: /^(OK|Continue)/i })
        .first()
        .click()
    })
  }

  /**
   * Upload a local file to a file-input control.
   * Works for any SAP screen that renders a native <input type="file"> (KCD_UPLOAD,
   * cl_gui_frontend_services=>file_open_dialog when exposed to WebGUI, etc.).
   * If the screen uses a proprietary uploader, the helper will fail — call raw() in that case.
   */
  async uploadFile(fieldLabel: string, absolutePath: string) {
    await this.guarded(`Upload file to "${fieldLabel}": ${absolutePath}`, async () => {
      // Try native file input first, associated with the label
      const input = this.content().locator(`input[type="file"]`).first()
      await input.setInputFiles(absolutePath)
    })
  }

  /**
   * Download a file expected to be produced by the next action (Excel export, list-to-file, etc.).
   * Returns the absolute path to the saved file inside test-results/.
   */
  async captureDownload(triggerAction: () => Promise<void>, saveAs?: string): Promise<string> {
    const [download] = await Promise.all([
      this.page.waitForEvent("download", { timeout: 60_000 }),
      triggerAction()
    ])
    const suggested = saveAs ?? download.suggestedFilename()
    const outPath = this.testInfo
      ? `${this.testInfo.outputDir}/${suggested}`
      : `test-results/${suggested}`
    await download.saveAs(outPath)
    await this.recordStep(`Downloaded file → ${outPath}`)
    return outPath
  }

  // ---------- assertions ----------

  /**
   * Assert a status/alert message contains the given text.
   *
   * WebGUI (SAP ITS) does NOT put role="alert" on status-bar messages — they
   * render as <div class="lsMessageBar ...">. Fiori/UI5 dialogs use role="alert".
   * We match either. Also matches role=status. ponytail: same regex both places.
   */
  async expectAlert(text: string | RegExp) {
    await this.ensureContentFrame()
    const pattern = typeof text === "string" ? new RegExp(text, "i") : text
    const deadline = Date.now() + 15_000
    let lastSeen: string[] = []
    while (Date.now() < deadline) {
      const roleTexts = await this.content()
        .locator('[role="alert"], [role="status"]')
        .allTextContents()
        .catch(() => [] as string[])
      const barTexts = await this.content()
        .locator(".lsMessageBar, .lsStatusMessageArea, .lsStatusMessage")
        .allTextContents()
        .catch(() => [] as string[])
      lastSeen = [...roleTexts, ...barTexts].filter(t => t.trim())
      if (lastSeen.some(t => pattern.test(t))) {
        await this.recordStep(`Alert asserted: "${text}"`)
        return
      }
      await this.page.waitForTimeout(300)
    }
    // Capture evidence of the failing state BEFORE throwing — otherwise the last screenshot
    // predates the assertion and the run is undiagnosable (the exact headed/headless alert
    // bug). Also report WHICH frame we queried and how many message elements existed there:
    // an empty `Last seen` combined with a resolved frame points at frame/scope, not timing.
    const frameNote = `frame="${this.contentFrameSelector}"${this.contentFrameResolved ? "" : " (unresolved)"}`
    await this.recordStep(
      `Alert NOT matched: ${pattern} (${frameNote}; last seen: ${JSON.stringify(lastSeen)})`
    ).catch(() => {})
    throw new Error(
      `Alert did not match ${pattern}. Last seen: ${JSON.stringify(lastSeen)}. ` +
        `Queried ${frameNote}. An EMPTY "last seen" while the message is on screen usually ` +
        `means the wrong iframe/scope was queried, not a timing gap — do not add a sleep.`
    )
  }

  /**
   * Assert that no status/alert message is shown. Pass a `pattern` to assert THAT specific
   * message is absent (the reliable form for "message M is NOT shown"); the bare form fails
   * on ANY status text — including a leftover message from the previous round-trip — so it
   * is only meaningful immediately after a round-trip that should have cleared the bar.
   */
  async expectNoAlert(pattern?: string | RegExp) {
    await this.ensureContentFrame()
    const roleTexts = await this.content()
      .locator('[role="alert"], [role="status"]')
      .allTextContents()
      .catch(() => [] as string[])
    const barTexts = await this.content()
      .locator(".lsMessageBar, .lsStatusMessageArea, .lsStatusMessage")
      .allTextContents()
      .catch(() => [] as string[])
    const all = [...roleTexts, ...barTexts].filter(t => t.trim())
    if (pattern) {
      const re = typeof pattern === "string" ? new RegExp(pattern, "i") : pattern
      const offending = all.filter(t => re.test(t))
      if (offending.length) {
        throw new Error(`Expected no alert matching ${re} but found: ${offending.join(" | ")}`)
      }
      await this.recordStep(`No alert matching ${re} (as expected)`)
      return
    }
    if (all.length) throw new Error(`Expected no alert but found: ${all.join(" | ")}`)
    await this.recordStep("No alert (as expected)")
  }

  /**
   * Assert the current screen title. Checks in this order:
   *   1. document.title  (works for classic WebGUI)
   *   2. <h1> heading    (works for themed WebGUI / Fiori shell)
   *   3. Any element with role=heading whose text matches
   */
  async expectTitle(text: string | RegExp) {
    const pattern = typeof text === "string" ? new RegExp(text, "i") : text
    const deadline = Date.now() + 15_000
    let lastSeen = ""
    while (Date.now() < deadline) {
      const docTitle = await this.page.title()
      if (pattern.test(docTitle)) {
        await this.recordStep(`Title asserted: "${text}" (document.title="${docTitle}")`)
        return
      }
      const h1 = await this.content()
        .getByRole("heading", { level: 1 })
        .first()
        .textContent()
        .catch(() => null)
      if (h1 && pattern.test(h1)) {
        await this.recordStep(`Title asserted: "${text}" (<h1>="${h1}")`)
        return
      }
      const anyHeading = await this.content()
        .getByRole("heading", { name: pattern })
        .first()
        .count()
        .catch(() => 0)
      if (anyHeading > 0) {
        await this.recordStep(`Title asserted: "${text}" (heading role)`)
        return
      }
      lastSeen = docTitle || h1 || ""
      await this.page.waitForTimeout(500)
    }
    throw new Error(`Title did not match ${pattern}. Last seen: document.title="${lastSeen}"`)
  }

  async expectDialogOpen(title: string | RegExp) {
    await this.content().getByRole("dialog", { name: title }).waitFor({ state: "visible" })
    await this.recordStep(`Dialog opened: "${title}"`)
  }

  async expectNoDialog() {
    const open = await listOpenDialogs(this.page)
    if (open.length) throw new Error(`Expected no dialog but found: ${open.join(", ")}`)
    await this.recordStep("No open dialogs (as expected)")
  }

  /** Assert a grid contains at least one row where any cell matches the given text. */
  async expectGridHasRow(cellText: string | RegExp) {
    const pattern = typeof cellText === "string" ? new RegExp(escapeRe(cellText), "i") : cellText
    // WebGUI ALV rows are <tr> without role=gridcell. Cells become <td> with text.
    // Try role=gridcell first (Fiori/UI5), then fall back to any table cell whose text matches.
    const byGridcell = this.content().getByRole("gridcell", { name: cellText })
    if (await byGridcell.count().catch(() => 0)) {
      await byGridcell.first().waitFor({ state: "visible" })
    } else {
      const anyCell = this.content()
        .locator("td, .lsListbox2Cell, .lsALVC-Cell")
        .filter({ hasText: pattern })
        .first()
      await anyCell.waitFor({ state: "visible" })
    }
    await this.recordStep(`Grid contains row with "${cellText}"`)
  }

  /** Assert a textbox with the given accessible name is currently visible. */
  async expectFieldVisible(fieldName: string, opts: { group?: string; nth?: number } = {}) {
    const root: FrameLocator | Locator = opts.group
      ? this.content().getByRole("group", { name: opts.group })
      : this.content()
    await root
      .getByRole("textbox", { name: fieldName })
      .nth(opts.nth ?? 0)
      .waitFor({ state: "visible" })
    await this.recordStep(`Field visible: "${fieldName}"`)
  }

  /** Assert a textbox with the given accessible name is NOT currently visible (or absent). */
  async expectFieldHidden(fieldName: string, opts: { group?: string } = {}) {
    const root: FrameLocator | Locator = opts.group
      ? this.content().getByRole("group", { name: opts.group })
      : this.content()
    const cnt = await root
      .getByRole("textbox", { name: fieldName })
      .count()
      .catch(() => 0)
    if (cnt === 0) {
      await this.recordStep(`Field hidden (absent): "${fieldName}"`)
      return
    }
    // Present in DOM — must be not visible (ITS uses class-based hiding, sometimes
    // the input stays in DOM but has zero size or a "hidden" class on the wrapper).
    const first = root.getByRole("textbox", { name: fieldName }).first()
    await first.waitFor({ state: "hidden" })
    await this.recordStep(`Field hidden: "${fieldName}"`)
  }

  /** Assert the grid is empty (no data rows). */
  async expectGridEmpty() {
    const rows = await this.content().getByRole("row").count()
    // header row(s) still count — accept ≤ 2 header rows as empty
    if (rows > 2) throw new Error(`Expected empty grid but found ${rows} rows (incl. headers)`)
    await this.recordStep("Grid is empty (as expected)")
  }

  // ---------- evidence pass-through ----------

  async note(description: string) {
    await this.recordStep(description)
  }

  /**
   * Assert the page is NOT displaying a short dump, ITS error, or logon screen.
   *
   * `guarded()` runs this check after every action, so an explicit call is rarely
   * needed. Use when you want to assert cleanliness at a specific point (e.g.
   * after a long-running batch execution, before capturing evidence).
   */
  async expectNoRuntimeError(): Promise<void> {
    const err = await detectRuntimeError(this.page)
    if (err) {
      throw new Error(
        `SAP runtime error detected (${err.kind}): "${err.title}" at ${err.url}\n\n` +
          `--- snippet ---\n${err.snippet}`
      )
    }
    await this.recordStep("No SAP runtime error (as expected)")
  }

  async finish(status: "pass" | "fail", errorMessage?: string) {
    await this.evidence.finish(status, errorMessage)
  }

  // ---------- internals ----------

  private async guarded(description: string, fn: () => Promise<void>): Promise<void> {
    await this.ensureContentFrame()
    await dismissKnownPopups(this.page, this.extraInterrupters)
    await fn()
    await waitForServer(this.page)
    await waitForDomStable(this.page, 400, 5_000)
    await dismissKnownPopups(this.page, this.extraInterrupters)

    // Runtime-error check: cheap (URL + title + optional body-slice) but stops
    // the test loudly the moment SAP dumps, instead of letting the next helper
    // fail with a confusing locator timeout.
    const err = await detectRuntimeError(this.page)
    if (err) {
      // Capture evidence BEFORE throwing so the manifest records the failing state.
      if (this.captureSteps) {
        await this.evidence.step(`SAP ${err.kind.toUpperCase()}: ${err.title}`)
      }
      throw new Error(
        `SAP runtime error during "${description}" (${err.kind}): "${err.title}"\n` +
          `URL: ${err.url}\n--- snippet ---\n${err.snippet}`
      )
    }

    if (this.captureSteps) await this.evidence.step(description)
  }

  private async recordStep(description: string) {
    if (this.captureSteps) await this.evidence.step(description)
  }

  /**
   * Content root. SAP WebGUI (ITS) renders the whole screen inside an <iframe>.
   * Every action/assertion locator must go through the frame — page-level
   * getByRole/locator will return zero matches. We use frameLocator("iframe").first()
   * which is stable across the two iframes present (the second is "Blank ITS Page").
   *
   * If the frame is missing (edge case: full-page redirect), we fall back to page.
   * ponytail: single method, all helpers call it. Upgrade: cache after first non-zero probe.
   */
  content(): FrameLocator {
    return this.page.frameLocator(this.contentFrameSelector)
  }

  /**
   * Resolve, once, which iframe carries the SAP ITS content. Prefer `#ITSFRAME1`; if that
   * id isn't present on this system, pick the first iframe that is NOT the blank
   * `ITSTERMFRAME`; only if neither can be determined, fall back to the first iframe.
   *
   * Called at the start of every `guarded()` action, so by the time any assertion runs
   * (a spec always performs an action before asserting) the correct frame is already
   * selected. Cheap and idempotent after the first resolution.
   */
  private async ensureContentFrame(): Promise<void> {
    if (this.contentFrameResolved) return
    try {
      const its1 = await this.page
        .locator("iframe#ITSFRAME1")
        .count()
        .catch(() => 0)
      if (its1 > 0) {
        this.contentFrameSelector = "iframe#ITSFRAME1"
        this.contentFrameResolved = true
        return
      }
      const nonBlank = await this.page
        .locator("iframe:not(#ITSTERMFRAME)")
        .count()
        .catch(() => 0)
      if (nonBlank > 0) {
        this.contentFrameSelector = "iframe:not(#ITSTERMFRAME)"
        this.contentFrameResolved = true
        return
      }
      const any = await this.page
        .locator("iframe")
        .count()
        .catch(() => 0)
      if (any > 0) {
        this.contentFrameSelector = "iframe"
        this.contentFrameResolved = true
      }
      // If no iframe at all yet (page still loading), leave unresolved and try again next action.
    } catch {
      // Leave the default (#ITSFRAME1) in place; do not mark resolved so a later action retries.
    }
  }

  // ---------- escape hatches ----------

  /** Raw Playwright Page — use only when no helper fits. Add a helper afterward. */
  raw(): Page {
    return this.page
  }

  /** Scope a locator inside a dialog by title. */
  dialog(title: string | RegExp): Locator {
    return this.content().getByRole("dialog", {
      name: title
    }) as unknown as Locator
  }
}
