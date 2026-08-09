---
name: sap-webgui
description: Authoritative SAP WebGUI behavior and locator guidance for live exploration and Playwright script generation. Covers iframes, accessible names, generated IDs, selection screens, dialogs, ALV grids, toolbars, uploads, themes, and known SapSession helper limitations. Load before explore-ui live exploration and before build-scripts translation.
---

# SAP WebGUI — UI Mechanics and Locator Rules

For bounded, self-contained support work, use `sap-task-helper` with explicit inputs, allowed writes, and an output contract.

## Non-negotiable execution gate

The `playwright_test` tool verifies the workflow artifacts produced from WebGUI exploration and **will reject affected cases** when required screen mappings or script checks are missing. Do not guess locators or skip live verification.

## Related workflows

Apply the guidance below for **WebGUI mechanics and pitfalls**. When the task also requires another workflow:

- follow `analyze-and-plan` for code coverage, `explore-ui` for `_screens.md`, and `design-cases` for test cases;
- follow `sap-webgui-recording` to decide when and how to obtain a focused user recording;
- follow `build-scripts` to translate a case into code;
- follow `helpers-reference` for exact `SapSession`/`SapArtifacts` methods and signatures.

## Labels versus IDs

SAP WebGUI DOM IDs, generated reference numbers, row indexes, and CSS class suffixes can change across sessions, themes, support-package levels, and screen rerenders. Do not use them as test contracts.

Prefer, in order:

1. semantic role + exact accessible name;
2. role/name scoped to a verified dialog or group;
3. stable `title` or `aria-label` for toolbar controls;
4. visible cell text for grids;
5. `sap.setGridCell(columnTitle, rowIndex, value)` for editable ALV cells whose inputs have no accessible name (see “Editable ALV grid cells” below);
6. `{ technicalName: "<ABAP_FIELD>" }` on `sap.setField(...)` when two visible fields share the same label — last-resort disambiguator via the SAP data-dictionary name inside `lsdata` (see “The `lsdata` attribute” below);
7. a narrowly-contained `sap.raw()` locator using role/name when no helper fits.

The on-screen label and DOM accessible name are often—but not always—the same. Exploration must record both when they differ. English UI language is required because labels are part of the locator contract.

## Interpreting Playwright recordings

Recordings are interaction evidence, not production specs. Classify generated code before using it:

**Preferred evidence**

- `getByRole(..., { name: "..." })` when the role and exact accessible name match the observed control;
- `getByTitle("...")` or a verified `aria-label` for toolbar actions;
- exact visible text scoped to a verified dialog, region, row, or tab strip.

**Conditionally usable evidence**

- `.first()` or `.nth()` only for a duplicate set whose order and meaning were explicitly verified and recorded in `_screens.md`;
- grid row text only when the row has stable business text and the intended column/action is unambiguous;
- Enter or other key presses as evidence of a required server roundtrip, translated through `SapSession`.

**Unsafe recording output**

- iframe names containing session timestamps, such as `itsframe1_202607...`;
- dynpro/control IDs such as `M0:46:...`;
- generated table IDs such as `tbl81` or `tbl166`;
- table-cell coordinates such as `[1,5]`, row numbers, or visual column indexes;
- CSS classes, generated suffixes, and unverified positional selectors;
- broad text filters such as `locator("div").filter({ hasText: /^Hold$/ })` when duplicates exist.

### Complex dynpro and ME21N patterns

- ITS iframe names are session-scoped. Let `SapSession` select the frame; raw code must not preserve a recorded iframe name.
- PBO/server processing can replace a table within one flow. A recording changing from `tbl81[...]` to `tbl166[...]` after Enter proves that table identity is not a contract.
- Cell coordinates encode the current layout. Personalization, hidden columns, variants, horizontal scrolling, and support-package changes can move the same business field.
- Tab labels may exist several times in visible and hidden DOM sections. Recorded `.first()`/`.nth()` is not proof of the intended tab.
- A click immediately before `fill()` is usually recorder noise; preserve it only when clicking changes mode or activates a cell editor.
- Codegen records actions, not business assertions. Expected messages, persisted state, and visible results still come from the approved TC.
- Typed materials, vendors, plants, organizations, and document numbers are examples. Build scripts must resolve them through `.data.md`, not copy them as constants.

### Stable replacement decision

For every required recorded interaction:

1. Use the matching `SapSession` helper with labels and scopes verified in `_screens.md`.
2. If no helper fits, use one narrow `sap.raw()` role/name, title, aria-label, or stable visible-text locator confirmed by live evidence.
3. If the recording exposes only an unsafe ID or coordinate, stop. Obtain focused exploration evidence or report a runtime/control-accessibility gap.

Never “improve” an unsafe ID by shortening it, regex-matching part of it, or replacing it with an unverified position.

## WebGUI structure and common traps

- The ITS application normally renders inside an iframe. Page-level locators can miss every SAP control.
- **Every server round-trip invalidates every accessibility-tree `ref` on the page.** Clicking a radio, tab, toolbar button, Execute, Enter/OK, any F-key, or any grid-cell dropdown all trigger PBO and re-render the ITS DOM. Any `ref` captured from a previous `read_page` snapshot is stale after that action — including on plain selection screens, SM30/SE16-family screens, ALV outputs, dialogs, and F4 popups. This is not SE16N-specific; it happens on every SAP screen. Re-`read_page` before the next `click_element`/`type_in_page` — never reuse an old `ref`.
- **SELECT-OPTION from/to pairs SYSTEMATICALLY produce two textboxes with the same accessible name** (e.g. both range ends of `s_site` are named `"Site"`; a `FOR sy-datum` range's ends both get the DDIC description `"ABAP System Field: Current Date of Application Server"`). This is expected, not a quirk. Record them as the from/to pair and prefer `sap.setRange(name, from, to)` (order-based, needs no technical name); reserve `nth(0)`/`nth(1)` or `{ technicalName: "S_XXX-LOW" / "-HIGH" }` for when you must use `setField` directly. Note the ugly DDIC accessible name in `_screens.md` exactly as it renders — it IS what Playwright sees.
- Dynpro blocks do not always expose an ARIA `group`. Use group scoping only after live verification.
- Radio buttons, toolbar buttons, status messages, and ALV cells vary by theme and may lack ideal ARIA roles.
- Hidden controls can remain in the DOM. Verify visibility, not only element count.
- PBO logic, GUI status, BAdIs, personalization, and variants can add, remove, rename, disable, or default controls at runtime.
- SAP file-path fields are usually textboxes, not native file inputs. Use `setField`; reserve `uploadFile` for a verified `<input type="file">`.
- **Native OS dialogs are outside the iframe and cannot be snapshotted or driven by the runtime.** `cl_gui_frontend_services=>file_save_dialog` / `file_open_dialog` and `F4_FILENAME` may pop a native Windows Save/Open dialog that is not part of the ITS DOM — accessibility snapshots and `sap.*` helpers cannot reach it, and there is no runtime helper for it. During exploration mark such a screen NOT observed; in the plan such a path is normally `manual` (the human picks the file). A path that only needs the RESULTING file path typed into a textbox is different — that's a normal `setField` and IS automatable; only the OS picker itself is the un-automatable part.
- **Dialog-level Cancel ≠ screen-level Back/Exit/Cancel.** A dialog's own `Cancel` closes just that dialog (safe). The main toolbar `Back` (F3) / `Exit` (F15) / `Cancel` (F12) mean "leave this screen/transaction" and where they land is PF-STATUS-dependent (previous screen, Easy Access, or a save prompt). Always re-`read_page` after a screen-level Back/Exit/Cancel; recover a lost position by reopening `&~transaction=<TCODE>`. Never use keyboard Escape to close a dialog — it may exit the whole transaction.
- **Overflow toolbar (`>>`) hides buttons from the snapshot.** A narrow toolbar collapses its extra buttons (often Execute/F8) behind a `>>` chevron, and those buttons are absent from the accessibility tree until `>>` is clicked. During exploration, expand `>>` and re-`read_page` before concluding a button is missing. In a spec you do NOT need to click `>>` — `clickButton`/`execute` match by `title` and force-click even a visually-collapsed toolbar item — but the button must have been recorded in `_screens.md`.
- Wait for WebGUI server/busy state and DOM stability through `SapSession`; do not add arbitrary sleeps.

## SAP selection screens (SE38 / SUBMIT with SELECTION-SCREEN)

Selection screens — the initial parameter screen of every SAP report — behave differently from dynpro maintenance screens (ME21N/MIGO/VA01) and are the source of the two most common `build-scripts` mistranslations. Rules for the whole family:

- **No ARIA `group` role.** ITS renders selection-screen blocks (`SELECTION-SCREEN BEGIN OF BLOCK … WITH FRAME TITLE`) as an HTML `<table>` with a text caption — NO `role="group"` container is emitted. Passing `{ group: "..." }` to `sap.setField`/`check`/`selectRadio` here makes the helper time out because the scope never matches. Omit the option entirely; the plain accessible name is the correct locator. Record the block title in `_screens.md` as context (for `## Selection screen state at Execute` grouping in the TC), NOT as a scope Playwright can use.
- **`PARAMETERS` = single textbox → `sap.setField(label, value)`.**
- **`SELECT-OPTIONS` = TWO textboxes with the same accessible name → `sap.setRange(label, from, to)`.** The runtime helper handles the from/to order and both-labels-identical trap. Even a case that only fills the low end must use `setRange("F", value, "")`. Never `setField` a range field; it triggers `strict mode violation: 2 elements` at runtime and the case fails for the wrong reason. The systematic same-name behaviour is documented under "SELECT-OPTION from/to pairs" above.
- **Multiple-selection button (the little arrow next to a range) opens a dialog** with tabs for `Single vals`/`Ranges`/`Exclude`. Record the tabs in `_screens.md` if a case uses them; drive them with `sap.clickTab` inside the dialog.
- **F4 value help** works via `sap.pickFromValueHelp(fieldName, valueText)` — no group scope needed for the same reason as above.
- **Radio groups and checkboxes.** ITS may not expose a `radiogroup` role; the individual radios still work by accessible name via `sap.selectRadio(name)`. Confirm live during `explore-ui`.
- **Variant list (`Save as Variant`, `Get Variant`)** are toolbar buttons on the selection screen — accessible by `title` via `sap.clickButton`; usually not needed unless the TC references a specific variant.

Dynpro screens (ME21N/MIGO/VA01/…) DO expose real groups/regions in many places — `{ group: "..." }` is legitimate there when `_screens.md` records it. The rule is: emit `group` when the map records it, omit otherwise; do not emit it reflexively.

## Header tab strips

Dynpro screens like ME21N, MIGO, VA01, and every FI/CO document use a tab strip to switch between header sections (Delivery/Invoice, Conditions, Texts, Org. Data, …). ITS renders each tab as:

```html
<div class="lsTbsItem--scrollable lsTbsv5-Item">
  <div class="lsTbsv5-ItemTitle">Org. Data</div>
  <div class="lsTbsv5-ItmWidthHelper">Org. Data</div>
  <!-- hidden duplicate for layout -->
</div>
```

Key mechanics:

- There is **no** `role="tab"`, `aria-selected`, `title`, or `aria-label` on the tab. The label text inside `.lsTbsv5-ItemTitle` is the only stable anchor.
- The parent `.lsTbsItem--scrollable` also contains a hidden `.lsTbsv5-ItmWidthHelper` with the SAME text (used for width measurement). A plain `hasText: /^Label$/` filter matches the parent twice and Playwright strict-mode fails.
- Selected state is expressed via a class match: `lsTbsv5-ItemSel`, `lsTbsv5-FirstItemSel`, or `lsTbsv5-LastItemSel`. There is no ARIA equivalent.
- Clicking a tab triggers a server round-trip (PBO). The whole content area is re-rendered; any table or subscreen ID captured before the click is invalid after.
- The renderer version prefix (`lsTbsv5-`) can change with support packages. Match on `class*="lsTbsv"` to survive a v6 swap.

The `sap.clickTab(name)` helper handles all of this: it tries `role=tab` first (Fiori), then falls back to matching the ItemTitle by exact text and DOM-clicking its closest `lsTbsItem` ancestor. Never open-code a tab click; never use `clickButton` on a tab (buttons and tabs have different DOM contracts even though both look clickable).

**Live-exploration checklist for a tab strip**: record every tab label EXACTLY as displayed (including punctuation like the period in "Org. Data" or the slash in "Delivery/Invoice"), the currently-selected tab on entry to the screen, and whether the tab strip is at the header or item-detail level (both exist on ME21N).

## Editable grids — TWO different renderers, do not assume one

WebGUI renders editable tables with one of **two different DOM schemes**, and they are NOT interchangeable. Record which one a screen uses during exploration, because a locator built for one fails silently on the other:

1. **Dynpro table control** (classic module-pool tables) — cell ids look like `<prefix>[row,col]` and the editor is `<prefix>[row,col]_c`; the column header `<th>` carries a `title`. This is the scheme detailed below.
2. **`CL_GUI_ALV_GRID` grid** (the SAP control-framework ALV) — cell/column ids follow a different scheme (a grid container id with `#`-separated row/column parts, e.g. `grid#…#r,c#…`), the header often has NO `title`, and — critically — after you type a value the grid only moves it into its internal buffer on a **change/blur/Enter event**. A bare `fill()` sets the DOM value but the grid never reads it, so on commit the cell reverts and the "test" runs on empty data.

**Always drive editable cells through `sap.setGridCell(columnTitle, rowIndex, value)`, never a hand-rolled `sap.raw()` `fill()`.** The helper detects the renderer, finds the column by its header text/title, clicks the cell to materialise the editor, fills, AND fires the commit the ALV grid needs. A raw `fill()` on a grid input is the specific mistake that produces green-on-empty results. If `setGridCell` cannot drive a particular grid, that is a runtime gap to report (`helpers-reference`) — not a cue to reach for `raw()`.

The dynpro table-control scheme in detail:

Editable ALV/table cells only materialize an `<input>` **after** the user clicks or tabs into them. Structure:

```html
<table id="tbl317">
  <!-- outer container, prefix changes per session -->
  <table id="tbl317-mrss-hdr-none-content">
    <!-- header row(s), scrollable columns -->
    <th id="tbl317[0,5]" title="Article">
      <!-- column header, title is stable -->
      <table id="tbl317-mrss-cont-none-content">
        <!-- data rows, scrollable columns -->
        <td id="tbl317[1,5]"><!-- row 1, col 5 --></td>
      </table>
    </th>
  </table>
</table>
```

After a real click on the `<td>`, SAP injects `<input id="tbl317[1,5]_c">` inside it and focuses the input. The input has **no** accessible name and **no** `title` — `sap.setField` can't find it. The column title lives on the header `<th>`, not the cell input.

Key mechanics:

- The `tbl<N>` numeric prefix changes across sessions AND across tab switches within one session. Never hardcode it — always derive it from the current header `<th title="...">` element.
- Row indexing follows SAP's own `[row,col]` numbering: row 0 is the header row; visible data rows start at 1.
- Personalization, hidden columns, layout variants, and horizontal scrolling change column INDEXES. Look up the column by `title` on every call.
- Columns scrolled off-screen are removed from the DOM — `th[title="..."]` returns nothing for them. When a case needs a currently-off-screen column, either reset the layout in setup or scroll the grid first.
- A DOM `<td>.click()` via `evaluate()` does NOT reliably trigger SAP's event pipeline. A Playwright `.click()` (real mouse event) does.
- The grid is split into 4 quadrants for frozen-column × scrollable × header/body: `<prefix>-mrss-hdr-left-content`, `-hdr-none-content`, `-cont-left-content`, `-cont-none-content`. All four share the same `<prefix>[r,c]` cell-id scheme, so the helper doesn't need to distinguish between them.

The `sap.setGridCell(columnTitle, rowIndex, value)` helper handles the whole flow: find header by title, derive `tbl<N>` prefix + column index, click the target row-cell, wait for the input to materialize, fill.

**Live-exploration checklist for an editable grid**: record WHICH renderer it is (dynpro table control vs `CL_GUI_ALV_GRID` — check a cell id in the snapshot: `[r,c]` vs a `#`-separated grid id); the column `title`/header text for every editable column the case touches (case-sensitive, matches the visible label); how many data rows are visible by default (grids often show 8–10); any personalized variant that changes column order; and whether all columns of interest are visible without horizontal scroll. (`setGridCell` handles both renderers — you record the renderer so Phase 6 knows the grid is ALV-type and never hand-rolls a `fill()`.)

Read-only grids (SE16, ALV output of a report) usually work with `sap.expectGridHasRow(text)` or `sap.selectGridRowByText(text)` because their cells carry text content, not editable inputs.

## The `lsdata` attribute

Every ITS input/control has an `lsdata` attribute whose value is a JSON blob:

```html
<input
  title="Purchasing Organization"
  lsdata='{"1":"FREETEXT",...,"21":{"SID":"wnd[0]/usr/.../ctxtMEPO1222-EKORG","Type":"GuiCTextField",...}}'
/>
```

The `SID` string embeds the ABAP screen-element path, which ends with `<control-type><TABLE>-<FIELD>`. The trailing `-<FIELD>` piece is the SAP data-dictionary field name (`EKORG`, `EBELN`, `LIFNR`, `WERKS`, ...) and is stable across sessions, themes, and support packages because it comes from the DDIC, not from the DOM renderer.

When to use `{ technicalName: "<FIELD>" }`:

- Two visible fields on the same screen share the same accessible name (e.g. a from/to pair for the same field, appearing twice due to a subscreen).
- The accessible name is missing or localised in a non-English language despite the SU3 English requirement.
- Recording evidence proves that the accessible name changes across support packages while the ABAP field name doesn't.

When NOT to use it:

- The label is unique on the screen — role+name already works and is more readable.
- The value you want to match on is a business term ("Vendor", "Plant") that's already the accessible name.
- You don't have concrete evidence of the ABAP field name from ADT or live exploration — guessing produces silent selector drift.

`sap.setField(..., { technicalName: "..." })` uses the technical name whenever the accessible name is NOT a unique match — i.e. when it matches multiple fields (the duplicate-label case this is designed for) OR matches nothing. It never overrides a UNIQUE role+name match, so the helper stays role-first: a clean single label wins, but the moment a label is ambiguous the technical name takes over instead of silently filling the first match. If the label is ambiguous and no `technicalName` is supplied, `setField` throws and asks for one (or a verified `nth`) rather than guessing — so a from/to pair with identical labels can't silently collapse into one field.

## Required live-exploration record

For every screen/dialog used by a case, record in `_screens.md`:

- screen/dialog title and trigger path;
- control role, visible label, and differing accessible name;
- containing group/dialog only when verified;
- initial value, checked/selected state, visibility, and enabled state;
- duplicate-label disambiguation, AND the `technicalName` for any control with no usable accessible name — read it DIRECTLY from the control's live `lsdata` SID in the browser snapshot (the trailing `-<FIELD>`), which is the fastest and most accurate source; ADT confirmation is a fallback, not the primary path. A nameless control with no discoverable technical name is a blocker to escalate, never a positional-locator guess;
- toolbar buttons and their `title`/`aria-label`;
- tab-strip labels EXACTLY as displayed, and which tab is initially selected;
- ALV column names and stable row text used for assertions, plus editable column `title` values for grid-cell cases;
- controls added or changed after a radio/checkbox/action;
- whether a file field is a textbox or native file input.

Never derive `_screens.md` from ABAP source alone.

## Popup guard and auto-dismissed dialogs

`SapSession` runs `dismissKnownPopups` **before and after every action**. It only auto-clicks dialogs whose title matches a curated allow-list of "safe-to-dismiss" interrupters — anything else is left alone so real bugs surface as test failures.

Current allow-list of auto-dismissed dialogs:

- `License` → Continue — SAP EULA reminder
- `System messages` → Continue — SM02 broadcasts
- `Multiple Logon` → "Continue with this logon and end any other logons in the system" — keeps parallel runs working. **Note it ends the user's OTHER sessions too**, including a WebGUI tab they have open, because tests run under the developer's own SAP user unless a dedicated test user is configured.
- `Copyright` → Continue — legal notice
- `Data Privacy` → Accept — GDPR consent on modern S/4
- `Password` → Cancel — password-expiration prompts; NEVER let a test change credentials silently

Deliberately NOT on the list:

- **`Information`** — appears on countless real dialogs users need to see or answer. Handle from the spec.
- **`Exit Document` / "Do you want to save?"** — tests may legitimately want to save unsaved data (e.g. a case that verifies the save path). If your test needs to leave without saving, click the button explicitly from the spec via `sap.clickButton("No", { dialog: "Exit Document" })`. If your test needs to save, call `sap.clickButton("Yes", { dialog: "Exit Document" })`. If a SPECIFIC test wants auto-dismissal (e.g. teardown), pass it as an `extraInterrupter` for that test only.

Match titles must be specific enough to avoid false positives.

Key behaviour:

- **Match on title only** (case-insensitive substring). The dialog TITLE is read from the ITS `.urPWTitleText` element or a Fiori `aria-label`.
- **Button matching is exact**: tries `[title="X"]` first (the only reliable strategy for ITS `<div title="Yes|No|Cancel">` buttons), then `[aria-label="X"]`, then `getByRole("button", { name: X, exact: true })` for Fiori.
- **`getByRole("button", { name: … })` returns ZERO for ITS action buttons.** They are `<div>` with `title="X"` and no ARIA role. The guard falls through to `[title=…]` automatically; you MUST do the same in any `sap.raw()` popup handling.
- **Recognised-but-unclickable is a hard error.** If a dialog matches a known interrupter but the button can't be clicked (label changed in your SAP version), the guard THROWS with a clear message. Fix it by adding an `extraInterrupters` entry with the correct label, don't work around it.
- **Unnamed dialogs are ignored.** F4 value-help popups have no matchable title, so they never trigger dismissal.

**Adding a program-specific interrupter**: pass `extraInterrupters` to `new SapSession(...)`. Example: a custom "Reprint output?" dialog on your Z-report can be auto-dismissed with `{ matchTitle: "Reprint output", dismissButton: "No", note: "..." }`.

## SAP runtime errors and short dumps

`SapSession` also runs `detectRuntimeError` after every action. This catches three failure modes that SAP does NOT expose as dialogs:

- **`dump`** — classic ABAP short dump ("ABAP Runtime Error", "Runtime Errors", "The current ABAP program terminated..."). Full-page replacement, usually red-themed.
- **`its`** — ITS/ICM protocol error ("500 Internal Server Error", "ITS Error"). Usually appears after a session or network glitch.
- **`logon`** — session dropped, browser shows a login screen ("SAP NetWeaver Logon", "Please log on again", or any page with a visible password box). Under `playwright_test` this means the automatic reentrance-ticket sign-in did not produce a usable session — check the `[sso]` lines in the `ABAP FS` output channel. It can also mean the session simply timed out mid-run.

When detected, the guard captures evidence and throws with `kind`, title, URL, and a 500-char body snippet — never silently continue.

**Silent transaction bounce** — SAP sometimes doesn't produce ANY error and just drops the user back to SAP Easy Access (SAPMSYST/40 / S000) when a transaction doesn't exist in this client or the user lacks `S_TCODE`. `sap.openTx(...)` verifies the target loaded via `detectSilentBounce` and throws a specific `S_TCODE`/authorisation hint.

**Explicit assertion**: use `sap.expectNoRuntimeError()` at a point where dump-freedom is part of the test contract (e.g. after a long batch execution). Redundant most of the time — the `guarded()` path already checks — but useful for post-condition assertions.

## Current helper reliability

The helper strategy—semantic role and accessible name first—is substantially more stable than generated WebGUI IDs. It is not universally reliable without live verification:

- `setField` and checkbox helpers depend on usable accessible names.
- `setField(..., { technicalName })` fallback depends on a real `lsdata` SID; verify the ABAP field name from ADT before adding it.
- group scoping fails where ITS exposes no group role.
- radio fallback behavior is theme-specific and can be ambiguous with duplicate labels.
- toolbar fallback depends on stable English `title`/`aria-label`.
- `clickTab` depends on exact tab-label text (case, punctuation, non-breaking spaces).
- `setGridCell` requires the target column to be currently visible; scrolled-off columns are removed from the DOM.
- ALV role/text structure varies by renderer and theme.
- `uploadFile` should be trusted only after confirming a native file input.
- iframe selection targets the SAP content frame (`#ITSFRAME1`) specifically, not merely "the first iframe" — the page also has `ITSTERMFRAME` ("Blank ITS Page"), and picking it by DOM order made assertions query an empty document and report `Last seen: []` while the message was plainly on screen. Unusual full-page redirects or shell layouts still need a headed verification run.
- popup-guard only auto-dismisses titles on the curated list; program-specific interrupters need `extraInterrupters` at the call site.
- runtime-error detection uses signature substrings — a customised dump theme or translated error text may slip through; add signatures if you see one repeatedly missed.

Therefore, use helpers by default, but treat `_screens.md` plus the first headed run as required proof for each new screen pattern. A helper failure is not permission to switch to generated IDs.

## Locator failure patterns

Use these patterns during `run-scripts` diagnosis:

- recorded iframe suffix no longer matches → session-scoped locator leaked into the spec;
- table ID changes after Enter → PBO/rerender invalidated a generated locator;
- strict-mode failure on repeated tab text → hidden `ItmWidthHelper` duplicate or duplicate labels need `sap.clickTab` (which handles this) or a verified scope;
- correct row but wrong cell after layout change → positional table coordinates leaked into the spec; `setGridCell` avoids this because it looks up the column by title on every call;
- `setGridCell` "column header not found" after a tab or layout change → the target column scrolled off-screen or was removed by a layout variant;
- label lookup fails despite visible text → accessible name differs from the visible label, the control needs a verified container scope, or two fields share the label and need `technicalName` disambiguation;
- test fails with `openTx("...") silently bounced to SAPMSYST/40` → the transaction doesn't exist in this client, the user lacks `S_TCODE` for it, or a prior transaction is still held (check SM50/SU53);
- test fails with `Popup guard: recognised interrupter "..." but could not click its "..." button` → the button label changed in your SAP version; add an `extraInterrupters` entry with the correct label, don't disable the guard;
- test fails with `SAP runtime error detected (dump|its|logon): "..."` → real short dump / session loss / ITS error; investigate the SAP-side cause (ST22 for dumps, SM21 for session, SMICM for ITS) before touching the test.

Correct the observed control in `_screens.md` (via `explore-ui`), then follow `build-scripts` to rebuild the spec. Do not patch the locator ad hoc during Phase 7 (run-scripts) diagnosis.

## Before writing or approving a script

Confirm:

- every helper label comes verbatim from `_screens.md`;
- every scope was observed live;
- duplicate labels have deterministic disambiguation;
- no generated IDs, SAP ref numbers, unstable CSS suffixes, or guessed positions are used;
- dynamic/default state is explicitly handled;
- a first run will be headed and failures will be diagnosed from screenshots/manifest before changing locators.
