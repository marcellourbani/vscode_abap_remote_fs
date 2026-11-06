# Review and Export Repository Usage Results

Use the Inventory and Issues tabs together. Inventory shows the usage decision and its evidence. Issues shows input or lookup gaps that can affect that decision.

## Read the Inventory tab

| Column | What it tells you |
|---|---|
| **Object / Type / Package** | The discovered object identity and ownership scope |
| **Function group** | The owner of an individual function module |
| **Status** | Used or Unclear under the current evidence |
| **Reasons** | Independent observations and relationships supporting the result, or an ambiguous match requiring review |
| **Latest observed** | Latest available valid actual job-start date associated with the object |
| **Observation periods** | Labels saved with uploaded workload files; not calculated execution dates |

Objects with the same name but different types are separate rows. A transaction-profile name that matches a discovered transaction and another discovered type is ambiguous; that observation does not mark either Used. A uniquely discovered transaction can count without an identifiable underlying program. Independent evidence may still establish usage for an ambiguous object.

A used FM marks its own row and its owning function group Used, not all sibling FMs. Likewise, a relationship from a Used object establishes a dependency's use, not the use of every caller of that dependency.

An included released/scheduled job is planned-usage evidence. Read its reason rather than interpreting Used as proof of a successful execution.

## Interpret dates carefully

ST03N period labels describe the extracts you supplied. They do not establish an exact last-used date. Released/scheduled evidence with no valid actual start date also leaves Latest observed blank unless other direct evidence supplies a date.

Dependency propagation does not copy a caller's observed date to every object it uses. A blank date alongside Used can therefore be expected.

## Filter and sort the review list

Choose **All**, **Used**, or **Unclear** in **View**. Add column-header filters to narrow the selected view and click a column heading to sort it.

Header filters match prefixes by default. Add a trailing space for an exact match, or use `*` and `?` wildcards.

| Filter | Example result |
|---|---|
| `CL` in Type | Types starting with CL |
| `CLAS ` in Type | Exactly CLAS |
| `ZSALES*` in Object | Names starting with ZSALES |

**Showing ... of ...** reports the number of visible rows against the table total. **Clear filters** removes the inventory filters and returns View to All.

Filters and sorting are saved per analysis. The Inventory and Issues tabs keep separate table choices.

## Export inventory

Choose one export scope:

- **All objects** exports the inventory, regardless of current filters.
- **Filtered objects** exports the rows currently visible under the view and column filters.
- **Unclear objects** exports all Unclear inventory rows, regardless of current table filters.

Select **XLSX** or **CSV**, choose **Export**, and select a destination. The export includes repository identity, ownership, status, reasons, observed dates, and period labels. Use CSV for a review set that exceeds Excel's worksheet limits.

You can export while work is incomplete, but the file is a snapshot of the results available at that time, not proof the review finished successfully.

## Investigate the Issues tab

The Issues tab is a separate, filterable table, not a history of every past failure.

| Column | Use it to find |
|---|---|
| **Stage** | Discovery, ST03N, Jobs, or Dependencies problems |
| **Source** | A particular upload category, where-used lookup, or relations check |
| **Object / Type / Package** | Affected repository objects where that information is available |
| **File** | The input extract requiring attention |
| **Issue** | The diagnostic explaining the unresolved match or failed collection |

Some collection messages have no object or file context, so those cells can be blank. Filter the Stage, Source, or Issue text instead.

Use the Issues tab's own **Clear filters**, **All issues / Filtered issues**, format selector, and **Export** controls. XLSX and CSV exports include the structured columns, making it easier to group repeated causes or share a focused list with the responsible team.

### What to do with common issues

| Issue | Suggested action |
|---|---|
| Missing or unexpected headings | Use the matching template and the [input-data rules](input-data.md). ST03N requires exactly one ObjectName column. |
| Unresolved or ambiguous workload name | Check the profile, object type, repository scope, and matching Repository system. Do not assume one same-name object proves usage of another type. |
| Job header or step cannot be matched | Check that both exports came from the same system and contain matching JOBNAME and JOBCOUNT values. |
| Missing or invalid job start date | Supply valid actual-run data, or include eligible released/scheduled jobs with their matching status option. |
| Dependency object cannot be resolved | Check existence and type in the chosen Dependency system. A discovered object can exist in the inventory but be absent or unavailable in that system's lookup. |
| Authorization, connection, or lookup failure | Resolve the reported cause, then retry normally or use selective retry. |

Successful dependency retries remove their error rows. Input issues are updated as their stage is processed. Saved unresolved ST03N matches are also reassessed while the analysis is idle; resolved matches clear, while ambiguity remains visible. An active run is not silently rewritten to clear diagnostics.

## Understand completion status

- **Complete** means that stage finished without outstanding recorded issues; it does not mean every inventory object became Used.
- **Partial** means results are available but there are unresolved input or lookup issues. All uploaded files may still have been processed.
- **Paused / Interrupted** means work can continue from saved progress.
- **Failed** means the stage stopped with an error that should be reviewed before retrying.

Review the individual issues and evidence coverage, not just the completion label. An error-free, empty where-used result is not proof of non-use.

## Build a defensible review

1. Record the inventory scope, evidence systems, workload periods, and job retention limits.
2. Review Used reasons, especially planned-job evidence and inferred dependencies.
3. Resolve broad collection or matching issues before treating the remaining Unclear list as a cleanup candidate list.
4. Check infrequent, seasonal, dynamic, externally triggered, and specially bound functionality with its owners.
5. Export the agreed review set and preserve the decision context outside the tool.

The analysis supports investigation. It does not perform deletion or replace your organization's approval and change-management process.