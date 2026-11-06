# Prepare Repository Usage Input Data

The analysis is only as complete as its inventory, matching system, and usage evidence. Choose exports from the right system and retain enough periods to cover the business processes you want to review.

The **Guide** button in each stage provides the extraction steps next to the upload controls.

## General file rules

- Use the matching **Download template** and save as XLSX or CSV.
- Keep the header in the first populated row. Do not add a report title above it.
- An XLSX file must contain exactly one populated worksheet; other sheets must be empty.
- Use plain cell values, not formulas or rich-text cells. Do not leave blank or duplicate column headings.
- Heading matching ignores capitalization, spaces, and underscores. Column order does not matter for multi-column templates.
- You can add several files for the same category, such as one file for each month.

For ST03N, the one-column rule is stricter: extra columns are rejected. Downloaded SAP spreadsheets often contain descriptions and totals that must be removed before upload.

## Discovery extracts

For **Uploaded files** in Discovery, prepare these exports from one consistent repository system:

| Upload | Fields | Purpose |
|---|---|---|
| **TADIR objects** | `PGMID`, `OBJECT`, `OBJ_NAME`, `DEVCLASS` | Defines the object inventory and package scope |
| **ENLFDIR function modules** | `AREA`, `FUNCNAME` | Adds individual FMs belonging to discovered function groups |

Filter TADIR to your intended scope before exporting. Package patterns in the connected-source controls do not filter an uploaded object list.

ENLFDIR is optional, but omitting it leaves the function groups without their individual FM rows. The analysis matches `AREA` to the function-group name and assigns the group's package to each FM.

Uploaded Discovery does not require a live connection. Processing ST03N or Jobs afterward still requires a connected **Repository system** containing matching objects and mappings.

## ST03N extracts

ST03N collection is manual, including for connected systems. Choose the workload period and relevant instances in SAP, then prepare separate lists:

| SAP profile | Upload category | Values |
|---|---|---|
| Transaction Profile | **Transaction profile** | Transaction codes and report names |
| RFC Server Profile, Function Module tab | **RFC server: Function Module** | Function-module names |
| RFC Server Profile, Transaction tab | **RFC server: Transaction** | Transaction names shown by that tab |

!!! warning "Use RFC Server, not RFC Client"
    RFC Client Profile can describe calls to another SAP system. A same-name function module in the reviewed system is not proof of local execution.

Every ST03N file must contain exactly one column headed `ObjectName`. `Object Name` and `OBJECT_NAME` are accepted equivalents. `Transaction` or `Function Module` is not an alternative heading.

| ObjectName |
|---|
| ZSALES |
| ZSALES_DAILY_REPORT |
| ZMONTH_END_REPORT |

Paste one name per row. Do not include totals, descriptions, or additional columns. For Transaction Profile, check the task-type selection; dialog-only data can omit other activity.

Enter **Period label (optional)** before uploading if you want to record a description such as `January to March 2026`. It is stored with those files. It does not filter rows or establish a precise last-used date.

Short retention limits what the extracts can establish. An object absent from three months of workload might still be part of a quarterly or annual process.

## Job extracts

### Choose the source

**Connected system** reads job programs from the chosen **Job system**. **From** and **Through** are inclusive actual-start dates, not creation or scheduling dates.

**Uploaded extracts** requires separate TBTCO and TBTCP files. You do not need to join them in Excel.

| Upload | Fields | Notes |
|---|---|---|
| **TBTCO headers** | `JOBNAME`, `JOBCOUNT`, `STRTDATE`, `STRTTIME`, `STATUS` | Job identity is required. Actual start date is needed for statuses other than included released/scheduled jobs. Start time is optional. Status is needed to recognize released/scheduled jobs. |
| **TBTCP steps** | `JOBNAME`, `JOBCOUNT`, `STEPCOUNT`, `PROGNAME` | Job identity and ABAP program are required. Step count is recommended. |

Match both job name and job count. The same job name can have many occurrences; matching the name alone is not sufficient. Numeric job counts and missing leading zeros are handled during import.

Keep all relevant ABAP steps, including failed/cancelled runs. External-command-only steps do not provide an ABAP program for this analysis.

### Include released or scheduled jobs

Both job sources offer two independent checkboxes, unchecked by default:

| Option | SAP status | Effect |
|---|---|---|
| **Consider released jobs** | `S` | Includes jobs released and waiting for their start condition |
| **Consider scheduled jobs** | `P` | Includes scheduled/planned jobs not yet released |

These statuses can count as planned usage even without a valid actual start date. They are useful for monthly jobs whose previous run has already disappeared from retained history. They do not prove that the job executed or will execute successfully.

In connected mode, included released/scheduled jobs are not restricted by the actual-start-date range. For uploads, export their TBTCO headers with status `S` and/or `P` **without a STRTDATE restriction**, and include their matching TBTCP steps. You can add these as extra files alongside the actual-run extracts.

Uploaded files are evaluated locally. A checkbox cannot recover a job omitted from the export. For other statuses, blank, zero, or invalid start dates are reported as issues rather than treated as execution evidence.

## Keep evidence consistent

Use job headers and steps from the same system. Use a matching Repository system for name resolution and a matching Dependency system for relationships. Retain the origin and extraction period in your review records so other reviewers understand what the results cover.

Continue with [Run an analysis](workflow.md), then [Review and export results](results.md).