---
name: sap-background-jobs
description: "Investigate SAP background jobs, including failed or aborted jobs, job status, job steps, job logs, runtime dumps, TBTCO, TBTCP, and TBTCJOBLOG0-9."
---



# SAP Background Job Investigation

## Overview

This is an investigation procedure, not a callable background-job connector. Use the read-only SQL and dump tools with TBTCO, TBTCP, TBTCJOBLOG0-9, and T100 as described below. The procedure covers finding job instances, reading logs, and diagnosing failures including runtime dumps.

## Rules

- ALWAYS identify the exact job instance with both `JOBNAME` and `JOBCOUNT` before investigating it
- Treat every SQL error as a likely agent query defect. Stop the investigation, diagnose the reported table, field, type, grouping, or ABAP SQL syntax problem, correct the query, and rerun the same query before continuing. Do not treat a failed query as an empty result or switch to unrelated tables/tools without explaining why the corrected query cannot run.
- ALWAYS follow the partition lookup and fallback sequence in Step 4, then count the matching entries before retrieving a log
- NEVER attempt to build the full job log for large logs (>100 entries) — use targeted queries instead (filter by msgtype, or read only last N entries)
- ALWAYS check TBTCP for every job step, including its program, variant, status, and `AUTHCKNAM` execution user
- NEVER use the job scheduler to identify the runtime context of a failed step. `TBTCO-SDLUNAME` is the user who scheduled the job, while `TBTCP-AUTHCKNAM` is the execution user for that specific step. A multi-step job can use a different execution user for each step
- ALWAYS resolve every message through T100 as described in Step 8 before interpreting its text or `MSGV1`-`MSGV4` values; treat any business meaning inferred beforehand as unproven
- For aborted jobs (status = 'A'), ALWAYS check the **last few log entries first** — they contain the failure reason
- When message 00/671 appears, follow the dump investigation in Step 9
- Custom messages (message class starting with Z* or Y*) indicate custom code is writing to the job log — these are often the most informative for business logic failures
- For periodic jobs, check `TBTCO.periodic = 'X'` and the period fields (`prdmins`, `prdhours`, `prddays`, `prdweeks`, `prdmonths`) to understand scheduling

## Procedure

### 1. Establish the SAP connection

Identify the SAP system the user intends to investigate and obtain its `connectionId`. In a multi-system workspace, do not infer the target system from the job name alone. Use `abapfs_get_sap_system_info` to obtain the SAP system timezone and UTC offset; use that timezone when interpreting job dates and times.

### 2. Find the job instance

**Query TBTCO** to find job instances by name, status, date range, or user:

```sql
SELECT jobname, jobcount, status, strtdate, strttime, enddate, endtime, 
       sdluname, reluname, authcknam, periodic, joblog
FROM tbtco
WHERE jobname = '{JOB_NAME}'
  AND status = '{STATUS}'
ORDER BY strtdate DESCENDING, strttime DESCENDING
```

Omit the `status` predicate when the user did not request a status filter.

Key fields:
- `jobname` + `jobcount` = unique job instance identifier (always need both)
- `status` = current state (see Status Codes below)
- `strtdate`/`strttime` = actual start
- `enddate`/`endtime` = actual end
- `sdluname` = user who scheduled the job
- `reluname` = user who released the job
- `authcknam` = job-header authorization-check user; do not use it as the failed step's runtime user
- `periodic` = 'X' if recurring
- `joblog` = **partition pointer** (critical for log retrieval)

### 3. Get the job steps

**Query TBTCP** to see what programs run in the job:

```sql
SELECT jobname, jobcount, stepcount, progname, variant, authcknam, status
FROM tbtcp
WHERE jobname = '{JOB_NAME}' AND jobcount = '{JOBCOUNT}'
ORDER BY stepcount
```

`TBTCP-AUTHCKNAM` is the execution user for that individual step. Record it for every step because different steps in the same job can run as different users. Identify the step active immediately before the failure from the step order, step status, and job-log lifecycle messages such as 00/550. Use that step's execution user when investigating authorization failures and matching runtime dumps.

### 4. Determine the log partition

**Primary method — Read the `joblog` field** from TBTCO. Extract the digit after "DB":
- `DB0 ...` → query `TBTCJOBLOG0`
- `DB1 ...` → query `TBTCJOBLOG1`
- ...
- `DB9 ...` → query `TBTCJOBLOG9`

**Fallback — if the determined table returns no results:**
1. The `joblog` pointer may be stale (e.g., after log reorganization or table redistribution)
2. Run COUNT queries for all 10 tables in parallel: TBTCJOBLOG0, TBTCJOBLOG1, ..., TBTCJOBLOG9
3. Identify which table contains entries for this jobname + jobcount

**If `joblog` is empty:**
- The job may not have produced a log (e.g., it was never started, or it's still in Planned/Released state)
- Try scanning all 10 tables, but expect no results

### 5. Check the log size

```sql
SELECT COUNT(*) as cnt 
FROM tbtcjoblog{n}
WHERE jobname = '{JOB_NAME}' AND jobcount = '{JOBCOUNT}'
```

**Decision tree based on size:**
- **≤ 100 entries**: Retrieve the full log and investigate its lifecycle, warnings, errors, custom messages, and failing-step context
- **> 100 entries**: Retrieve error/abort entries and the final 20 entries (see Step 7)

### 6. Retrieve the job log

```sql
SELECT jobname, jobcount, linenumber, enterdate, entertime, 
       msgid, msgno, msgtype, msgv1, msgv2, msgv3, msgv4
FROM tbtcjoblog{n}
WHERE jobname = '{JOB_NAME}' AND jobcount = '{JOBCOUNT}'
ORDER BY linenumber
```

### 7. Targeted queries for large or failed job logs

**For failures — get last N entries (most valuable):**
```sql
SELECT jobname, jobcount, linenumber, enterdate, entertime,
       msgid, msgno, msgtype, msgv1, msgv2, msgv3, msgv4
FROM tbtcjoblog{n}
WHERE jobname = '{JOB_NAME}' AND jobcount = '{JOBCOUNT}'
ORDER BY linenumber DESCENDING
```

Set `maxRows: 20` in `abapfs_run_sql_query`; do not add a `LIMIT` clause to the SQL.

**For errors/aborts only:**
```sql
SELECT jobname, jobcount, linenumber, enterdate, entertime,
       msgid, msgno, msgtype, msgv1, msgv2, msgv3, msgv4
FROM tbtcjoblog{n}
WHERE jobname = '{JOB_NAME}' AND jobcount = '{JOBCOUNT}'
  AND msgtype IN ('E', 'A', 'X')
ORDER BY linenumber
```

**For custom messages only (Z*/Y* message classes):**
```sql
SELECT jobname, jobcount, linenumber, enterdate, entertime,
       msgid, msgno, msgtype, msgv1, msgv2, msgv3, msgv4
FROM tbtcjoblog{n}
WHERE jobname = '{JOB_NAME}' AND jobcount = '{JOBCOUNT}'
  AND ( msgid LIKE 'Z%' OR msgid LIKE 'Y%' )
ORDER BY linenumber
```

### 8. Resolve message texts

**Query T100 for each distinct msgid + msgno before interpreting any message variables:**
```sql
SELECT arbgb, msgnr, text 
FROM t100 
WHERE sprsl = 'E' AND arbgb = '{MSGID}' AND msgnr IN ('{MSGNO1}', '{MSGNO2}', ...)
```

**Substitute placeholders:**
- Replace `&1` with MSGV1, `&2` with MSGV2, `&3` with MSGV3, `&4` with MSGV4
- Some messages use positional `&` (no number) — substitute left to right with MSGV1, MSGV2, etc.
- Some T100 texts are just `& & & & & &` — in those cases, concatenate all MSGVn values as the full message text
- If T100 has no matching text, report the message ID, number, and variables as unresolved evidence; do not describe the variables as processed documents, records, counts, or other business objects without corroborating evidence.

### 9. Investigate dumps (for aborted jobs)

Only investigate runtime dumps when the log contains message **00/671** ("Internal session terminated with a runtime error"). Do not list recent dumps merely because the job failed or was aborted.

When the log contains message **00/671**:
1. Note the runtime error name from MSGV1 (e.g., `LOAD_COMMON_PART`, `COMPUTE_INT_ZERODIVIDE`)
2. Note the timestamp from MSGV2 or the `enterdate`/`entertime` of the log entry and interpret it in the SAP system timezone obtained in Step 1
3. Identify the failed step and read its execution user from `TBTCP-AUTHCKNAM`
4. Use `abapfs_analyze_dumps` with `action="list_dumps"` and enough `maxResults` to cover the relevant time window
5. Correlate the returned dumps by runtime error name, timezone-aligned timestamp, and failed-step execution user. Convert timestamps when the dump tool and SAP job data use different timezone representations. Do not match against `TBTCO-SDLUNAME`
6. Use `abapfs_analyze_dumps` with `action="analyze_dump"` and the matching `dumpId` to retrieve full dump details

### 10. Report findings

Report the exact job instance and status, scheduling user, failed or relevant step number, step execution user, program and variant, resolved failure messages, and dump root cause when present. Distinguish observed evidence from interpretation, and state when no unique failed step or matching dump could be identified. Do not return a raw-log summary without explaining what failed and why.

## Status Codes (TBTCO.status)

| Code | Meaning | Description |
|------|---------|-------------|
| `P` | Planned | Scheduled but not yet released |
| `S` | Released | Released, waiting for start condition (time, event, predecessor) |
| `Y` | Ready | Ready to run, waiting for available work process |
| `R` | Running | Currently executing |
| `F` | Finished | Completed successfully |
| `A` | Aborted | Terminated with error |
| ` ` | (blank) | Unknown/initial state |

## Common Failure Patterns in Job Logs

### Runtime dump (ABAP short dump)
```
Line N:   MSGID=00, MSGNO=671, MSGTYPE=A  → "Internal session terminated with a runtime error {MSGV1} (see ST22)"
Line N+1: MSGID=00, MSGNO=518, MSGTYPE=A  → "Job canceled"
```
**Action:** Use `abapfs_analyze_dumps` to identify and analyze the matching dump.

### System exception (ERROR_MESSAGE)
```
Line N:   MSGID=00, MSGNO=564, MSGTYPE=A  → "Job canceled after system exception ERROR_MESSAGE"
```
**Action:** Look at preceding log entries (E-type messages) — they contain the actual error that triggered the exception.

### Application error (custom logic)
```
Line N:   MSGID=Z*, MSGNO=xxx, MSGTYPE=E  → Custom error message from Z-code
Line N+1: MSGID=00, MSGNO=564, MSGTYPE=A  → "Job canceled after system exception ERROR_MESSAGE"
```
**Action:** Resolve the custom message text. Investigate the custom program's source code.

### Standard job lifecycle messages
| MSGID | MSGNO | Meaning |
|-------|-------|---------|
| 00 | 516 | Job started |
| 00 | 517 | Job finished |
| 00 | 518 | Job canceled |
| 00 | 550 | Step started (program, variant, user) |
| 00 | 564 | Job canceled after system exception |
| 00 | 671 | Runtime error (short dump) — see ST22 |

## Job Log Partition Table Structure (TBTCJOBLOG0-9)

All 10 tables share the same structure:

| Field | Type | Description |
|-------|------|-------------|
| `JOBNAME` | BTCJOB | Job name (key) |
| `JOBCOUNT` | BTCJOBCNT | Job number (key) |
| `LINENUMBER` | INT4 | Line number in log (key) |
| `ENTERDATE` | SYDATE | Date of log entry |
| `ENTERTIME` | SYTIME | Time of log entry |
| `MSGID` | SYMSGID | Message class |
| `MSGNO` | SYMSGNO | Message number |
| `MSGTYPE` | SYMSGTY | Message type (S/I/W/E/A/X) |
| `MSGV1` | SYMSGV | Message variable 1 |
| `MSGV2` | SYMSGV | Message variable 2 |
| `MSGV3` | SYMSGV | Message variable 3 |
| `MSGV4` | SYMSGV | Message variable 4 |

## Message Types

| Type | Meaning | Significance |
|------|---------|--------------|
| `S` | Success | Normal progress messages |
| `I` | Information | Informational, not an error |
| `W` | Warning | Potential issue, job continues |
| `E` | Error | Error occurred, may or may not abort |
| `A` | Abort | Fatal, job terminated |
| `X` | Exception | System exception, job terminated |

## Examples

### Good: Investigating an aborted job efficiently

1. Find the job: `SELECT jobname, jobcount, status, strtdate, strttime, joblog FROM tbtco WHERE jobname = 'ZMYJOB' AND status = 'A' ORDER BY strtdate DESCENDING`
2. Extract partition from joblog field: `DB7 ...` → use TBTCJOBLOG7
3. Get count: `SELECT COUNT(*) FROM tbtcjoblog7 WHERE jobname = 'ZMYJOB' AND jobcount = '12345678'` → returns 450
4. Since count > 100, get only last 20 entries + error entries
5. Find message 00/671 with MSGV1 = 'COMPUTE_INT_ZERODIVIDE'
6. Use `abapfs_analyze_dumps` to list recent dumps, correlate the matching `COMPUTE_INT_ZERODIVIDE` timestamp, and analyze its dump ID
7. Report findings: which program, which line, what variable caused the zero division

### Good: Fallback when partition pointer fails

1. joblog field says `DB3 ...` → query TBTCJOBLOG3 → returns 0 rows
2. Don't give up — run COUNT queries across TBTCJOBLOG0-9 in parallel; TBTCJOBLOG2 returns 12 entries
3. Proceed with TBTCJOBLOG2

### Bad: Scanning all 10 tables blindly without checking joblog first

Querying TBTCJOBLOG0 through TBTCJOBLOG9 without first checking the `joblog` field in TBTCO wastes unnecessary queries. Always check the partition pointer first, and only fall back to parallel COUNT queries if it doesn't work.

### Good: Handling a large job log (4000+ entries)

1. Get count → 4504 entries
2. Tell the user: "This job has 4504 log entries. I'll check the last entries and any errors first."
3. Query: `WHERE msgtype IN ('E', 'A', 'X')` → find the 3 error entries
4. Query: `ORDER BY linenumber DESCENDING` with `maxRows: 20` → see the final context
5. Resolve messages via T100
6. Present concise findings

### Good: Finding all recent failed jobs

```sql
SELECT jobname, jobcount, strtdate, strttime, enddate, endtime, authcknam
FROM tbtco 
WHERE status = 'A' 
  AND strtdate >= '20260620'
ORDER BY strtdate DESCENDING, strttime DESCENDING
```
