---
name: abap-coding-pitfalls
description: 'ABAP coding pitfalls that cause wrong results, dumps, and inconsistent data despite valid syntax. Use when writing, changing, refactoring, debugging, or reviewing reports, classes, function modules, enhancements, BAPIs, interfaces, and jobs. Covers stale loop state, SELECT and FOR ALL ENTRIES, binary search, parallel cursors, internal-table keys, conversions, LUWs, locks, retries, and production-volume risks. Apply relevant checks internally; report findings and blockers, not a compliance checklist.'
---

# ABAP Coding Pitfalls

Prevent non-syntax ABAP defects during implementation, modification, analysis, and review. Apply this guidance internally; report meaningful findings, unresolved risks, and verification limits, not passed-check lists unless requested. Never claim verification that was not performed.

## Examples of syntactically valid ABAP that goes wrong

These examples illustrate failure patterns; apply the remaining guidance wherever relevant as well.

- **A lookup succeeds for one loop iteration and fails for the next.** `READ TABLE ... INTO` and single-row `SELECT` targets can retain previous contents. Check the current result before using the target; distinguish not-found from a matching row with initial values. Initialize iteration-local state or assign it completely on every applicable path. Do not clear intentional accumulators or redundantly clear fully overwritten values.
- **`INSERT` and `MODIFY` are treated as interchangeable for an internal table.** Use `INSERT ... INTO TABLE` to add a row; use `MODIFY TABLE` to change a row found by the primary table key. `MODIFY TABLE` does not insert a missing row; index-based `MODIFY` changes the selected index instead. Duplicate unique keys can cause a return-code failure, exception, or dump, depending on the statement form and key. Check `sy-subrc` where the operation reports it and handle the documented duplicate behavior, including bulk inserts, constructors, and unique secondary keys. Do not replace `INSERT` with `MODIFY` just to hide a duplicate; decide whether to reject, skip, merge, or update it.
- **Database `INSERT` is used for an existing key, or `MODIFY` overwrites a row that should only be created.** Use database `INSERT` for create-only, `UPDATE` for change-only, and `MODIFY` only for intentional insert-or-update by primary key. Handle duplicate primary keys and unique secondary-index conflicts; depending on the statement form, these produce a return code, exception, or dump. `MODIFY` does not eliminate every unique-index conflict. Do not ignore duplicates unless the business rule allows it, and do not rely on a preceding existence read to prevent concurrent inserts.
- **A binary search follows an incompatible sort or later table mutations.** Before `BINARY SEARCH` on a standard table, establish ascending order with search components in the same sequence as the leading sort components, and preserve that ordering. Unrelated, descending, or text-collated sorts are insufficient. Prefer a suitable declared table key where possible.
- **An index-based parallel cursor starts at the wrong row or crosses a group boundary.** Establish compatible ordering, locate the first matching group row, save the successful index immediately, and scan `FROM` that index. Stop when the complete group key differs (`NE`/`<>`). Handle duplicates on both sides: do not consume a group a later duplicate outer row still needs, or reuse a previous group's index after a failed search.
- **`SELECT ... FOR ALL ENTRIES IN @lt_keys` runs when `lt_keys` is empty.** Check `IF lt_keys IS NOT INITIAL` before executing that SELECT, or return/skip explicitly when the table is empty. Never execute FAE with an empty driver table: the entire explicit `WHERE` condition can be ignored and all rows in the remaining implicit scope, such as the current client, can be read. Define the empty-result/error path so an old result table is not reused accidentally.
- **An empty selection range is intended to mean "nothing."** `field IN range` with an initial range generally imposes no restriction. Handle the intended empty-input meaning explicitly.
- **A very large range table is passed to `SELECT ... WHERE field IN @lt_range`.** The generated SQL can exceed database statement-size or parameter limits and cause a database error or dump. Do not build an unbounded `IN` range from a large key list. For exact inclusion keys, use guarded `FOR ALL ENTRIES`, a supported join, or bounded key batches as appropriate; test representative volumes because limits depend on the database and execution path. FAE removes duplicate result rows and is not a general replacement for range semantics. Do not blindly convert or split exclusions, intervals, or patterns into FAE equality checks or unioned batches. Do not assume FAE is unlimited or that one hardcoded range size is safe on every system.
- **`SELECT SINGLE` is used to choose the latest record from multiple matches.** Reserve it for unique lookups or intentional arbitrary-match/existence checks. Use explicit ordering and a tie-breaker for first, latest, preferred, or top-N records; without `ORDER BY`, database row order is not a contract.
- **A loop or callback performs a database read on every invocation, possibly inside a helper.** Round trips grow with input volume. Prefer set-based retrieval or a keyed lookup; retain bounded or buffered point reads only when their cost and semantics justify them.
- **`SELECT *` retrieves wide rows when only a few fields are used.** Select explicit columns by default to avoid unnecessary transfer and memory consumption. Retrieve complete rows only when genuinely required and the volume and row width are acceptable.
- **A field symbol is used without being assigned.** Before reading or writing `<row>` or its components, check `IF <row> IS ASSIGNED` when assignment is not guaranteed on the current path. Otherwise dereferencing it can cause `GETWA_NOT_ASSIGNED`. If it is unassigned, skip, return, or raise the appropriate error; never continue to the dereference. A successful `LOOP ... ASSIGNING` establishes assignment inside that iteration unless subsequent code invalidates it; no redundant check is needed there.
- **A failed dynamic `ASSIGN` leaves an older field-symbol binding in place.** Check the current operation's result: where failure preserves a binding, `IS ASSIGNED` alone can describe the wrong object. Unassign explicitly when needed.
- **A table expression assumes an optional record exists.** An absent line can raise `CX_SY_ITAB_LINE_NOT_FOUND`. Define the missing-row behavior and handle expected absence without masking other exceptions.
- **A reusable helper commits work owned by its caller.** `COMMIT WORK` in exits, BAdIs, helpers, or framework-managed processing can commit unrelated changes. Do not issue it unless the transaction contract explicitly permits it.
- **Two sessions read the same state and both act on a decision that is no longer valid.** Protect read-decide-write sequences against concurrent change using appropriate locks, atomic writes, or optimistic conflict detection; an existence check alone does not protect creation.

## Application

- Establish the affected inputs, keys, ordering, state, callers, side effects, and transaction ownership. Follow success, not-found, skipped-assignment, exception, retry, and repeated-call paths.
- Stay within the requested task and permissions: identify issues or make the smallest safe changes as appropriate. Ask only when missing information blocks safe progress. Do not perform business writes, commits, jobs, or large validation loads without authorization.
- Preserve duplicate handling, ordering, rounding, atomicity, and authorization semantics. Prefer explicit keys, complete values, bounded selections, and typed interfaces over redundant defensive operations.
- Distinguish correctness requirements, performance warnings, and context-dependent restrictions. Check uncertain semantics against authoritative information for the actual release, database, and execution context; ECC does not imply a non-HANA database.
- Use focused tests where supported and authorized. Static inspection, syntax checks, ATC, tests, and traces provide different evidence; none alone establishes business correctness.

## 1. Database reads and selection scope

1. Include all relevant key and context fields: client handling, organization, plant, valuation area, language, status, version, and validity as applicable.
2. Define zero, one, and multiple-match behavior. Do not silently pick one row when multiple matches indicate inconsistent business data.
3. Bound read volume at the business selection boundary. A late ABAP filter does not undo excessive transfer or memory allocation.
4. Treat aggregate results according to their actual SQL semantics. A successful aggregate read does not establish that underlying business rows exist; check counts and grouping behavior explicitly.

## 2. Joins, predicates, and result identity

1. Join on the complete relationship. Missing key components and unintended many-to-many joins multiply rows without a syntax error.
2. Aggregate at the correct grain. Do not sum header values after joining them to multiple items unless the intended calculation accounts for that repetition.
3. Place outer-join filters deliberately. A `WHERE` condition on the nullable side can eliminate unmatched rows and defeat the intended outer join.
4. Distinguish SQL `NULL` from ABAP initial values. Account for null comparisons, aggregates, and conversion into ABAP; use null indicators or explicit SQL handling when the distinction matters.
5. Do not hide incorrect joins with `DISTINCT`. Retain legitimate multiplicity and correct the relationship instead.
6. Preserve distinguishing columns when using `FOR ALL ENTRIES`: duplicate result rows are removed. Do not treat it as a join that preserves driver multiplicity.
7. Deduplicate `FOR ALL ENTRIES` driver keys when useful for volume. Do not confuse that optimization with result deduplication or change business-level duplicate behavior.
8. Parenthesize mixed `AND`/`OR` conditions. Check range `SIGN`, `OPTION`, `LOW`, `HIGH`, exclusions, and unintended broad conditions.
9. Use the correct pattern language and escaping. SQL `LIKE`, ABAP `CP`, regular expressions, and selection options do not share one wildcard syntax.
10. Map selected columns deliberately. Do not depend on positional compatibility, incomplete target updates, or similarly named fields with different meanings.

## 3. Searches, sorting, and parallel cursors

1. Prefer explicit sorted or hashed keys that enforce the required access semantics. Choose unique versus nonunique keys from the business relationship, not convenience.
2. Use compatible leading key components for optimized sorted-table access and the full key for hashed access. A sorted table declaration does not optimize every arbitrary predicate.
3. Treat `sy-tabix` as volatile and access-path-specific. Save needed values before other table operations; hashed access does not provide a usable sequential row index.
4. Do not mix a secondary-key index with primary-index access. A saved number identifies a position in a particular index, not a permanent business row.
5. Replace repeated large standard-table scans and fragile manual cursors with suitable keyed access or grouping when possible. Do not replace a correct linear merge with an accidentally quadratic algorithm.

## 4. Table mutation and duplicate handling

1. Declare table keys deliberately. Default keys can omit numeric components or be empty; generic operations may then group or match differently from the business key.
2. Do not change protected sorted/hashed key components through aliases. Account for unique secondary keys when updating other components too.
3. Before `DELETE ADJACENT DUPLICATES`, make rows equal under the comparison fields adjacent. Choose explicitly which business record survives.
4. Use explicit tie-breakers, or a meaningful stable ordering, for survivor selection. `STABLE` cannot create deterministic order from an unordered database result.
5. Update only intended components. A partially populated work area used for full-row `MODIFY` can erase unrelated values.
6. Remember that `LOOP ... INTO` copies a row, while `ASSIGNING` and row references alias it. Write back copied changes deliberately and avoid accidental aliased changes.
7. Do not insert, delete, sort, or structurally replace an iterated table without accounting for traversal and alias effects. Prefer a safe two-phase transformation when needed.
8. Use `COLLECT` only when its key and accumulation of numeric nonkey components match the intended aggregation. Check overflow and unit/currency compatibility.
9. Keep lookup and secondary-key maintenance costs in view. A fast read structure can be expensive to build or mutate repeatedly.

## 5. Loop state, targets, and initialization

1. Construct appended rows completely, including optional fields and nested tables. Partial assignment must not carry the previous record's data forward.
2. Do not treat `MOVE-CORRESPONDING` as complete initialization. Unmatched target components may retain old values; constructor and `BASE` forms have different preservation semantics.
3. Reset totals, counters, flags, messages, and return tables at their intended record/group/call scope, not simply at the nearest loop.
4. Do not assume inline declaration inside a loop creates fresh block-local state each iteration. The executed assignment, not declaration placement, establishes the current value.
5. Give globals, statics, ABAP memory, and caches an explicit lifecycle. Repeated invocations in the same internal session must not inherit accidental prior state.
6. In header-line code, distinguish the header from the table body. Clearing a header does not remove its rows; avoid introducing new header-line dependencies.
7. Distinguish replacing a table from appending to it, including database target forms. Repeated calls must not accumulate old results unless that is intentional.

## 6. Field symbols, references, and dynamic operations

1. After a loop, treat surviving field symbols as aliases, not independent work areas. Unassign when continued binding would enable accidental modification.
2. Check references with `IS BOUND` where absence or invalidation is possible; do not dereference optional references blindly.
3. Do not retain row aliases across deletion or structural replacement without respecting their validity and identity rules.
4. Guard downcasts using the expected runtime type or handle the relevant cast exception. Declared reference type does not establish the object's actual subtype.
5. Validate dynamic component names, existence, type, and length. Do not assume DDIC layouts are identical across systems or releases.
6. Avoid unchecked memory reinterpretation with `CASTING`. Account for alignment, Unicode, lengths, and deep components; prefer typed conversion.
7. Use `OPTIONAL`, `DEFAULT`, or existence checks only when their semantics are appropriate. Do not turn missing mandatory data into a plausible initial value or read the same row twice unnecessarily.

## 7. Conversion, text, and data contracts

1. Validate external numeric input before conversion, including sign, separators, exponent, precision, and bounds. Handle relevant conversion failures at the input boundary.
2. Reject unintended truncation and precision loss when moving into shorter/narrower targets. Use exact conversion where supported and required.
3. Preserve identifier semantics. `NUMC` and leading zeros are not ordinary arithmetic values; not every identifier uses ALPHA conversion.
4. Apply required conversion exits explicitly at boundaries. SQL and ordinary assignments do not automatically reproduce screen conversion behavior.
5. Use locale-independent formats for machine interfaces. User-dependent dates, decimal separators, and grouping are presentation concerns.
6. Check offsets and lengths against actual data before substring or byte access. Handle short, empty, and malformed input.
7. Distinguish characters from encoded bytes. Choose code pages explicitly and handle conversion errors rather than silently corrupting text.
8. Account for fixed-length padding, trailing blanks, case, and comparison type. Do not normalize business identifiers unless their contract permits it.
9. Check semantic compatibility for `CORRESPONDING` and similarly named fields: units, scale, meaning, lengths, and nested mappings can differ.
10. Use actual ABAP boolean conventions. `abap_bool` is character-based, and `boolc`/`xsdbool` have different result types; do not apply another language's truthiness rules.

## 8. Numbers, amounts, and quantities

1. Guard denominators, including values produced by calculations or aggregation. Define the business outcome for division by zero.
2. Size operands and intermediate calculations, not just the final target. Overflow can occur before assignment.
3. Use suitable decimal arithmetic for exact financial calculations. Do not rely on binary floating-point equality or representation for exact amounts.
4. Respect packed-number length, decimal places, and the legacy program's fixed-point arithmetic setting. Do not change that setting casually.
5. Preserve currency-dependent decimal semantics. Not every currency has two decimals; use the interface's documented internal/external amount conversion.
6. Do not add or compare amounts in different currencies without an explicit conversion policy, rate type/date, quotation direction, and factors.
7. Convert quantities using the relevant unit and material-specific factors. A unit label change is not a quantity conversion.
8. Place rounding at the business-defined stage. Line rounding, aggregate rounding, tax rounding, and allocation residuals can produce different totals.
9. Distinguish ratios from percentages, quantities from values, and debit/credit signs. Prevent accidental integer division or truncation.
10. Test extreme totals, negatives, tiny values, and conversion boundaries. Do not use an arbitrary tolerance to conceal an incorrect calculation.

## 9. Dates, times, and intervals

1. Validate calendar dates, not just noninitial text. Give missing dates a policy distinct from real business dates.
2. Use calendar-aware month/year arithmetic. A fixed day count does not implement one month, especially at month-end or leap years.
3. Use supported timestamp operations rather than arithmetic on timestamp digits. Check range and conversion errors.
4. Distinguish UTC, server time, user-local time, and business timezone. Convert explicitly at boundaries.
5. Handle daylight-saving gaps and ambiguities according to the business/interface contract. Do not invent a timezone from an offset alone.
6. Acquire current time explicitly when freshness matters in long-running processing. Do not assume `sy-datum`/`sy-uzeit` are continuously refreshed clocks.
7. Define inclusive/exclusive interval ends, midnight behavior, gaps, overlaps, and open-ended validity.
8. Apply factory calendars and business-day rules where required; calendar days are not automatically working days.
9. Use enough precision and a tie-breaker for event ordering. A timestamp alone is not necessarily unique.
10. When paging or processing temporal data, use a deliberate cutoff/snapshot policy. New or changed records must not silently invalidate the selection window.

## 10. LUWs and transaction ownership

1. Identify the owner of the SAP LUW and database LUW. They are not interchangeable, and a reusable routine does not automatically own either boundary.
2. Do not issue `ROLLBACK WORK` from a component without an agreed contract. It can discard unrelated caller changes.
3. Choose atomic versus partial-success processing deliberately. Per-row commits can leave half of one business operation completed.
4. Account for implicit database commits and context transitions. Do not use potentially committing statements such as `WAIT` casually inside a transaction.
5. Respect database-cursor lifetime across commits/rollbacks, including `SELECT` loops and package fetching. A saved cursor is not automatically usable afterward.
6. Distinguish registering update work from successful persistence. Handle update failures and their diagnostics; registration is not completion.
7. Do not treat `COMMIT WORK AND WAIT` as completion of all V2, queued, asynchronous, and external work. Check the guarantees and result of the actual completion mechanism.
8. Follow the BAPI, update-task, RAP, BOPF, or other framework's transaction contract. Do not insert manual transaction boundaries into managed save sequences.
9. Coordinate irreversible effects with commit. Rollback cannot retract files, sent messages, remote commits, or already completed external actions; use appropriate deferred delivery or compensation.

## 11. Locks, conflicts, and retries

1. Acquire the required lock before relying on mutable state, then re-read/revalidate that state. A pre-lock read may already be stale.
2. Use the full intended enqueue key and correct lock mode. Initial key values and generic lock parameters can unexpectedly broaden the lock.
3. Handle enqueue failure explicitly. Do not continue a protected operation after a foreign-lock or lock-system failure.
4. Respect lock ownership, `_SCOPE`, handover to update processing, and release timing. Do not unlock before the protected work is safely completed/handed over.
5. Do not treat database locks as substitutes for SAP logical locks, or enqueue locks as guarantees that every writer cooperates.
6. Avoid lost updates from full-row writes of stale data. Update intended fields and use conflict checks where required.
7. Use supported allocation mechanisms for identifiers, not `MAX( key ) + 1`. Do not assume number allocation is gap-free or rolled back with the document.
8. Acquire multiple locks in a consistent order and avoid unnecessary long holds. Handle conflicts with bounded, transaction-aware retries rather than infinite waits.
9. Make repeatable writes idempotent where required. A timeout means the result may be unknown; reconcile before retrying, and do not rely solely on an in-memory duplicate flag.

## 12. Persistent writes and business integrity

1. Use supported business APIs for SAP standard data. Direct table changes can bypass validation, related updates, buffers, change documents, and document flow.
2. Validate destructive selection scope before `UPDATE`/`DELETE`, especially empty ranges, missing predicates, and incomplete keys.
3. Check affected-row counts where exactly one or a bounded number is expected. Zero or excess changed rows require a deliberate outcome.
4. Handle mass-write duplicate and failure behavior for the exact operation. Catching an error does not automatically undo earlier successful writes.
5. Maintain header/item, status/detail, balance/document, and other cross-table invariants within the intended transaction.
6. Respect application relationships, retention, and archiving rules before deletion. DDIC relationships do not necessarily provide enforced database referential integrity.
7. Validate business values even when the database accepts their technical representation. Domains and foreign-key metadata do not replace application validation for arbitrary writes.
8. Keep test/simulation mode free of unintended effects, including commits, number consumption, update registration, files, and outbound requests.
9. Distinguish pending, committed, failed, and indeterminate outcomes in status and reconciliation. Do not mark a business object processed before the necessary durable result exists.

## 13. Return codes, exceptions, and cleanup

1. Check or save `sy-subrc`, `sy-dbcnt`, and needed message fields immediately after the relevant operation, before another statement overwrites them.
2. Do not infer a fresh `sy-subrc` from constructs that do not set it. Method calls, table expressions, and `line_exists` have their own result contracts.
3. Interpret the specific return codes and classic function-module exceptions. Do not treat every nonzero code as the same condition or fall through into success processing.
4. Catch expected exceptions at a boundary that can handle them. Do not swallow `CX_ROOT` and continue with invalid or partially initialized state.
5. Restore necessary invariants on failure or propagate failure. Logging alone does not make partially completed work safe to continue.
6. Use messages appropriate to the execution context. Terminating messages in libraries, update processing, RFC, or background can interrupt the caller or job.
7. Do not equate a success message with a successful commit. Evaluate technical, business, and persistence outcomes separately.
8. Treat `CLEANUP` as exception-unwinding handling, not a universal `finally`. Normal exits and locally handled exceptions need their own resource lifecycle.
9. Preserve actionable diagnostic context: business key, message identifiers/variables, and previous exceptions. Avoid disclosing secrets or unnecessary personal data.
10. Do not continue after an error simply to collect more results if state is no longer isolated. Define whether the next item can safely proceed.

## 14. BAPIs, RFCs, and interfaces

1. Check business return structures even when the technical call succeeds. No exception does not mean the business operation succeeded.
2. Inspect all relevant return messages, not just the first. Apply the interface's error/abort handling and any business-significant warning policy.
3. Initialize request items, return tables, extension structures, and optional parameters per call. Do not leak earlier calls' payloads.
4. Supply update indicators/X structures correctly. Distinguish leave-unchanged from explicitly set-to-initial.
5. Validate internal/external identifier, date, amount, quantity, unit, and currency formats against the interface contract.
6. Handle RFC communication and system failures separately from business errors. Preserve indeterminate outcomes rather than treating them as safe retries.
7. Complete remote transactions in the correct destination/session context. Arbitrary RFC calls do not automatically share one transactional session.
8. Use released/supported APIs and their documented prerequisites. Internal function modules can require hidden state or change across releases.
9. Bound payload sizes and processing time. Consider serialization, transfer, and remote memory limits, not just local computation.
10. Version and validate interface schemas. Missing, extra, or reordered fields must not silently populate the wrong business attributes.

## 15. Asynchronous work and background jobs

1. Distinguish dispatch acceptance, execution, business success, and committed completion for asynchronous work.
2. Receive and evaluate task results using the required callback/result mechanism. Callback arrival alone is not success.
3. Correlate results with explicit task/business identifiers. Callbacks can arrive out of launch order.
4. Parallelize only independent business operations or deliberately synchronized shared state. Separate work processes do not provide business isolation by themselves.
5. Bound parallel tasks and handle resource refusal. Do not exhaust work processes or use busy-wait loops.
6. Keep background/RFC paths free of frontend file services, interactive popups, and unavailable GUI controls.
7. Account for the background user's authorizations, defaults, language, timezone, and formatting rather than assuming the foreground user's context.
8. Use durable checkpoints and restart-safe processing. A job restart must not repost completed work or skip work marked complete too early.
9. Match queue ordering and delivery guarantees to requirements. Ordinary asynchronous RFC, tRFC, qRFC, and bgRFC are not interchangeable.
10. Reflect business failures in job/application outcomes and reconciliation even when exceptions are caught. A technically finished job can still have failed business work.

## 16. Authorization, isolation, and security

1. Perform required business authorization checks for reads and writes using the correct objects, organizational fields, and activities.
2. Do not treat a hidden field, disabled button, or transaction entry check as authorization for every backend operation.
3. Apply authorization in reusable service paths too. Background, RFC, tests, and other callers may bypass the original UI checks.
4. Check actual authorization coverage for CDS and other access paths. Reading underlying tables does not inherit every higher-level access control.
5. Preserve client isolation. Native SQL and explicit cross-client access need deliberate client conditions and authorization.
6. Bind values in dynamic SQL; allowlist dynamic identifiers and fragments. Escaping a value is not validation of a table name or full predicate.
7. Validate paths, destinations, programs, and command names against the intended operation. Prevent unauthorized resource access and path traversal.
8. Use context-appropriate serialization/escaping for HTML, XML, JSON, and spreadsheet output. Consider formula interpretation when exporting untrusted cell text.
9. Keep credentials and unnecessary sensitive data out of source, logs, spool, traces, exceptions, and test artifacts.
10. Use approved secure destinations and transport settings. Do not weaken certificate checks or hardcode credentials to bypass connection failures.

## 17. Production volume, memory, and paging

1. Design for representative cardinality, row width, duplicate density, and skew. Development-sized data does not establish production safety.
2. Filter and aggregate at an appropriate layer, then process bounded working sets. Packaging is ineffective if every package is accumulated in memory.
3. Check whole-path complexity, including helper calls, nested scans, repeated sorting, deduplication, and lookup construction.
4. Account for copy-on-write and deep structures when modifying large tables. Repeated constructor/concatenation patterns can allocate and copy growing results.
5. Use `FREE` when releasing a large table's allocation is appropriate; `CLEAR` is not a guarantee of full memory release, and neither promises immediate OS-level reclamation.
6. Bound recursion and detect cycles in traversals. Bad hierarchical data must not cause infinite recursion or stack exhaustion.
7. Validate buffering and database-plan assumptions for the actual access form. Do not assume a buffer/index is used because it exists.
8. Measure database-specific optimization with representative traces. Do not apply HANA pushdown or traditional-database advice blindly.
9. Page with deterministic ordering and continuation keys where appropriate. Offset paging over changing data can skip or duplicate records; define consistency and restart behavior.
10. Bound caches, strings, logs, and output as well as tables. Include cancellation/timeouts where appropriate and avoid unbounded retries or resource growth.

## 18. Files and external data

1. Check dataset open/read/write/close outcomes and relevant exceptions. Handle missing files, permissions, storage exhaustion, and partial I/O.
2. Distinguish application-server and frontend files. A path valid on one machine/context may not exist on the other.
3. Define encoding, BOM, newlines, and text/binary mode explicitly according to the interface contract.
4. Parse CSV with quoting, escaped quotes, embedded delimiters, and embedded newlines; do not rely on a simple delimiter split.
5. Use a real XLSX reader/writer for XLSX. Renaming CSV does not create a workbook, and spreadsheet formatting can alter identifiers or dates.
6. Validate headers, required columns, types, lengths, row counts, and business keys before processing. Reject malformed layouts instead of shifting fields silently.
7. Handle filename collisions and concurrent producers deliberately. Do not overwrite another run's output accidentally.
8. Publish only complete files using an appropriate completion/atomic-publication protocol. Consumers must not process a partially written export.
9. Close/release resources on successful and exceptional paths. Keep original failure diagnostics if cleanup also fails.
10. Limit file sizes, row counts, expanded archive content, and parser resource consumption before trusting external input.

## 19. Selection screens, Dynpro, and ALV

1. Do not reset user input during every PBO cycle. Separate first-time defaults from redisplay processing.
2. Clear or ignore inactive mode-specific fields deliberately. Hidden/inactive controls can still retain values used by backend logic.
3. Validate combinations of fields, modes, radio buttons, and ranges, not just individual values.
4. Enforce business validation in callable backend logic, not solely selection-screen events.
5. Handle `sy-ucomm`/OK-code lifecycle explicitly so retained commands do not execute again accidentally.
6. Use stable business identifiers for ALV actions. Display row numbers can change with sorting/filtering and are not permanent row identities.
7. Transfer and validate pending editable-grid changes before saving; the last edited cell may not yet be reflected in the application table.
8. Revalidate edited data and authorization in the backend. Frontend editability does not establish a valid write.
9. Supply correct currency/unit references and field metadata so displayed amounts, decimals, and quantities retain their meaning.
10. Show saved/success only after the relevant persistence outcome, and distinguish pending asynchronous completion when applicable.

## 20. Enhancements, OO state, and execution context

1. Assume exits/BAdIs may run repeatedly during checks, simulation, recalculation, and save. Make behavior safe for the actual invocation lifecycle.
2. Keep irreversible side effects out of pure validation/calculation hooks unless explicitly required and safely coordinated.
3. Do not assume `sy-tcode`, foreground execution, or one entry point establishes the caller's business context. APIs and jobs can reach the same logic differently.
4. Avoid mutating undocumented SAP globals/buffers or relying on hidden caller state. Preserve the enhancement/API contract.
5. Key caches by every relevant context dimension and define invalidation after changes. Client, organization, language, date, user, and authorization may affect the answer.
6. Do not expose mutable references that bypass an object's invariants. Copy or encapsulate state when ownership requires it.
7. Avoid overridable calls during incomplete construction and partially initialized objects after caught initialization failures.
8. Check the scope of `CHECK`, `EXIT`, `CONTINUE`, and `RETURN`. A valid statement can leave the wrong loop or processing block.
9. For classic control breaks, respect field hierarchy/order and work-area changes inside `AT NEW`/`AT END OF` blocks. Prefer explicit grouping when it removes fragile dependencies.
10. Account for release, DDIC, customizing, transport dependencies, and existing-data differences. Activation alone does not establish valid runtime prerequisites.

## Focused validation

Choose tests from the applicable risks; do not generate all of these for every change or report each as a passed check:

- Empty input, empty range/driver, no match, initial-valued match, and multiple matches.
- First/last row, missing group, duplicate keys on either side, unsorted input, and post-sort mutation.
- Success followed by not-found, skipped assignment, exception, or another call in the same session.
- Zero/negative/extreme amounts, currency/unit differences, truncation, invalid text, and rounding boundaries.
- Month-end, leap day, timezone transitions, interval ties, and exact validity boundaries.
- Commit/update failure, lock conflict, concurrent creation/update, timeout with unknown outcome, and retry after partial success.
- Background versus foreground execution, unauthorized input, malformed files, large/skewed data, and job restart.

Keep the external response proportional to actual findings and work performed. The purpose of these rules is safer ABAP, not longer explanations.