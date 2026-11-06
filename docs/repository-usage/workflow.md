# Run a Repository Usage Analysis

This workflow follows the four stages in **ABAP FS: Repository Usage Analysis**. Open a stage's **Guide** for detailed extraction instructions while you work.

## 1. Create or open an analysis

Run the command from the Command Palette and choose **Create analysis**, or open a saved analysis. Give each review a name that identifies its scope or review period.

You can keep separate analyses for different application scopes or review exercises. Choose the correct saved analysis before changing inputs or exporting results.

## 2. Discover the inventory

Choose one Discovery source:

- **Connected system**: select **Repository system**, enter package patterns such as `ZSALES, ZFINANCE*`, and decide whether to **Include subpackages**.
- **Uploaded files**: add a TADIR extract for your scope and, where needed, an ENLFDIR extract for individual function modules.

Click **Discover / Resume**. Objects appear as Discovery progresses and initially remain Unclear. Listing an object does not itself establish that it is used.

Use a specific package scope. Do not enter unrestricted `*` or `/*` patterns. For uploaded discovery, filter the TADIR extract before uploading; its contents define the scope.

Individual FMs inherit the package of their discovered function group. If their ownership extract is missing, the group can still appear without its individual FM rows.

See [Prepare input data](input-data.md) for the upload fields and file rules.

## 3. Add usage evidence

Use ST03N, Jobs, or both. You can process them independently after Discovery.

### ST03N

1. Export the relevant profiles manually from the system whose workload you are reviewing.
2. Prepare one-column files using the **Download template** buttons.
3. Optionally enter a **Period label** before adding the files.
4. Upload each file under its matching profile and choose **Process / Resume ST03N**.

ST03N is always an upload stage. Connecting the workload system does not make this stage collect its profiles automatically.

### Jobs

Choose **Uploaded extracts** to provide TBTCO headers and TBTCP steps, or **Connected system** to select a job system and actual-start-date range.

Select **Consider released jobs** and/or **Consider scheduled jobs** when you want to include planned jobs as evidence. These choices are useful when short history retention would otherwise hide an infrequently run program. They do not prove execution.

Choose **Process / Resume Jobs**. Both evidence stages need a connected Repository system for matching, regardless of how their input data was obtained.

## 4. Follow dependencies

Choose **Dependency system**, leave the default concurrency unless you need to adjust SAP load, and select **Analyse / Resume**.

For a first run or after adding more usage evidence, leave both cache checkboxes clear. Successful cached checks are reused, failed checks can be retried, and newly needed relationships are read.

Use [Run dependency checks](dependencies.md) to choose between normal processing, selective retry, and a full cache refresh.

## 5. Review the results and issues

Use the **Inventory** tab to inspect Used/Unclear status and reasons. Use the **Issues** tab for unresolved input matches and failed collection checks. Each tab has independent filters and XLSX/CSV export controls.

A partial stage can still contain useful completed results. Review its issues rather than assuming every input file or object failed. Resolve the cause and rerun the appropriate stage before drawing conclusions about remaining Unclear objects.

See [Review and export results](results.md) for dates, filtering examples, and suggested review steps.

## Pause and continue

Choose **Pause**, or close the panel, to stop an active operation. An in-flight SAP request may need to finish before the pause completes.

Open the saved analysis and use that stage's **Resume** action. Completed work is retained. An interrupted or partially completed review can still be inspected and exported, but its gaps matter when interpreting the results.

## Add more evidence later

1. Reset only the evidence stage whose processed file list needs to change: ST03N or Jobs.
2. Keep the existing files you still want, remove unwanted files, and add the new extracts.
3. Reprocess that stage. Its own previous evidence is replaced; the other evidence stage is kept.
4. Run Dependencies normally, with both cache checkboxes clear, to reassess all current evidence and obtain newly needed relationships.

ST03N/Jobs resets preserve dependency caches and relationships. You do not need a full dependency refresh merely because you have more usage evidence from the same code landscape.

Removing a processed input file resets the evidence for its entire stage, not only that file's contribution. Reprocess the retained files afterward.

## Know what Reset clears

| Action | Cleared | Kept |
|---|---|---|
| **Reset Discovery** | Inventory, usage evidence, dependency relationships, checks, and progress | Uploaded files, ready to process again |
| **Reset ST03N** | ST03N evidence and dependency-pass progress | Inventory, job evidence, uploaded files, dependency caches and relationships |
| **Reset Jobs** | Job evidence and dependency-pass progress | Inventory, ST03N evidence, uploaded files, dependency caches and relationships |
| **Reset Dependencies** | Dependency lookups, their relationships, and pass progress | Inventory, ST03N/job evidence and their ownership/matching information |

Reset Discovery before changing its repository system, package scope, or source after an inventory has been established. Reset Jobs before changing its completed source between uploads and a connected system.

Changing a released/scheduled-job checkbox after processing asks for confirmation and resets job evidence and progress. Reprocess Jobs with the new selection, then run Dependencies again as needed.

Changing **Dependency system** clears that system's previous dependency cache after confirmation. Use a fresh cache when code or the system copy has changed.