# Choose The Objects To Check

Choose how to get the object list: read it from a connected system or upload files exported from SAP. Discovery lists the objects; it does not check whether they are used yet.

## Which System Should I Choose?

For a production review, **Repository system** can be production itself or a production-like system from the same SAP landscape. A recent production copy is usually the best alternative. What matters is that the objects you are checking match the ones in production.

You do not have to connect production itself to ABAP FS. You can connect the matching system here and upload production usage files in the later steps.

Do not assume QA has the same objects just because it belongs to the same landscape. Check for code changes or missing objects before using it for a production review.

## Read From A Connected System

1. Set **Source** to **Connected system**.
2. In **Repository system**, choose the SAP system containing the objects you want to check. Connect it in ABAP FS first if it is not listed.
3. In **Package patterns**, enter the packages you want to check. See the examples below.
4. Leave **Include subpackages** selected if you also want the packages inside those packages.
5. Click **Discover / Resume**.

| To Check | Enter |
|---|---|
| One package | `ZSALES` |
| Two packages | `ZSALES, ZFINANCE` |
| Packages whose names start with ZSALES | `ZSALES*` |
| Packages in a customer namespace | `/DEMO/*` |

Do not enter just `*` or `/*`. Choose the packages you need rather than asking for every package in the system.

Objects appear in the table as packages are checked. All object types are included, not just programs and classes. Newly found objects start as **Unclear**. The later steps check their usage.

After reading the packages, the analysis also gets the function modules in each function group. Each FM gets its own row, with the group's package and a **Function group** column. Finding one used FM does not mark the other FMs in that group Used.

## Upload An Object List Instead

You can do this without connecting a SAP system to ABAP FS.

1. Set **Source** to **Uploaded files**.
2. Click **Download template** under **TADIR objects**.
3. In SAP, use SE16N or your usual table browser to export TADIR for the packages you want to review.
4. Copy the following fields into the template and save it as XLSX or CSV.

| Column | Example |
|---|---|
| PGMID | R3TR |
| OBJECT | FUGR |
| OBJ_NAME | ZSALES_FUNCTIONS |
| DEVCLASS | ZSALES |

To include the individual FMs, download the **ENLFDIR function modules** template too. Export ENLFDIR for the function groups in your object list and copy these two fields:

| Column | Example |
|---|---|
| AREA | ZSALES_FUNCTIONS |
| FUNCNAME | ZSALES_READ_ORDER |

Add the two files under their matching headings, then click **Discover / Resume**. You do not need to join them in Excel. The analysis gets each FM's package from its function group. If you skip ENLFDIR, you will see the groups but not their individual FMs, and a message will remind you that the list is missing.

Use the template headers in row 1 and one list per file. You can upload several files for either table. The TADIR file determines which packages are included, so filter the SAP export before saving it.

Column order does not matter. Capitalization, spaces, and underscores in headings are ignored, so `OBJ_NAME` and `Object Name` match the same field. Keep one populated worksheet in an XLSX file. Do not include formulas, title rows, or blank/duplicate headings.

For later ST03N and job matching, choose a connected **Repository system** with matching code. Discovery itself does not need that connection when you use uploaded files.

## What To Do Next

Process **2. ST03N**, **3. Jobs**, or both. Either can go first. If you only have one kind of data, that is fine. **4. Dependencies** becomes available once one of those steps has finished and found at least one usable usage match.

- **Used** means the analysis found a reason to treat the object as used. The Reasons column tells you why.
- **Unclear** means it has not found that reason. It does **not** mean the object is unused or safe to delete.

As more objects become Used, choose **Unclear** in **View** to focus on what is left.

## Find And Export Results

Type in a column's filter box to narrow the list. For example, `ZSALES` finds names starting with ZSALES. Put a space after the name for an exact match. You can also use `*` for any number of characters and `?` for one character.

In **Export**, choose **All objects**, **Filtered objects**, or **Unclear objects**. Choose XLSX or CSV, then click the export button and select where to save the file. If the results are too large for Excel, choose CSV.

Open the **Issues** tab for incomplete object lists or input problems. Its separate table has column filters and XLSX/CSV export for **All issues** or **Filtered issues**. Clearing filters in one tab does not clear the other tab's filters.

## Stop Or Start Again

Click **Pause**, or close the panel, to stop. A SAP call already running may need to finish first. Open the saved analysis and click **Discover / Resume** to continue.

Use **Reset** in Discovery when you want a fresh object list or want to change its repository system, package scope, or source. It clears the object list, all usage results, and dependency caches. Your uploaded files are kept, but you will need to process them again.

Each analysis saves its own systems, packages, files, results, and screen choices. System selections are saved when you change them. Text fields are saved when you leave the field. You do not need to run Discovery just to save your choices.

The analysis only reads SAP data. It does not change or delete SAP objects. Deleting an analysis removes its saved local files, not anything in SAP. Treat uploaded files and exported results with the same care as other SAP data.