# S/4HANA Readiness Dashboard

Visualize custom code compatibility with S/4HANA using data from SAP's Custom Code Migration tool (transaction SYCM).

## Prerequisites

- Run transaction **SYCM** on your SAP system first — the dashboard reads the analysis tables it populates (`sycm_sitem`, `sycm_cust_refs`, and related tables)
- Works on ECC systems being analyzed for S/4HANA migration

## Opening the Dashboard

Three ways to load it:

| Method | Steps |
|--------|-------|
| Activity Bar | **ABAP FS** panel → **S/4HANA Readiness** section → click **Load Dashboard** |
| Command Palette | `Ctrl+Shift+P` → `ABAP FS: S/4HANA Readiness - Load` |
| Copilot Chat | Ask: *"Load the S/4HANA readiness dashboard"* |

## Reading the Results

The dashboard shows a tree grouped by **simplification item** (SAP Note):

```
DRS310 — 156 references in 42 items
├── Summary
├── 2830416 — Remove usage of BSEG (12 refs)
│   ├── ZMY_REPORT
│   └── ZCL_FINANCE
├── 2780106 — ... (5 refs)
│   └── ZFG_CUSTOM
└── Unlinked References
```

- **Root node** — your connection ID with a total count
- **Simplification Item nodes** — each SAP Note that affects your code, with reference count
- **Custom object nodes** — your Z/Y objects that need to be changed
- **Unlinked References** — references that couldn't be matched to a simplification item

## Working with Results

**Open an object for editing**
Click any custom object node — it opens directly in the editor.

**Run ATC analysis on an object**
Right-click a reference → **Run ATC** — runs ATC checks scoped to that object.

**Get a Copilot fix suggestion**
Right-click a reference → **Ask Copilot to Fix** — opens a Copilot prompt pre-loaded with the compatibility issue details.

**Open the linked SAP Note**
Right-click a simplification item → **Open SAP Note** — opens the note in your browser.

**Filter by name pattern**
Use the filter icon and enter a wildcard pattern, e.g. `Z*PRICING*` or `Y*`, to narrow the list.

**Refresh / Clear**
Use the **Refresh** button to reload from SAP, or **Clear** to remove the dashboard data.

**Multiple systems**
Load dashboards from several connected systems simultaneously — each appears under its own root node.

## ATC Integration

For full readiness analysis, combine the dashboard with ATC:

1. Set your ATC check variant to an S/4HANA readiness variant (e.g. `S4HANA_READINESS`)
2. In your connection settings, set the `atcVariant` property to run this variant by default
3. Use the dashboard to spot affected objects, then right-click → **Run ATC** for detailed per-object findings
