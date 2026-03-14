---
name: abap-performance-ecc
description: ABAP performance best practices for ECC / traditional database systems (Oracle, DB2,MSSQL, MaxDB). Use when writing or reviewing ABAP code on NON-HANA systems.IMPORTANT: First use the SAP system info tool to check the system type — if the system is S/4HANA or runs on HANA DB, load the abap-performance-hana skill instead. Covers database access, buffering, internal table optimization, and ECC-specific patterns.
argument-hint: '[ABAP code to optimize on ECC]'
user-invocable: true
disable-model-invocation: false
---

# ABAP Performance — ECC / Traditional Database

These rules apply to SAP ECC systems running on traditional databases (Oracle, DB2, MSSQL, MaxDB).

**Before using this skill:** Call the SAP system info tool. If the system is S/4HANA or HANA DB, use the `abap-performance-hana` skill instead.

**Core philosophy on ECC:** Minimize database round-trips. Keep SQL simple — traditional DBs don't optimize complex expressions well. Buffer aggressively. Move complex logic to ABAP.

---

## Database Access

### SELECT Patterns

- Select only the fields you need. Never use `SELECT *` in production code.
  ```abap
  " good
  SELECT matnr maktx FROM mara INTO TABLE itab.
  " bad
  SELECT * FROM mara INTO TABLE itab.
  ```

- Always use a WHERE clause. Never read an entire table without filtering.

- Prefer JOINs over nested SELECTs. One round-trip is always better than N.
  ```abap
  " good — single round-trip
  SELECT m~matnr t~maktx
    FROM mara AS m
    INNER JOIN makt AS t ON t~matnr = m~matnr
    WHERE m~mtart = material_type
      AND t~spras = sy-langu
    INTO TABLE materials.
  ```

- BUT keep JOINs simple on ECC. Avoid more than 3-4 table JOINs — traditional DBs may generate poor execution plans. Split into two SELECTs if needed.

- Use `FOR ALL ENTRIES` when JOINs aren't possible. **Always check driver table is not empty.**
  ```abap
  IF itab[] IS NOT INITIAL.
    SELECT matnr werks FROM marc
      FOR ALL ENTRIES IN itab
      WHERE matnr = itab-matnr
      INTO TABLE plant_data.
  ENDIF.
  ```

- `FOR ALL ENTRIES` removes duplicates from results. Add extra key fields if you need duplicates.

- Use `UP TO n ROWS` when you only need a limited result set.

- **ECC-specific:** Avoid subqueries, CASE expressions, and complex SQL functions in SELECT — traditional DBs often create poor plans for these. Fetch data and process in ABAP.

- **ECC-specific:** Be careful with `ORDER BY` on large result sets — it can be expensive. If you need sorted data, consider fetching into a SORTED table type or sorting in ABAP.

### Avoiding Redundant DB Access

- Never SELECT the same data twice. Read once, store in internal table, reuse.

- Use `READ TABLE` with key on a buffered internal table instead of `SELECT SINGLE` in a loop.
  ```abap
  " good — read from buffer
  SELECT matnr maktx FROM makt WHERE spras = sy-langu INTO TABLE texts.
  SORT texts BY matnr.
  " later in a loop:
  READ TABLE texts WITH KEY matnr = current_matnr BINARY SEARCH INTO text_line.

  " bad — SELECT in every loop iteration
  LOOP AT items INTO item.
    SELECT SINGLE maktx FROM makt WHERE matnr = item-matnr AND spras = sy-langu INTO desc.
  ENDLOOP.
  ```

- When using `FOR ALL ENTRIES`, populate a HASHED or SORTED table as lookup buffer.

### Table Buffering (Critical on ECC)

Buffering is **more important on ECC** than on HANA because traditional DBs are slower for small lookups.

- Know the buffering types:
  - **Full buffering**: entire table on first access. Good for small config tables (T001, T005, etc.).
  - **Generic buffering**: by key prefix. Good for language-dependent tables (T002T, etc.).
  - **Single-record buffering**: individual rows. Good for large tables with single-record access.

- Use `SELECT SINGLE` on buffered tables — it reads from buffer. `SELECT ... UP TO 1 ROWS` **bypasses the buffer**.
  ```abap
  " good — uses buffer
  SELECT SINGLE * FROM t001 WHERE bukrs = bukrs INTO company.

  " bad — bypasses buffer
  SELECT * FROM t001 UP TO 1 ROWS WHERE bukrs = bukrs INTO company.
  ```

- Avoid `BYPASSING BUFFER` unless you need absolute latest DB state.

- JOINs, aggregates, `DISTINCT`, `GROUP BY`, `ORDER BY`, subqueries **all bypass the buffer**. On buffered tables, use simple SELECTs.

- **ECC tip:** For frequently accessed config data, consider reading the full small table into an internal table once (application-level cache) rather than hitting the DB buffer repeatedly.

### Indexes

- **ECC-specific:** Be aware of secondary indexes on tables you SELECT from. Design WHERE clauses to match index fields in order.
- If your SELECT is slow, check if a secondary index exists and whether your WHERE clause uses it.
- On ECC, the optimizer depends more on correct index usage than on HANA where columnar storage helps.

---

## Internal Tables

### Table Type Selection

Choose the right table type — this is the single biggest performance lever:
- **HASHED**: O(1) lookup. Large tables with unique key, read-heavy, filled once.
- **SORTED**: O(log n) lookup. Large tables, non-unique key, range access, incremental fill.
- **STANDARD**: O(n) unless sorted + binary search. Small tables or sequential-only.

For lookup tables, **always use HASHED or SORTED**:
```abap
" good — O(1) lookup
DATA materials TYPE HASHED TABLE OF mara WITH UNIQUE KEY matnr.
READ TABLE materials WITH TABLE KEY matnr = input INTO mat.

" bad — O(n) scan
DATA materials TYPE STANDARD TABLE OF mara.
READ TABLE materials WITH KEY matnr = input INTO mat.
```

### Loop Optimization

- Use `ASSIGNING <fs>` for fastest loop processing (no data copy).
- Use `WHERE` on LOOP — especially on SORTED tables (binary search).
- Avoid nested loops O(n*m). Use HASHED lookup for inner data:
  ```abap
  " good — O(n) with O(1) lookups
  DATA texts TYPE HASHED TABLE OF makt WITH UNIQUE KEY matnr spras.
  LOOP AT materials ASSIGNING <mat>.
    READ TABLE texts WITH TABLE KEY matnr = <mat>-matnr spras = sy-langu INTO text.
  ENDLOOP.
  ```

- Use `DELETE ADJACENT DUPLICATES` on SORTED tables.

### Bulk Operations

- Use `INSERT lines_of itab INTO TABLE target` for bulk inserts.
- Use `APPEND LINES OF` for STANDARD tables.
- Use `CORRESPONDING #( )` for structure mapping instead of field-by-field loops.

---

## String Operations

- Avoid repeated string concatenation in loops — quadratic reallocation.
  ```abap
  " good — build table, concat at end
  DATA lines TYPE string_table.
  LOOP AT data INTO d.
    APPEND |{ d-field1 };{ d-field2 }| TO lines.
  ENDLOOP.
  DATA(csv) = concat_lines_of( table = lines sep = cl_abap_char_utilities=>cr_lf ).
  ```

---

## Authorization Checks

- Check authority **before** expensive data retrieval, not after.
  ```abap
  AUTHORITY-CHECK OBJECT 'M_MATE_WRK' ID 'WERKS' FIELD plant.
  IF sy-subrc <> 0. RAISE EXCEPTION NEW zcx_no_auth( ). ENDIF.
  SELECT ... " now fetch data
  ```

---

## ALV / UI Performance

- Pass data by reference to ALV to avoid copying large tables.
- Use `CL_SALV_TABLE` for read-only display.
- For large result sets (>100k rows), consider pagination.

---

## Parallel Processing

- Use `aRFC` for independent long-running parallel tasks.
- Use `SPTA` framework for parallelized mass processing.
- Background jobs for very long tasks.
- Each unit must be self-contained — no shared state.

---

## ECC Anti-Patterns

| Anti-Pattern | Fix |
|---|---|
| `SELECT *` | Select only needed fields |
| SELECT in a LOOP | JOINs or FOR ALL ENTRIES |
| Nested LOOPs on STANDARD tables | HASHED lookup for inner data |
| `LOOP AT ... WHERE` on STANDARD table | SORTED/HASHED with proper keys |
| String concat in loops with `&&` | Build string table, concat at end |
| Complex SQL (many JOINs, subqueries) | Simplify SQL, move logic to ABAP |
| `UP TO 1 ROWS` on buffered table | `SELECT SINGLE` to use buffer |
| WHERE clause not matching index | Design WHERE to use secondary indexes |
| Authority check after data retrieval | Check authorization before SELECT |
| Aggregating in ABAP loops | Acceptable on ECC if data volume is small; for large volumes, use simple GROUP BY |
