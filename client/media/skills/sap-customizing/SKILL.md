---
name: sap-customizing
description: Navigate and understand SAP Customizing (SPRO/IMG). Use when the user asks about customizing settings, SPRO activities, configuration tables, maintenance views, view clusters, or needs to read/understand any customizing data. This skill teaches how to systematically trace from an SPRO activity to the actual tables where config data is stored, and how to find the SPRO menu path for any activity. Load this skill whenever customizing, SPRO, IMG, configuration, or settings maintenance is involved.
argument-hint: '[customizing topic or SPRO activity to investigate]'
user-invocable: true
disable-model-invocation: false
---

# SAP Customizing — Tracing SPRO to Data

## Critical Warning

**Your training data about SAP customizing is almost certainly wrong.** Do NOT guess which tables store which customizing data. Follow the lookup procedures below to discover the truth from the system itself.

**Always read table structures with `get_object_lines` before querying.** Never hardcode field names from memory.

**Text fields are case-sensitive.** Use aggressive wildcards: `%aterial%ype%` finds "Material Types", "material type", etc.

**Minimize SQL round-trips.** Use JOINs to combine lookups into single queries.

**Present only useful information to the user.** Internal IDs like activity IDs (`SIMG_CFMENUOLMSOMS2`), tree GUIDs (`368DDFAB...`), and node IDs are technical plumbing — never include them in your answer. Only show the user: SPRO menu path, table names, view/cluster names, transaction codes, and descriptions.

---

## Metadata Tables

### IMG Activity Layer (SPRO tree → activity)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **CUS_IMGACH** | IMG activity header | `activity`, `c_activity` (links to CUS_ACTH), `tcode` |
| **CUS_IMGACT** | IMG activity texts (language-dependent) | `spras`, `activity`, `text` |

### Customizing Activity Layer (activity → objects)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **CUS_ACTH** | Activity header | `act_id`, `act_type`, `tcode` |
| **CUS_ACTT** | Activity texts (language-dependent) | `spras`, `act_id`, `text` |
| **CUS_ACTOBJ** | **Core** — links activities to maintenance objects | `act_id`, `objecttype`, `objectname`, `tcode` |

**CUS_ACTH.act_type:** `C` = customizing (most common), `E` = BAdI definition, `I` = BAdI implementation. Note: filtering by `act_type = 'E'` is unreliable — many BAdI activities use `act_type = 'C'`. To find BAdIs, search CUS_IMGACT text for `%BAdI%` or `%Business Add-In%`. This mainly works for IS solutions (IS-Retail, IS-Utilities, HR). Core modules (MM, FI, SD, PP) often do not register BAdIs in the IMG at all — for those, use SE18 directly with patterns like `MB_*`, `ME_*`, `MM_*`.

**CUS_ACTOBJ.objecttype** (domain OB_TYP):

| Value | Meaning | What `objectname` contains |
|-------|---------|---------------------------|
| `V` | **View** | Maintenance view name (e.g., `V_T001W`). Via SM30 or dedicated tcode |
| `C` | **View Cluster** | Cluster name (e.g., `MTART`). Via SM34 or dedicated tcode |
| `S` | **Table with Text Table** | Table name directly. Via SM30 |
| `T` | **Individual Transaction** | Logical object (often `SNUM`). The `tcode` field has the transaction |
| `L` | **Logical Transport Object** | Transport object type. The `tcode` field has the transaction |
| `D` | **Dummy Object** | Usually `IMGDUMMY`. The `tcode` field has the transaction |

### View Cluster Resolution

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **VCLDIR** | Cluster directory | `vclname`, `exitprog` |
| **VCLSTRUC** | Cluster structure — views inside a cluster | `vclname`, `object`, `objpos`, `dependency`, `startobj` |

**VCLSTRUC.dependency** (domain OBJDEP): `R` = root/header, `S` = dependent on one parent, `M` = dependent on multiple parents. **startobj** `X` = initial object shown.

### View → Base Table Resolution

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **DD26S** | View base tables | `viewname`, `tabname`, `as4local` (use `A`), `tabpos` (1 = primary) |

ABAP FS cannot read view structures, but can read tables. Always resolve views to their base tables via DD26S, then use `get_object_lines` on the table.

### Transaction Resolution

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **TSTC** | Tcode → program | `tcode`, `pgmna` |
| **TSTCT** | Tcode descriptions | `sprsl`, `tcode`, `ttext` |
| **TSTCP** | Tcode parameters | `tcode`, `param` |

**TSTCP.param** for SM30 wrappers: `/*SM30 VIEWNAME=<view>;UPDATE=X;` — extract `VIEWNAME` to find the maintained view.

### SPRO Tree Hierarchy

The SPRO tree is stored across multiple linked sub-trees:

| Table | Purpose | Key Fields |
|-------|---------|------------|
| **TNODEIMG** | Tree nodes (folders + activity leaves) | `tree_id`, `node_id`, `parent_id`, `node_type`, `reftree_id` |
| **TNODEIMGT** | Node texts — holds **folder/section names**, NOT activity names | `tree_id`, `node_id`, `spras`, `text` |
| **TNODEIMGR** | Node references — links leaf nodes to IMG activities | `node_id`, `ext_key`, `ref_type`, `ref_object` |

**CRITICAL:** TNODEIMGR has **NO `tree_id` column** — it only has `node_id`, `ext_key`, `ref_type`, `ref_object`. Never try to JOIN it with TNODEIMG/TNODEIMGT on tree_id.

**CRITICAL:** TNODEIMGT contains **folder labels** ("Material Types", "Basic Settings"), NOT activity names ("Define Attributes of Material Types"). Activity names live in CUS_IMGACT. To find a leaf node for a known activity, use TNODEIMGR (see Procedure 3).

**node_type values:** `IMG0` = folder node, `IMG` = activity leaf (text in CUS_IMGACT, not TNODEIMGT), `REF` = reference to a sub-tree (follow `reftree_id`).

**TNODEIMGR.ref_type:** `COBJ` = customizing activity ID (matches CUS_ACTOBJ.act_id), `ACTI` = IMG activity ID (matches CUS_IMGACH.activity, prefixed with `SIMG`).

Main SPRO tree ID is `368DDFAB3AB96CCFE10000009B38F976` ("SAP Customizing Implementation Guide") — this is SAP-delivered and consistent across systems. If unsure, look it up:
```sql
SELECT t~id FROM ttree AS t INNER JOIN ttreet AS n ON t~id = n~id
  WHERE n~spras = 'E' AND t~type = 'IMG' AND n~text LIKE '%AP Customizing Implementation Guide'
```
Its top-level children (Logistics - General, Materials Management, FI, etc.) are `REF` nodes pointing to component sub-trees via `reftree_id`.

### Domain Value Lookup

**DD07T** decodes any coded field: query with `domname`, `ddlanguage = 'E'`, `as4local = 'A'` to get `domvalue_l` → `ddtext`.

---

## Lookup Procedures

### 1. Find activity by description + get storage objects (combined)

```sql
SELECT a~activity, t~text, a~c_activity, o~objecttype, o~objectname, o~tcode
  FROM cus_imgach AS a
  INNER JOIN cus_imgact AS t ON a~activity = t~activity
  INNER JOIN cus_actobj AS o ON a~c_activity = o~act_id
  WHERE t~spras = 'E'
    AND t~text LIKE '%your search%'
```

Then branch by `objecttype`:

**V (View)** → resolve to base table:
```sql
SELECT d~viewname, d~tabname, d~tabpos FROM dd26s AS d
  WHERE d~viewname = '<objectname>' AND d~as4local = 'A'
  ORDER BY d~tabpos ASCENDING
```
The `tabpos = 1` row is the primary base table. Run `get_object_lines` on it and query directly.

**C (View Cluster)** → get constituent views, then resolve each:
```sql
SELECT v~vclname, v~exitprog, s~object, s~objpos, s~dependency, s~startobj
  FROM vcldir AS v
  INNER JOIN vclstruc AS s ON v~vclname = s~vclname
  WHERE v~vclname = '<objectname>'
  ORDER BY s~objpos ASCENDING
```
Each `s~object` is a view — resolve via DD26S as above.

**S (Table with Text Table)** → `objectname` IS the table. Read with `get_object_lines` directly. Text table is usually `<table>T`.

**T / D / L** → the `tcode` is key. When `objectname = 'SNUM'`, this is a number range activity — data is in table `NRIV` (number range intervals), not a normal config table. The tcode (e.g., `OMH6`, `MMNR`) opens the number range maintenance screen. For other standalone tcodes, check TSTCP to see if it wraps SM30:
```sql
SELECT t~tcode, t~param FROM tstcp AS t WHERE t~tcode = '<tcode>'
```
If param contains `VIEWNAME=`, extract it and resolve via DD26S. If TSTCP has no entry (standalone transaction), look up the tcode in TSTC for its program — but note that for standalone transactions (objecttype T/D), the underlying table often cannot be determined from metadata alone. You may need to search the program's source code or ask the user.

### 2. Reverse lookup: table/view → SPRO activity

Often faster than forward text search (Procedure 1) when you know the table/view name, especially when forward search returns noisy results from many modules.

```sql
SELECT o~act_id, o~objecttype, o~objectname, o~tcode, t~text
  FROM cus_actobj AS o
  INNER JOIN cus_actt AS t ON o~act_id = t~act_id
  WHERE t~spras = 'E'
    AND o~objectname LIKE '%<table_or_view>%'
```

**If this returns 0 rows**, the table may be a secondary member inside a view cluster (CUS_ACTOBJ stores only the cluster name, not individual member tables). Find the cluster via VCLSTRUC + DD26S:
```sql
SELECT s~vclname, s~object FROM vclstruc AS s
  INNER JOIN dd26s AS d ON d~viewname = s~object
  WHERE d~tabname = '<your_table>' AND d~as4local = 'A'
```
Then search CUS_ACTOBJ for the `vclname` value with `objecttype = 'C'`.

### 3. Find SPRO menu path for an activity

The SPRO tree is split into sub-trees linked by REF nodes. Building the full path requires walking upward through multiple sub-trees. Expect 3-4 queries per tree level, and 3-5 tree levels — so roughly 10-15 queries total.

**Step A** — Find the tree node for a known activity ID (from Procedure 1). Use TNODEIMGR — do NOT search TNODEIMGT by activity name (it only has folder labels).

**Step A.1** — Get all node_ids for the activity from TNODEIMGR:
```sql
SELECT r~node_id FROM tnodeimgr AS r
  WHERE r~ref_type = 'COBJ' AND r~ref_object = '<activity_id>'
```
This often returns **multiple rows** — the same activity appears in several SPRO locations.

**Step A.2** — For each node_id, look it up in TNODEIMG to get tree_id and parent_id. **Some node_ids from TNODEIMGR are orphans** (they exist in TNODEIMGR but not TNODEIMG) — skip any that return 0 rows:
```sql
SELECT n~node_id, n~parent_id, n~tree_id, n~node_type
  FROM tnodeimg AS n WHERE n~node_id = '<node_id_from_A1>'
```
Pick the node that resolves successfully and belongs to a module-relevant sub-tree. If unsure which, try each until one produces a complete path to the SPRO root.

To search by **folder name** instead (not activity name), search TNODEIMGT:
```sql
SELECT n~node_id, n~parent_id, n~tree_id, t~text
  FROM tnodeimg AS n
  INNER JOIN tnodeimgt AS t ON n~node_id = t~node_id AND n~tree_id = t~tree_id
  WHERE t~spras = 'E' AND t~text LIKE '%folder name%'
```

**Step B** — Walk up `parent_id` within the same `tree_id`, collecting folder texts from TNODEIMGT:
```sql
SELECT n~node_id, n~parent_id, t~text
  FROM tnodeimg AS n
  INNER JOIN tnodeimgt AS t ON n~node_id = t~node_id AND n~tree_id = t~tree_id
  WHERE t~spras = 'E' AND n~tree_id = '<tree_id>' AND n~node_id = '<parent_id>'
```
Repeat until `parent_id` is empty (you've hit the sub-tree root).

**Step C** — Jump to the parent tree. Find which REF node references this sub-tree. First try without text JOIN (some REF nodes lack TNODEIMGT text):
```sql
SELECT n~node_id, n~parent_id, n~tree_id
  FROM tnodeimg AS n
  WHERE n~reftree_id = '<current_tree_id>' AND n~node_type = 'REF'
```
If this returns **multiple rows**, they are different SPRO locations linking to the same sub-tree — pick the one whose tree_id traces back to the main SPRO root. If this returns **0 rows**, the sub-tree is an orphaned copy with no parent link — go back to Step A and try a different node_id for the same activity.

Once you have the REF node, continue walking up `parent_id` in THAT tree (Step B again). Get the REF node's parent folder text from TNODEIMGT to add to your path.

**Step D** — Repeat Steps B-C until you reach the main SPRO tree root (`368DDFAB3AB96CCFE10000009B38F976`).

Assemble the collected texts in reverse order: `SAP Customizing Implementation Guide > Logistics - General > Material Master > Basic Settings > Material Types > Define Attributes of Material Types`.

### 4. Look up domain coded values

```sql
SELECT d~domvalue_l, d~ddtext FROM dd07t AS d
  WHERE d~domname = '<DOMAIN_NAME>' AND d~ddlanguage = 'E' AND d~as4local = 'A'
```

---

## Worked Example: Material Types

User asks: "Where is material type customizing stored?"

**Find activity + storage:**
```sql
SELECT a~activity, a~c_activity, t~text, o~objecttype, o~objectname, o~tcode
  FROM cus_imgach AS a
  INNER JOIN cus_imgact AS t ON a~activity = t~activity
  INNER JOIN cus_actobj AS o ON a~c_activity = o~act_id
  WHERE t~spras = 'E' AND t~text LIKE '%aterial%ype%'
```
Result: objecttype=`C`, objectname=`MTART` — a view cluster.

**Get cluster views:**
```sql
SELECT v~vclname, v~exitprog, s~object, s~objpos, s~dependency, s~startobj
  FROM vcldir AS v INNER JOIN vclstruc AS s ON v~vclname = s~vclname
  WHERE v~vclname = 'MTART' ORDER BY s~objpos ASCENDING
```
Result: `T134` (R=root, Material types) and `VT134M` (S=child, Quantity/value updating). Exit program: `MMMTARTEXIT`.

**Resolve to base tables:**
```sql
SELECT d~viewname, d~tabname, d~tabpos FROM dd26s AS d
  WHERE d~viewname IN ('VT134M', 'T134') AND d~as4local = 'A'
```
Result: T134 → `T134` (tabpos=1), VT134M → `T134M` (tabpos=1). Read with `get_object_lines` and query directly.

Note: a reverse lookup on `CUS_ACTOBJ` for `objectname LIKE '%T134M%'` returns **0 rows** — because CUS_ACTOBJ stores the cluster name `MTART`, not individual member tables. To find T134M's SPRO entry, search VCLSTRUC+DD26S as shown in Procedure 2.

---

## Tips

- **objecttype V is the most common** (~43k entries). Most customizing is SM30-based view maintenance.
- When `tcode` = `SM30` in CUS_ACTOBJ, it's generic. A different tcode may be an SM30 wrapper (check TSTCP) or standalone.
- Some SPRO activities have multiple CUS_ACTOBJ entries — the activity maintains data in multiple places.
- For `objecttype = S`, text tables conventionally follow `<table>T` (e.g., `T134` → `T134T`), but verify.
- View cluster exit programs (VCLDIR.exitprog) contain validation logic worth reading.
- The SPRO tree walk (Procedure 3) requires ~3-4 queries per tree level (TNODEIMGR lookup, TNODEIMG, TNODEIMGT, then REF hop). Typical depth is 3-5 tree levels = 10-15 queries total.
- Forward text search (Procedure 1) can be noisy — common terms like "payment terms" match HR, payroll, and industry solutions. If you get too many results, switch to reverse lookup (Procedure 2) with a known table/view name.
- Activities frequently appear in **multiple SPRO locations** (e.g., "Define Plant" appears in 7 places). The canonical path is usually under Enterprise Structure for org-level settings, or under the module-specific tree for functional settings.
- Forward text search (Procedure 1) can be noisy for common terms — if it returns too many results from unrelated modules, try reverse lookup (Procedure 2) with the table/view name instead.
