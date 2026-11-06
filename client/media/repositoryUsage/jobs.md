# Check Background Jobs

Use this step to find programs listed in background jobs. Failed and cancelled jobs count too; a program does not need a successful job run to be treated as Used here.

Choose how to get the job data in **Source**:

- **Connected system**: ABAP FS reads it from SAP.
- **Uploaded extracts**: you provide two files, one from TBTCO and one from TBTCP.

## Which System Should I Use?

You do not have to connect production to ABAP FS. For a production review, you can export the job files from production and upload them here.

If you choose **Connected system**, use production itself or a production copy that still contains the production job history for the dates you want to check. A QA system with the same programs does not necessarily have the same jobs. Its own job runs are not production job history.

The **Repository system** chosen in Discovery also needs to be connected when you process jobs. It is used to match programs and transaction codes. It can be a production-like system from the same landscape, preferably a recent production copy with matching objects. The repository system and job system do not have to be the same.

## Consider Released Or Scheduled Jobs

Job history may be retained for only a few weeks. A monthly job's last run might already have been deleted, while its next occurrence is still released or scheduled.

Both source options provide two independent checkboxes, unchecked by default:

- **Consider released jobs** includes status `S`: released and waiting for its start condition.
- **Consider scheduled jobs** includes status `P`: scheduled/planned but not yet released.

When selected, the corresponding jobs can mark their programs and linked transactions Used even if the actual start date is blank, `00000000`, or invalid. These statuses indicate planned usage, not proof that the job has run or will successfully run. Other statuses still need a valid actual start date; failed and cancelled jobs count when that date is valid.

## Read Jobs From A Connected System

1. Set **Source** to **Connected system**.
2. In **Job system**, choose the system whose jobs you want to check.
3. Set **From** and **Through** to the first and last dates you want to include.
4. Select **Consider released jobs** and/or **Consider scheduled jobs** if needed.
5. Click **Process / Resume Jobs**.

The date range applies to actual job starts, not the dates when someone created or scheduled the jobs. Enabled released/scheduled statuses are read separately without a start-date restriction, so the date range does not exclude future or undated jobs in those statuses.

You do not need to prepare any spreadsheets for this option. If SAP is slow, try a shorter date range. If a permission error appears, check your table access with your SAP support team.

For actual runs, SAP returns a summary per program with its latest job start date in your date range. A program running every five minutes does not need thousands of rows here; its latest run is enough to mark it Used. Enabled released/scheduled jobs are included alongside those summaries. Failed jobs count too.

## Upload Files Instead

TBTCO holds the job details, including dates and status. TBTCP holds the steps and program names. Upload them separately; the analysis matches them for you. You do not need to combine them in Excel or use VLOOKUP.

### 1. Get The Job Details From TBTCO

1. Open **SE16N**, or your usual table browser, and enter `TBTCO`.
2. For actual runs, filter **STRTDATE** to the period you want to check.
3. Include the fields below in the result and export it to Excel.
4. Click **Download template** beside **TBTCO headers** in the analysis.
5. Copy the exported values into the matching columns, leaving the template's headers in row 1.

| Column | What It Contains | Needed? |
|---|---|---|
| JOBNAME | Job name | Yes |
| JOBCOUNT | SAP's ID for that job run | Yes |
| STRTDATE | Actual start date, such as `20260131` | Required for other statuses; may be blank for enabled released/scheduled jobs |
| STRTTIME | Actual start time, such as `093000` | Optional |
| STATUS | SAP's job status code, including `S` (released) and `P` (scheduled) | Required to recognize released/scheduled jobs; otherwise optional |

Do not filter the file to successful jobs only. Keep failed and cancelled jobs too.

To consider released or scheduled jobs, export additional TBTCO rows with **STATUS** `S` and/or `P` and **no STRTDATE restriction**. A start-date filter can omit exactly the jobs these checkboxes are intended to include. You can upload these as separate header files alongside your actual-run extract. Include their matching TBTCP steps too. The checkboxes filter uploaded rows locally; they cannot recover jobs missing from your files.

### 2. Get The Job Steps From TBTCP

1. Open `TBTCP` in the same table browser.
2. Find the steps for the jobs in your TBTCO file. You can use those job names in the selection.
3. Export the fields below.
4. Click **Download template** beside **TBTCP steps**.
5. Copy the exported values into the matching columns.

| Column | What It Contains | Needed? |
|---|---|---|
| JOBNAME | Job name | Yes |
| JOBCOUNT | The same job-run ID used in TBTCO | Yes |
| STEPCOUNT | Step number within the job | Recommended |
| PROGNAME | ABAP program run by that step | Yes |

A job name can have many runs. Keep **JOBCOUNT** in both files so the correct run is matched. Keep all ABAP program steps, not just the first one. Steps that run an external command rather than an ABAP program do not provide a program name for this check.

Copy the values as SAP exports them. You do not need to reformat JOBCOUNT in Excel; the analysis handles numeric job counts and missing leading zeros when it matches the files. Use the template headers, not translated column headings from the SAP export. Save each file as XLSX or CSV, with one list per file.

### 3. Add Both Files

1. Set **Source** to **Uploaded extracts**.
2. Click **Add files** under **TBTCO headers** and choose the first file.
3. Click **Add files** under **TBTCP steps** and choose the second file.
4. Select **Consider released jobs** and/or **Consider scheduled jobs** to include the corresponding statuses from your files.
5. Click **Process / Resume Jobs**.

You can add several files for either table. If your TBTCP file contains extra job runs, they will be listed as unmatched; they will not be matched by job name alone.

## Read The Results

Programs found in the jobs are marked Used, along with their linked transactions. The Reasons column shows the job details. Earlier ST03N reasons stay in place.

Repeated job entries for the same program are combined, keeping the latest available actual start date. Connected collection shows the program and either its latest actual start date or its released/scheduled status; uploaded files can also show the matching job name and status.

**Latest observed** shows the newest valid actual start date found for an object. Released/scheduled evidence without a valid actual start date does not invent a date: the column remains blank unless other evidence supplies one. For other statuses, rows with a blank, `00000000`, or invalid start date are ignored and reported as issues. Failed and cancelled jobs still count when they have a valid start date.

Open the **Issues** tab if a job or step could not be matched. Filter the table and export **All issues** or **Filtered issues** as XLSX or CSV when you need a separate review list. Make sure both files came from the same SAP system and that JOBNAME and JOBCOUNT are present in both. Corrected issues disappear when the files are processed again.

Processing jobs again replaces the previous job results with the data you just chose. ST03N results are not removed. If you remove a job file, process the remaining files again to rebuild the job results.

## Reset Or Change The Source

Changing either status checkbox after Jobs has been processed or checkpointed asks for confirmation, then clears the job evidence and progress. Run **Process / Resume Jobs** again to rebuild the results with the new selection. ST03N evidence, uploaded files, and dependency caches are kept; Used/Unclear statuses are reassessed.

Click **Reset** in Jobs before changing a processed file list or switching between uploaded files and a connected system. It clears job evidence and dependency-pass progress, but keeps uploaded files, ST03N evidence, and dependency caches. Choose the new source or files, then click **Process / Resume Jobs**.

After changing job evidence, run Dependencies normally with both cache checkboxes clear. It reassesses the current evidence and reads newly needed relationships while reusing successful cached checks.

Jobs and ST03N can run in either order. You do not have to use ST03N if job data is all you have.