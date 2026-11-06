# Upload Usage From ST03N

ST03N is SAP's workload monitor. It shows activity such as transaction codes, reports, and RFC calls for the period you choose. This step uses those lists to find Used objects.

**This is always a manual upload, even if the SAP system is connected to ABAP FS.** Open ST03N in the system whose usage you are reviewing, usually production, export its lists, and upload them here. Connecting the system does not make this step read ST03N automatically.

The **Repository system** chosen in Discovery needs to be connected when you click **Process / Resume ST03N**. It is used to look up transaction codes, programs, and function modules. This can be production or a production-like system from the same landscape, preferably a recent production copy whose objects match production. It does not have to be the system you exported the files from.

You can upload any of these three lists. You do not need all three, but adding more lists usually finds more Used objects and leaves fewer for you to review.

| In ST03N | Upload Under |
|---|---|
| Transaction Profile | **Transaction profile** |
| RFC **Server** Profile, Function Module tab | RFC **server**: Function Module |
| RFC **Server** Profile, Transaction tab | RFC **server**: Transaction |

## 1. Get The Names From SAP

1. Open **ST03N**. Switch to **Expert Mode** if the profile options are not shown.
2. Choose the period you want to review. Choose the total for all instances if you want system-wide results.
3. Open one of the profiles listed above.
4. Export the list to a spreadsheet, or copy its names directly into the template described below.

For **Transaction Profile**, check the task-type selection. Dialog-only results will miss activity from other task types, such as background work.

Transaction Profile can contain both transaction codes and report names. Copy them as they are; you do not have to work out which is which.

For RFC **Server** Profile, take separate lists from the **Function Module** and **Transaction** tabs. The Transaction tab groups RFC activity by transaction; it is not a list of function modules.

Do not use **RFC Client Profile**. It can show calls to a function module in another system. A function with the same name in your system might not have run at all.

SAP screen labels can differ by release and language. The important part is choosing the right profile and tab, not matching every screen heading exactly.

## 2. Prepare Each File

1. Click **Download template** beside the list you are adding.
2. Open the template in Excel. Leave `ObjectName` in cell A1.
3. Paste the names below it, one per row.
4. Save the file as XLSX or CSV.

A transaction-profile file might look like this:

| ObjectName |
|---|
| ZSALES |
| ZSALES_DAILY_REPORT |
| ZMONTH_END_REPORT |

For the function-module file, use function-module names instead.

Keep only column A. Do not include descriptions, totals, formulas, or a title above `ObjectName`. For XLSX, keep the list on one sheet and leave any other sheets empty.

All three upload categories require exactly one heading, `ObjectName`. Capitalization, spaces, and underscores are ignored when matching headings, so `Object Name` is also accepted. A heading such as `Transaction` or `Function Module` is not a substitute. Extra columns are rejected.

You can upload several files for the same list, for example one file for each month. There is no need to remove repeated names yourself.

## 3. Upload And Process

1. If useful, fill in **Period label (optional)** before adding files. For example: `January to March 2026`.
2. Click **Add files** under the matching list and choose your files.
3. Repeat for any other lists you have.
4. Click **Process / Resume ST03N**.

The period label is just a note saved with the files. It does not filter their contents or tell the analysis an exact date when an object ran. Leave it blank if you do not need it.

## Read The Results

- A transaction and its program are both treated as Used when the match is clear. A used program also marks its linked transactions Used.
- A discovered transaction can count as Used even when no underlying program can be identified, provided transaction is its only discovered object type.
- If a discovered transaction shares its name with another discovered type, this evidence leaves both Unclear, including the transaction. Another independent observation or dependency can still establish usage.
- A used function module marks its own row and its function group Used. Other FMs in the same group stay Unclear until another check finds them. The **Function group** column shows which group each FM belongs to.
- Unresolved or ambiguous matches appear in the **Issues** tab. Filter by File, Object, or Issue and export **All issues** or **Filtered issues** as XLSX or CSV when you need a review list.

You can process the same files again without adding duplicate reasons. Reasons from other files and jobs are kept too.

If SAP only has three months of data when you wanted a year, those three months are still useful. They can identify objects that were used. Objects missing from those results remain Unclear.

A **partial** result means some input matches need attention; it does not necessarily mean processing stopped before every file was read. Review the Issues tab and each file's processed status. Resolved input issues disappear when the analysis reassesses them while idle or when processing finishes; ambiguous matches remain visible.

## Reset This Step

Click **Reset** in ST03N before changing a processed file list. This removes the ST03N evidence and dependency-pass progress, but keeps your uploaded files, job evidence, and cached dependency relationships. Remove unwanted files, add the new files, then click **Process / Resume ST03N** to process the retained and new files together.

Removing a processed file resets this stage's evidence, not just that file's contribution. Reprocess the remaining files before relying on its results.

After processing additional files, run Dependencies with both cache checkboxes clear. It reassesses the new usage evidence using existing relationships and reads newly needed ones without discarding successful cached checks.

You can process Jobs before ST03N, after it, or not at all. The two steps add their own reasons without replacing each other's results.