---
name: abap-code-review-helper
description: 'Requirements for ABAP code to avoid mistakes that pass syntax checks but cause wrong results, dumps, lost updates, or slow processing. Use when writing, changing, refactoring, debugging, or reviewing reports, classes, function modules, enhancements, BAPIs, interfaces, and any other ABAP objects. Covers old values left in loop variables, SELECT and FOR ALL ENTRIES, binary search, parallel cursors, duplicate keys, conversions, commits, locks, and retries. Report problems, not lists of passed checks.'
---

# ABAP Coding Pitfalls

These requirements describe what the code must do. For reviews, report violations; for authorized changes, make the code meet the applicable requirements. Report important unknowns, not passed-check lists unless asked. Never claim checks or tests that were not performed.

## Review safeguards

1. **A finding must describe a reachable failure in the current code.** A hypothetical future change is not a current defect.
2. **Existing protections must be traced before reporting a missing check.** An enclosing branch, earlier exit, full assignment, or earlier compatible sort can already satisfy the requirement.
3. **A safe equivalent must be accepted.** The code need not use the reviewer's preferred syntax.
4. **A claim disproved during investigation must be removed from the findings and severity totals.**
5. **Quoted code, types, keys, and signatures must match inspected source.** Missing information must remain unknown.
6. **Security findings require an actual input/control path to a security-sensitive operation.** Dynamic ABAP conditions are not automatically SQL injection.
7. **Correctness defects, conditional risks, measured performance problems, and maintainability suggestions must be kept separate.**

## Examples of mistakes that pass syntax checks

These are examples, not the complete list. The later requirements also apply wherever relevant to the code.

- **Old data must not be used after a failed read.** After `READ TABLE ... INTO` or `SELECT SINGLE`, `sy-subrc` must be checked or saved before another operation can overwrite it. The result must be checked before the target is used. If no row was found, the target work area must not be used as a successful result: it may still hold data from the previous read. The return code must determine whether a row was found, not whether the work area is initial; a real row can contain blank or zero values.
- **Temporary loop variables must be cleared or fully assigned before use on each iteration.** A skipped assignment must not leave the previous row's value in use. Running totals and other values needed across iterations must not be cleared prematurely. Clearing is unnecessary when the value is always replaced completely before use.
- **Internal-table inserts and updates must use the statement that matches the intended action.**
	- `INSERT ... INTO TABLE` adds a row. `MODIFY TABLE` changes an existing row found by the primary table key; it must not be used to insert a missing row. `MODIFY ... INDEX` changes the row at that index.
	- Duplicate handling must match the actual statement and table keys. A duplicate can set a failure return code, raise an exception, or cause a dump. `sy-subrc` must be checked when the statement sets it; exceptions must be handled where required. This also applies to bulk inserts, constructors, and unique secondary keys.
	- `INSERT` must not be replaced with `MODIFY` just to hide duplicates. The business rule must determine whether a duplicate is rejected, skipped, merged, or updated.
- **Database `INSERT`, `UPDATE`, and `MODIFY` must match the allowed create/change behavior.**
	- `INSERT` is for create-only and `UPDATE` for change-only. Database `MODIFY` must be used only when insert-or-update by primary key is intended. Unlike internal-table `MODIFY TABLE`, it can insert a missing row.
	- Duplicate primary keys and conflicts with unique secondary indexes must be handled. Depending on the statement, these can return a failure code, raise an exception, or cause a dump. `MODIFY` can still fail on a unique secondary index.
	- A duplicate must not be ignored unless the business rule allows it. A preceding existence check is not enough: another session can insert the row before this session does.
- **The table must be sorted correctly before `BINARY SEARCH`.** On a standard table, the search fields must be the leading sort fields, in ascending order and in the same sequence as the search key. A descending sort or `AS TEXT` sort is not a substitute. Appends or changes must not break that order before the search. A suitable declared sorted or hashed key is preferable when it removes the need to maintain this order manually.
- **An index-based parallel cursor must have the correct sort, start index, and exit check.**
	- The tables must be ordered by the grouping fields as required by the algorithm. The first matching inner row's `sy-tabix` must be saved before another operation can overwrite it, and the inner loop must start `FROM` that saved index.
	- The inner loop must exit when any grouping field differs (`NE`/`<>`). Comparing only part of a composite group key or continuing into the next group is incorrect.
	- Duplicate keys in both tables must be handled. An inner group must remain available to any later outer row that also needs it. The last successful index must not be reused after a failed search.
- **The FAE table must be checked for empty before the SELECT.** `SELECT ... FOR ALL ENTRIES IN @lt_keys` must be guarded by `IF lt_keys IS NOT INITIAL` or an earlier return/skip when it is empty. With an empty FAE table, the entire explicit `WHERE` condition can be ignored, not just conditions using `lt_keys`. The query can then read every row allowed by implicit restrictions such as the current client. A skipped SELECT must not leave its previous result in use accidentally.
- **An empty range in WHERE field IN @range_table means no restriction on that field."** If empty input should return no rows, the SELECT must be skipped or an empty result returned explicitly.
- **The number of keys passed through `IN range` must stay within the database's limits.**
	- A large range in `WHERE field IN @lt_range` can exceed SQL statement-size or parameter limits and cause a database error or dump.
	- Large exact-key lists must use an approach suitable for the expected volume, such as FAE with a nonempty-table check, a supported join, or smaller key batches. Neither FAE nor a hardcoded batch size is safe at every size on every system.
	- The selection must keep its intended meaning. FAE removes duplicate result rows. Exclusions, intervals, and patterns must not be replaced blindly with equality checks or split into separate queries whose results are combined.
- **`SELECT SINGLE` must not choose the latest or preferred row from several matches.** It is suitable when the key is unique or any matching row is acceptable, including an existence check. Selecting the first, latest, or top-N rows must use `ORDER BY` with an extra sort field when needed to resolve ties. Database result order must not be relied on without `ORDER BY`.
- **Database reads inside loops must be avoided unless their number and cost are justified.** This includes SELECTs inside methods and function modules called by the loop. Reading needed rows together and looking them up by table key is preferable. Per-row reads may be appropriate for a justified buffered lookup or another bounded access pattern.
- **SELECTs must retrieve only needed columns by default.** `SELECT *` must not be the default: extra columns increase transfer and memory use. Whole-row reads are acceptable when the complete row is needed and the expected row count and row size are acceptable.
- **A field symbol must be assigned before it is used.** When assignment can fail or be skipped, access must be guarded by `IF <row> IS ASSIGNED` or an equivalent successful-assignment check. The unassigned case must skip, return, or raise an error before dereferencing; otherwise the code can dump with `GETWA_NOT_ASSIGNED`. Inside a successful `LOOP ... ASSIGNING`, another check is unnecessary unless later code unassigns the symbol or invalidates its row.
- **The result of dynamic `ASSIGN` must be checked before the field symbol is used.** `sy-subrc` must be checked or saved before another operation can overwrite it. A failed assignment can leave the field symbol pointing at an older object. `IS ASSIGNED` alone does not establish that the new assignment worked. When an old assignment must not survive, the symbol must be unassigned before the attempt. Failure must be handled before the symbol is used.
- **Missing rows in table expressions must be handled.** `itab[ ... ]` can raise `CX_SY_ITAB_LINE_NOT_FOUND`. Where absence is expected, that exception must be handled or an appropriate default used. A missing mandatory row must produce an error rather than silently becoming a blank value. Unrelated errors must not be hidden by a broad catch.
- **A helper, exit, or BAdI must not commit the caller's work without permission from the calling application.** `COMMIT WORK` can save unrelated pending changes made by the caller. It is allowed only where the application or framework explicitly permits that routine to end the transaction.
- **Database changes must be protected against conflicting changes by other sessions.** Between reading a row and acting on it, another session can change it. The code must use the appropriate lock, a single conditional database operation, or a version/value check that rejects a conflicting update. An existence check alone does not make concurrent creation safe.

## How to apply the rules

- The assessment must include relevant callers, inputs, keys, sort order, variable assignments, writes, and commits. Failed reads, skipped branches, exceptions, retries, and repeated calls must be considered where they affect the code.
- Reviews must report defects without changing code. Changes, business-data writes, commits, jobs, and large test loads require authorization. Questions are needed only when missing information prevents a safe answer or implementation.
- Code changes must preserve intended duplicate handling, ordering, rounding, authorization checks, and all-or-nothing saves. Clear types, explicit keys, and complete assignments are preferable to unnecessary checks or clearing.
- Wrong results and dump risks must be distinguished from possible performance problems. Claims must match the actual ABAP release, database, and calling environment. ECC can run on HANA; uncertain statement behavior must be checked against authoritative documentation rather than guessed.
- Source inspection, syntax checks, ATC, tests, and performance measurements must not be presented as interchangeable evidence. Reports must distinguish what was inspected, executed, or left unverified.

## 1. Database reads

1. Selections must include all conditions needed to identify the intended records. Material alone may be insufficient; plant, valuation area, organization, language, status, version, or validity dates may also matter. The required client restriction must be preserved.
2. No matches, one match, and multiple matches must have defined outcomes. Multiple rows that indicate bad data must be reported rather than silently reduced to one.
3. SELECTs must be restricted to the rows needed. Reading a large table and discarding most rows afterward still costs database transfer and ABAP memory.
4. Aggregate values must be checked, not just `sy-subrc`. An aggregate SELECT can succeed even when no source rows match. Whether data exists must be determined from the returned count or the query's grouping behavior.

## 2. Joins and SQL conditions

1. Joins must include every required relationship condition. Missing key fields can match each row to several unrelated rows and multiply the result.
2. Totals must not count the same business value repeatedly because of a join. Joining one header to five items repeats the header amount five times; summing it would overstate the total.
3. Left-join filters must be placed in `ON` or `WHERE` according to whether unmatched left-hand rows must remain. A `WHERE` filter on the right-hand table can remove those rows.
4. SQL `NULL` must not be treated as zero or blank. It behaves differently in comparisons and aggregates, and can become an initial value when read into ABAP. Null indicators or explicit SQL handling are required when the distinction affects the result.
5. Incorrect joins must be corrected, not hidden with `DISTINCT`. `DISTINCT` can also remove rows needed by the business calculation.
6. FAE selections must include enough key fields to keep separate business records separate. FAE removes identical result rows; duplicate driver rows do not produce repeated output rows as a join might.
7. Repeated FAE driver keys should be removed when that reduces query work. Duplicate business items that need separate processing must remain in the business input.
8. Mixed `AND`/`OR` conditions must use parentheses to make the intended grouping clear. Range `SIGN`, `OPTION`, `LOW`, and `HIGH`, including exclusions, must match the requested selection.
9. Patterns must use the wildcards and escaping required by SQL `LIKE`, ABAP `CP`, regex, or selection options. A pattern valid in one is not necessarily valid in another.
10. Selected columns must fill the intended ABAP fields. Positional or partial assignment, and matching names with different meanings, must not put correct values in the wrong fields.

## 3. Table keys and searches

1. Repeated lookups should use suitable sorted or hashed keys. Unique keys must be used only when the data must be unique; required duplicates must be allowed.
2. Optimized partial-key searches on sorted keys must use their leading fields; hash lookups must use the full hashed key. A sorted table does not make an arbitrary-field search fast.
3. `sy-tabix` must be saved before another operation can overwrite it when needed later. The save need not be on the next physical line; an intervening condition check does not itself invalidate the index. Hashed-table access does not supply a usable row index.
4. An index must be used with the same table key that produced it. A secondary-key index can point to a different row when used with the primary index.
5. Repeated full scans of large standard tables should be replaced by suitable keyed or grouped access. Replacing a parallel cursor must not turn a single pass into repeated full-table scans.

## 4. Changing tables and removing duplicates

1. Explicit table keys are a design preference, not a correctness requirement by themselves. A default key can omit numeric fields or be empty; it is a defect only when its use causes an incorrect operation. A standard table still has a primary key without an explicit key declaration. A free-key `BINARY SEARCH` is valid when the table has the required sort order; the absence of an explicit sorted key does not make it defective.
2. Protected sorted/hashed key fields must not be changed through field symbols or references. Changes to other fields must also respect unique secondary keys.
3. Before `DELETE ADJACENT DUPLICATES`, rows equal under the comparison fields must be adjacent. The order within each duplicate group must retain the intended record.
4. Duplicate retention must resolve ties according to the business rule. `SORT ... STABLE` only preserves the previous order of ties; it cannot make an unordered database result predictable.
5. Row updates must change only the intended fields, using `TRANSPORTING` where suitable. A full-row `MODIFY` with a partly filled work area can blank unrelated fields.
6. Changes to a `LOOP ... INTO` work area must be written back if the table is meant to change. With `ASSIGNING` or a row reference, the code must account for changes taking effect in the table immediately.
7. Changes to the table being looped over must not skip required rows, repeat work, or use invalid row references. Where necessary, changes must be collected and applied after the loop.
8. `COLLECT` must be used only when its key and summed numeric nonkey fields match the calculation. Amounts must not overflow or combine incompatible currencies or units.
9. Lookup tables and secondary keys should be built where their benefit justifies the cost. Rebuilding or maintaining them on every row must not cost more than the reads they are intended to save.

## 5. Work areas and values left from earlier processing

1. Every required work-area field must be filled or initialized before append. Optional fields and nested tables must not retain the previous record's contents accidentally.
2. Fields not assigned by `MOVE-CORRESPONDING` must be initialized separately when old values are unwanted. The same requirement applies to values retained by constructor expressions or `BASE`.
3. Totals, counters, flags, messages, and return tables must be reset at the intended record, group, or call boundary. Early resets must not lose needed data; late resets must not mix records or groups.
4. An inline declaration inside a loop must not be relied on to reset a variable each iteration. A new value requires an executed assignment or initialization.
5. Globals, statics, ABAP memory, and caches must be initialized or refreshed when a new call requires new state. Earlier calls in the same internal session must not supply unintended values.
6. Legacy code must distinguish header work areas from table contents. Clearing a header does not delete the rows. New code must not introduce dependencies on header lines.
7. Result-table operations must replace or append as intended. Repeated `APPENDING TABLE` selections retain earlier results and must be used only when that accumulation is intended.

## 6. Field symbols, references, and dynamic access

1. A field symbol left assigned after a loop must not be treated as a separate work area. It can still point at the last row and must be unassigned when later code could change that row accidentally.
2. A possibly missing or invalid object/data reference must be checked with `IS BOUND` before dereferencing. Optional references must not be used blindly.
3. Row aliases must not be assumed valid after row deletion or table replacement. The required row must be obtained again when the old field symbol or reference is no longer usable.
4. Downcasts must check the actual runtime type or handle the cast exception. The declared reference type does not guarantee the required subtype.
5. Dynamic component access must check the component's existence, type, and length. Structures can differ between systems or releases.
6. Memory reinterpretation with `CASTING` must respect type layout, length, alignment, Unicode, and nested/reference fields. A normal typed conversion is preferable where possible.
7. `OPTIONAL` or `DEFAULT` must be used only when missing data is allowed. Missing mandatory records must not become silent blank values. A checked single read is preferable to an existence check followed by the same lookup.

## 7. Conversions and text

1. Numeric text must be validated for signs, separators, exponents, decimal places, and allowed limits. Invalid input and conversion failures must be handled before the number is used.
2. Assignments to shorter fields or smaller numeric types must not lose required characters or precision. Exact conversion should be used where supported when rounding or truncation must be rejected.
3. Numeric-looking identifiers must retain their identifier meaning. Significant `NUMC` formatting and leading zeros must be preserved; zero removal or ALPHA conversion must match the specific identifier's rules.
4. Required conversion exits must be applied between external and internal formats. Ordinary assignments and SQL do not automatically perform screen conversions.
5. Machine-readable output must use the interface/file's required date and number formats, not formatting that changes with the user's preferences.
6. Offsets and lengths must be within the actual string or byte length. Short or empty input must not cause out-of-range access.
7. Character counts and byte counts must not be confused. Encoding must match the data contract, and encoding errors must not silently corrupt or replace characters.
8. Comparisons must account for padding, trailing blanks, case, and field types. Business identifiers must not be trimmed or case-converted unless allowed.
9. `CORRESPONDING` mappings must match field meanings as well as names. Currencies, units, scales, lengths, and nested structures must be compatible or explicitly converted.
10. Boolean comparisons must follow ABAP's types and values. `abap_bool` is character-based; `boolc` and `xsdbool` return different types. Nonempty values must not be treated as automatically true.

## 8. Numbers, amounts, and quantities

1. A divisor that can be zero must be checked before division, including after calculations or sums. The zero case must reject, skip, or return a defined result.
2. Numeric types must fit intermediate results as well as the final answer. A large result field does not prevent an earlier calculation from overflowing.
3. Exact monetary calculations must use suitable decimal types. Binary floating point cannot represent every decimal amount exactly, and direct equality checks can fail unexpectedly.
4. Packed-number length, decimal places, and the fixed-point arithmetic setting must match the calculation. Changes to a legacy program's setting must account for their effect on existing calculations.
5. Amounts must follow the currency's decimal rules and the API's internal/external format. Two decimal places must not be assumed for every currency.
6. Amounts in different currencies must be converted before addition or comparison, using the correct exchange-rate type, date, direction, and factors.
7. Quantities in different units must be converted before combining them. Required material-specific factors must be used; changing the unit label alone does not convert the number.
8. Rounding must occur at the stage required by the business rule. Item rounding can differ from total rounding; tax and allocation calculations must also handle rounding and leftover fractions correctly.
9. Percentages, ratios, signs, and arithmetic operators must match the business meaning. `5` is not `0.05`; credits may need opposite signs. Integer division or truncation must not discard required decimals.
10. Calculations must handle permitted large totals, negatives, tiny values, and conversion boundaries. Any accepted tolerance must come from the business rule, not conceal a calculation error.

## 9. Dates, times, and intervals

1. Supplied dates must be valid calendar dates, not merely nonblank text. Missing dates must be handled separately from real business dates.
2. Date calculations must follow the required month-end and leap-year rules. Adding 30 days must not be treated as adding one month.
3. Timestamp arithmetic must use supported timestamp operations, not arithmetic on displayed timestamp digits. Conversion and range errors must be handled.
4. Each time value must have a known timezone meaning: UTC, server, user, or business-local. Values from different timezones must be converted before comparison or exchange.
5. Ambiguous or nonexistent local times during daylight-saving changes must follow the required conversion rule. A UTC offset alone must not be treated as a timezone identifier.
6. Long-running code that needs the current time must obtain a fresh value explicitly. `sy-datum` and `sy-uzeit` must not be assumed to refresh continuously.
7. Intervals must define whether their endpoints are included. Midnight, overlaps, gaps, and missing end dates must have the intended behavior.
8. Scheduling must use required factory calendars and working-day rules. Calendar-day arithmetic must not unintentionally schedule work on weekends or holidays.
9. Timestamp-based identity or ordering must handle ties. Where multiple events can share a timestamp, sufficient precision and another identifying/sort field must be used.
10. Date-based batch reads must define a cutoff or another consistent selection rule. Records added or changed during the run must not be silently missed or repeated.

## 10. Commits, rollbacks, and update tasks

1. Save/rollback ownership must remain with the designated application or caller. A SAP LUW can span multiple database LUWs; a helper must not assume it can end either one.
2. A helper must not call `ROLLBACK WORK` unless the caller allows it. Rollback can undo unrelated pending caller changes.
3. Commit boundaries must match whether the business operation is all-or-nothing or allows partial success. Commits inside a loop must not leave a document or process half-finished.
4. Implicit database commits, including relevant `WAIT` statements and execution-context changes, must not break the required transaction. An explicit `COMMIT WORK` is not the only way a database transaction can end.
5. Cursor use must respect commit/rollback rules. `SELECT` loops and package fetches must not try to continue through a cursor closed by a transaction boundary.
6. An update must not be reported as saved just because an update task was registered. Completion must be checked through the supported mechanism, and update failures must retain useful diagnostics.
7. The result of `COMMIT WORK AND WAIT` must be checked where applicable. It must not be treated as confirmation that all V2 updates, queues, asynchronous tasks, or external actions have finished.
8. Saves must use the BAPI/framework's required mechanism. Manual commits or rollbacks must not be added where update-task, RAP, BOPF, or other framework-managed processing forbids them.
9. External actions must be timed around commit or have a defined reversal/compensation path. Rollback must not be assumed to undo sent messages, written files, remote commits, or completed external actions.

## 11. Locks and concurrent updates

1. Relevant data must be re-read and checked after the lock is obtained. A pre-lock read may already be stale because of another session's changes.
2. Enqueue key fields and lock mode must match the intended records. Initial values and generic lock settings must not accidentally broaden the lock.
3. Enqueue failure must stop the protected change or enter explicit conflict handling. A foreign-lock or lock-system error must not be ignored.
4. Lock ownership and `_SCOPE` must match the required handover to update processing. Locks must not be released before the protected change is complete or correctly handed over.
5. Database and SAP logical locks must not be treated as interchangeable. Their scope and lifetime differ, and an enqueue lock cannot stop code that ignores that locking scheme.
6. Writes must not overwrite another session's changes with an old full-row copy. Only intended fields should be changed, with conflict detection where needed.
7. Identifier allocation must use a suitable supported mechanism, not `MAX( key ) + 1`, which can produce the same number in two sessions. Gaps and numbers not returned after rollback must be allowed for where the allocator permits them.
8. Multiple locks must be acquired in a consistent order to reduce deadlocks. Lock duration and retries should be bounded; conflicts must trigger the restart or recheck required by the transaction, not endless waiting.
9. Retries must not duplicate posting or creation. After a timeout, the earlier outcome must be checked before a write is repeated. An in-memory flag alone is insufficient across sessions or job restarts.

## 12. Database writes and related records

1. SAP standard business data must be changed through supported APIs. Direct updates can bypass validation, related-table updates, buffers, change documents, and document-flow records.
2. Database `UPDATE`/`DELETE` conditions must restrict the change to the intended rows. Empty ranges, missing conditions, and incomplete keys must not widen the change accidentally.
3. `sy-dbcnt` must be checked when exactly one or a known number of changed rows is expected. Zero or too many changed rows must have an explicit outcome rather than automatic success.
4. Bulk-write handling must account for the statement's duplicate and partial-failure behavior. Catching an exception must not be assumed to undo successful writes already made.
5. Related changes must be saved together as required by the business operation. Headers, items, statuses, details, balances, and documents must remain consistent after success or failure.
6. Deletion must respect dependent records, retention, and archiving requirements. A DDIC relationship must not be assumed to prevent orphaned business records at database level.
7. Written values must pass required business validation, not just type/length checks. DDIC domains and foreign-key definitions must not be assumed to enforce every rule on arbitrary writes.
8. Simulation/test mode must not change data accidentally through number allocation, update registration, commits, files, outbound calls, or database writes.
9. Records must be marked processed only after the required changes are durably saved. Pending, successful, failed, and unknown outcomes must remain distinct so recovery does not skip unfinished work.

## 13. Return codes and error handling

1. `sy-subrc`, `sy-dbcnt`, and required message fields must be checked or saved before an operation can overwrite them. "Check/save immediately" means before such an operation, not necessarily on the next physical line. Saved results must be checked before dependent processing continues.
2. Error handling must use the actual operation's result. `sy-subrc` must not be treated as freshly set by methods, table expressions, or `line_exists` when their contract uses other values or exceptions.
3. Return codes and classic function-module exceptions must receive their documented handling. Different nonzero codes can need different actions; failure must not fall through into success processing.
4. Exceptions must be caught where they can be handled. `CX_ROOT` must not be caught and ignored while execution continues with missing or partly filled data.
5. After an error, the state needed for safe continuation must be restored, or processing must stop and pass the error to the caller. A log message alone does not repair partially completed work.
6. `MESSAGE` usage must suit the caller's environment. Helpers, update tasks, RFCs, and background jobs must not abort unexpectedly where the caller requires a returned error.
7. Technical return values, business messages, and save results must be assessed separately. A success message must not be treated as evidence of a successful database commit.
8. `CLEANUP` must not be treated as an always-running `finally` block. It runs during relevant exception propagation, not every normal exit or locally handled exception. Resources must also be closed on those other paths.
9. Error reports must retain the business key, message ID/number/variables, and previous exception needed for investigation, without exposing secrets or unnecessary personal data.
10. A batch must continue to the next item only when the previous failure cannot corrupt it. Shared variables, open transactions, and unfinished changes must be handled before continuation.

## 14. BAPIs, RFCs, and interfaces

1. API business return structures must be checked even when no technical exception occurs. A technically successful call can still reject the business request.
2. All relevant return messages must be handled, not just the first. This includes errors, aborts, and warnings requiring business action.
3. Request items, return tables, extension structures, and optional parameters must be cleared or completely filled for each call. Previous-call data and messages must not be reused accidentally.
4. X structures and update indicators must distinguish unchanged fields from fields explicitly set to blank or zero, as required by the API.
5. Identifiers, dates, amounts, quantities, units, and currencies must use the exact internal/external formats expected by the API.
6. RFC communication/system failures and business errors must all be handled. A broken connection must not be treated as evidence that a write failed or can safely be repeated.
7. Remote commit/rollback must occur in the destination and session owning the work. Separate RFC calls must not be assumed to share one transaction.
8. APIs must be released or supported for the intended use, and their prerequisites must be met. Internal function modules can depend on hidden caller state or change across releases.
9. Request/response sizes and processing time must fit serialization, transfer, and remote-memory limits, not just local processing limits.
10. Interface versions and field layouts must match. Missing, extra, or reordered fields must be rejected or handled explicitly, not silently assigned to the wrong business fields.

## 15. Asynchronous work and background jobs

1. Asynchronous work must not be reported as successful merely because it was accepted or started. Success must reflect the required execution, business completion, and saved result.
2. Task results must be received and checked through the required callback/result mechanism. Callback arrival alone does not establish success.
3. Results must be matched to explicit task or business IDs, not arrival order. Parallel tasks can finish out of order.
4. Parallel business changes must be independent or correctly synchronized. Separate work processes can still update the same records.
5. Parallel task counts must be bounded, and resource-allocation failures must be handled. Processing must not exhaust work processes or use a busy loop to wait for completion.
6. Code running in background or RFC without a frontend must not depend on frontend file access, popups, or GUI controls.
7. Background behavior must account for the actual execution user's authorizations, defaults, language, timezone, and number/date formats, not assume the foreground user's settings.
8. Restartable jobs must maintain reliable progress checkpoints. Restarts must not repost completed items or skip items marked complete before their changes were saved.
9. Remote-work mechanisms must provide the required ordering and delivery behavior. Asynchronous RFC, tRFC, qRFC, and bgRFC must not be treated as providing identical guarantees.
10. Business failures must remain visible in job results, application logs, and required follow-up checks even when exceptions are caught. Technical job completion must not imply business success.

## 16. Authorization and security

1. Protected reads and writes must have the required business authorization checks, using the correct objects, organizational values, and activities.
2. Hidden fields, disabled buttons, and transaction-start permissions must not be treated as authorization for every backend operation.
3. Required authorization checks must cover reusable backend entry points too. RFCs, jobs, and other callers can bypass screen checks.
4. Authorization must be checked for the actual read path. Base-table reads must not be assumed to inherit the access rules of CDS entities built over them.
5. SAP client restrictions must be preserved. Native SQL and explicit cross-client reads/writes must have the correct client conditions and authorization.
6. SQL values must use bound parameters instead of concatenated user input. Dynamic table names, field names, and SQL fragments must be restricted to allowed choices; value escaping does not make arbitrary SQL fragments safe.
7. Supplied paths, RFC destinations, program names, and command names must be allowed for the requested operation. Access outside the permitted resources must be rejected.
8. HTML, XML, JSON, and spreadsheet output must use the correct serialization or escaping. Untrusted spreadsheet text must not become an executable formula unintentionally.
9. Passwords, tokens, and unnecessary sensitive data must not appear in source, logs, spool, traces, exceptions, or test files.
10. Connections must use approved secure settings. Certificate checks must not be disabled, and credentials must not be hardcoded merely to bypass connection failures.

## 17. Large data volumes, memory, and paging

1. Resource estimates must account for expected production row counts, row sizes, duplicates, and unusually large groups. Small balanced examples must not be treated as evidence of production performance.
2. Filtering, aggregation, and batch sizes must keep working data manageable. Package reads must not be assumed to save memory when all packages accumulate in one growing table.
3. Performance assessment must include called helpers and the complete operation. Nested scans, repeated sorting, duplicate removal, and lookup-table construction can dominate runtime.
4. Repeated copies of growing tables and strings must be included in memory estimates. Changes to shared table data, nested tables, constructors, and concatenation can trigger large allocations.
5. A large table no longer needed should be released with `FREE` when its allocation must be reclaimed. `CLEAR` may retain allocation; neither operation guarantees immediate return of memory to the operating system.
6. Recursive processing must detect cycles and bound depth where necessary. Bad parent/child relationships must not cause endless recursion or stack overflow.
7. Buffer/index usage must be established for the actual SELECT when performance depends on it. The buffer or index merely existing is insufficient.
8. Claimed database improvements must be supported by suitable measurements on the actual system and representative data. HANA and traditional-database advice must not be applied interchangeably without checking.
9. Paging must use predictable ordering and suitable continuation keys. Its handling of concurrent changes and restarts must prevent unintended skipped or repeated rows; offset-based paging alone may not do so.
10. Caches, strings, logs, output, and tables must have appropriate size/lifetime limits. Timeouts or cancellation must be supported where required, rather than allowing unlimited retries or resource growth.

## 18. Files and uploads

1. Dataset open/read/write/close results and exceptions must be handled according to their contracts. Missing files, denied access, full storage, and partial I/O must have defined failure paths.
2. File access must distinguish application-server files from frontend files. A user's local path must not be assumed available to the server or a background job.
3. Encoding, BOM, line endings, and text/binary mode must match the receiving system's requirements rather than rely on unspecified defaults.
4. CSV parsing must handle quoted fields, escaped quotes, embedded delimiters, and newlines. A simple comma/semicolon split is insufficient for such input.
5. XLSX files must use an XLSX reader/writer; renamed CSV is not a workbook. Spreadsheet conversions must not silently remove required leading zeros or change dates.
6. Upload headers, required columns, types, lengths, row counts, and business keys must be validated before processing. Changed column order must not put values in the wrong fields.
7. Existing filenames and concurrent writers must have explicit handling. One run must not silently overwrite another run's output.
8. Output files must be exposed to consumers only after a successful complete write, using a suitable atomic rename or completion marker where needed.
9. Files and resources must be closed/released on success and failure. Cleanup failures must not replace the original diagnostic information.
10. Input size, row count, expanded archive size, and parser memory/time must be bounded. Small compressed input must not be assumed small after decompression.

## 19. Selection screens, Dynpro, and ALV

1. Screen defaults must be set only at the intended initialization point. Reapplying defaults on every PBO must not erase user edits on redisplay.
2. Fields irrelevant to the selected mode must be cleared or ignored. Hidden or disabled fields can retain old backend values.
3. Field, radio-button, mode, and range combinations must be validated together. Individually valid inputs can form an invalid request.
4. Required business validation must also exist in callable backend logic, because other callers can bypass selection-screen events.
5. Saved OK codes must be copied and cleared at the appropriate point, and `sy-ucomm` must be handled correctly. Old commands must not be processed again unintentionally.
6. ALV actions must identify records by a stable business key. Sorting and filtering must not cause actions on the wrong row because a display position was reused.
7. Pending editable-ALV changes must reach the application table before validation and save. The last cell edit must not be lost because it remains only in the grid control.
8. Edited values and authorization must be validated in the backend before save. Screen editability must not be treated as permission or proof of a valid value.
9. ALV currency/unit references and field metadata must be correct so decimal places and units do not misrepresent amounts or quantities.
10. The UI must show "saved" only after the required save succeeds. Unfinished asynchronous work must be shown as pending, not complete.

## 20. Enhancements, objects, and callers

1. Exits and BAdIs must support their actual call frequency during checks, simulation, recalculation, and save. Repeated calls must not duplicate actions intended to happen once.
2. Check/calculation hooks must not send messages, write files, or perform irreversible actions unless required and safely coordinated with saving.
3. Behavior must match the actual caller, not rely solely on `sy-tcode` or assumed foreground execution. Jobs, RFCs, and APIs can reach the same code without the original screen.
4. Code must not change undocumented SAP globals/buffers or depend on caller data not guaranteed by the enhancement/API. Documented input/output rules must be respected.
5. Cache keys must include relevant client, organization, language, date, user, authorization, or other answer-changing context. Cached data must be refreshed or invalidated after relevant changes.
6. Mutable references to internal data must not let callers bypass required object validation. Copies or controlled methods must be used where needed to protect the data.
7. Constructor calls to overridable methods must not use data that is not yet initialized. Initialization errors must not be swallowed while a partly initialized object remains in use.
8. `CHECK`, `EXIT`, `CONTINUE`, and `RETURN` must leave or skip the intended loop/block at their actual location. Nested processing must not stop too much or too little work.
9. `AT NEW` and `AT END OF` must respect sort order and row-field order. Fields to the left affect control breaks; work-area changes inside the block must be accounted for. Explicit grouping is preferable when it avoids these dependencies.
10. The target system must have the required release features, DDIC objects, customizing, transports, and business data. Activation success alone must not be treated as confirmation that these runtime prerequisites are satisfied.

Responses must stay focused on actual findings and work done. These requirements should improve the code, not lengthen the explanation.