---
name: abap-performance-hana
description: ABAP performance best practices for S/4HANA and HANA database systems.Use when writing or reviewing ABAP code on HANA-based systems.IMPORTANT: First use the SAP system info tool to check the system type — if the system is ECC or runs on a traditional database (Oracle, DB2, MSSQL), load the abap-performance-ecc skill instead. Covers code pushdown, CDS views, AMDP, advanced SQL, and HANA-optimized patterns.
argument-hint: '[ABAP code to optimize on HANA]'
user-invokable: true
disable-model-invocation: false
---

# ABAP Performance — S/4HANA / HANA Database

These rules apply to SAP S/4HANA systems or any ABAP system running on HANA DB.

**Before using this skill:** Call the SAP system info tool. If the system is ECC on a traditional DB, use the `abap-performance-ecc` skill instead.

**Core philosophy on HANA:** Push data-intensive operations to the database. HANA is a columnar in-memory DB optimized for set-based operations, aggregations, and complex SQL. Let it do the heavy lifting. Keep ABAP for business logic, authorization, and exception handling.

---

## Code Pushdown — The #1 Rule

**Move data-intensive operations to the database layer.**

### Push down to HANA:
- Aggregations (SUM, COUNT, AVG, MIN, MAX)
- Filtering (WHERE clauses — the more selective, the better)
- Sorting (ORDER BY)
- JOINs (HANA handles complex multi-table JOINs efficiently)
- String operations and arithmetic in SQL
- CASE expressions / conditional logic on data
- Grouping and HAVING
- Window functions (OVER/PARTITION BY)
- UNION / INTERSECT / EXCEPT

### Keep in ABAP:
- Complex business logic with many branches
- Authority checks, messages, exceptions
- Small dataset processing where pushdown overhead exceeds benefit
- Operations requiring ABAP runtime features (RFC calls, file I/O, etc.)

### Avoid:
- Reading all rows to ABAP and filtering/aggregating in loops
- Using internal tables as intermediate storage for what SQL can do in one statement
- Multiple sequential SELECTs that could be a single JOIN

---

## Database Access

### SELECT Patterns

- Select only the fields you need. Never `SELECT *` in production.
  ```abap
  SELECT matnr, maktx FROM mara INTO TABLE @DATA(itab).
  ```

- Always use a WHERE clause. Always use `@` escaped host variables.

- Use JOINs aggressively — HANA handles complex JOINs very well, even 5+ tables.
  ```abap
  SELECT m~matnr, t~maktx, p~werks, p~ekgrp
    FROM mara AS m
    INNER JOIN makt AS t ON t~matnr = m~matnr AND t~spras = @sy-langu
    INNER JOIN marc AS p ON p~matnr = m~matnr
    LEFT OUTER JOIN mvke AS s ON s~matnr = m~matnr
    WHERE m~mtart = @material_type
    INTO TABLE @DATA(materials).
  ```

- Use aggregate functions and GROUP BY — let HANA calculate:
  ```abap
  SELECT werks, SUM( labst ) AS total_stock, COUNT(*) AS item_count
    FROM mard
    WHERE matnr = @matnr
    GROUP BY werks
    INTO TABLE @DATA(stock_by_plant).
  ```

- Use CASE expressions to push conditional logic to the DB:
  ```abap
  SELECT matnr,
         CASE mtart
           WHEN 'FERT' THEN 'Finished'
           WHEN 'ROH' THEN 'Raw Material'
           ELSE 'Other'
         END AS type_text
    FROM mara
    INTO TABLE @DATA(materials).
  ```

- Use string functions in SQL:
  ```abap
  SELECT matnr, CONCAT( matnr, CONCAT( ' - ', maktx ) ) AS display_text
    FROM mara
    INNER JOIN makt ON makt~matnr = mara~matnr AND makt~spras = @sy-langu
    INTO TABLE @DATA(display_data).
  ```

- Use `FOR ALL ENTRIES` when JOINs aren't possible. **Always check driver table is not empty.**

- Use `UP TO n ROWS` when you only need limited results.

- Use subqueries where they simplify logic:
  ```abap
  SELECT matnr, maktx FROM mara
    WHERE matnr IN ( SELECT matnr FROM marc WHERE werks = @plant )
    INTO TABLE @DATA(plant_materials).
  ```

### CDS Views

- **Prefer CDS views** for complex data models. They are the primary code pushdown mechanism on HANA.
- CDS views are reusable, testable, and automatically optimized by HANA.
- Use CDS for: complex joins, calculated fields, aggregations, associations, access control.
- Consume CDS views in ABAP via `SELECT FROM zcds_view`.

### AMDP (ABAP-Managed Database Procedures)

- Use AMDP for very complex calculations that must run entirely on HANA.
- AMDP gives you access to full SQLScript (HANA's procedural SQL language).
- Use when: complex multi-step transformations, heavy string processing, graph operations, or when CDS is insufficient.
- AMDP is NOT portable to other DBs — use only when you're certain the system stays on HANA.

### Avoiding Redundant DB Access

- Never SELECT the same data twice. Read once, reuse.
- Use `READ TABLE` on internal table buffer instead of `SELECT SINGLE` in a loop:
  ```abap
  SELECT matnr, maktx FROM makt WHERE spras = @sy-langu INTO TABLE @DATA(texts).
  " later:
  READ TABLE texts WITH KEY matnr = current_matnr INTO DATA(text_line).
  ```

- On HANA, even redundant DB access is faster than on traditional DBs — but it's still wasteful and adds network overhead.

### Table Buffering

Buffering matters **less** on HANA than ECC because HANA is in-memory. But it still helps for:
- Reducing network round-trips between app server and DB server
- Avoiding query parsing overhead for tiny lookups

- Use `SELECT SINGLE` on buffered tables — reads from buffer. `UP TO 1 ROWS` bypasses buffer.
  ```abap
  " good — uses buffer
  SELECT SINGLE * FROM t001 WHERE bukrs = @bukrs INTO @DATA(company).
  " bad — bypasses buffer
  SELECT * FROM t001 UP TO 1 ROWS WHERE bukrs = @bukrs INTO @DATA(company).
  ```

- JOINs, aggregates, GROUP BY, ORDER BY, subqueries **bypass the buffer**.

---

## Internal Tables

### Table Type Selection

Same rules as any ABAP system — this is ABAP runtime, not DB:
- **HASHED**: O(1) lookup. Large tables, unique key, read-heavy, filled once.
- **SORTED**: O(log n) lookup. Non-unique key, range access, incremental fill.
- **STANDARD**: O(n) unless sorted + binary search. Small tables or sequential.

```abap
" good — O(1) lookup
DATA materials TYPE HASHED TABLE OF mara WITH UNIQUE KEY matnr.
READ TABLE materials WITH TABLE KEY matnr = input INTO DATA(mat).
```

### Loop Optimization

- Use `ASSIGNING FIELD-SYMBOL(<fs>)` for fastest loop processing.
- Use `WHERE` on LOOP — especially on SORTED tables.
- Avoid nested loops O(n*m). Use HASHED lookup for inner data.
- Use `FILTER` for extracting subsets from SORTED/HASHED tables:
  ```abap
  DATA(subset) = FILTER #( sorted_table WHERE status = 'A' ).
  ```

### Bulk Operations

- `INSERT lines_of` for bulk inserts.
- `VALUE #( FOR ... )` and `REDUCE` for functional transformations.
- `CORRESPONDING #( )` for structure mapping.

### HANA-Specific: Consider Pushing to SQL

Before writing a complex ABAP loop with aggregation, filtering, or transformation — ask: **can this be a SQL statement instead?**

```abap
" ABAP way (acceptable for small data)
LOOP AT sales ASSIGNING FIELD-SYMBOL(<s>).
  AT NEW kunnr.
    total = 0.
  ENDAT.
  total += <s>-netwr.
  AT END OF kunnr.
    APPEND VALUE #( kunnr = <s>-kunnr total = total ) TO totals.
  ENDAT.
ENDLOOP.

" HANA way (better for large data)
SELECT kunnr, SUM( netwr ) AS total
  FROM vbak
  WHERE erdat >= @from_date
  GROUP BY kunnr
  INTO TABLE @DATA(totals).
```

---

## String Operations

- Use string templates `| |` instead of CONCATENATE.
- Avoid repeated string concatenation in loops — build a string table:
  ```abap
  DATA lines TYPE string_table.
  LOOP AT data INTO DATA(d).
    APPEND |{ d-field1 };{ d-field2 }| TO lines.
  ENDLOOP.
  DATA(csv) = concat_lines_of( table = lines sep = cl_abap_char_utilities=>cr_lf ).
  ```

- **HANA-specific:** For heavy string assembly from DB data, consider doing it in SQL with `CONCAT` or `STRING_AGG` (via CDS/AMDP).

---

## Authorization Checks

- Check authority **before** expensive data retrieval:
  ```abap
  AUTHORITY-CHECK OBJECT 'M_MATE_WRK' ID 'WERKS' FIELD plant.
  IF sy-subrc <> 0. RAISE EXCEPTION NEW zcx_no_auth( ). ENDIF.
  SELECT ... " now fetch
  ```

- On S/4HANA, consider CDS access control (DCL) for row-level authorization built into the data model.

---

## ALV / UI Performance

- Pass data by reference.
- Use `CL_SALV_TABLE` for read-only display.
- For very large result sets, consider pagination.
- On S/4HANA: consider Fiori/RAP for UI instead of classical ALV.

---

## Parallel Processing

- `aRFC` for independent parallel tasks.
- `SPTA` framework for parallelized mass processing.
- Background jobs for very long tasks.
- **HANA-specific:** Before parallelizing in ABAP, check if the work can be pushed to HANA — a single efficient SQL may outperform parallel ABAP tasks.

---

## HANA Anti-Patterns

| Anti-Pattern | Fix |
|---|---|
| `SELECT *` | Select only needed fields |
| SELECT in a LOOP | JOINs (HANA handles complex JOINs well) |
| Aggregating in ABAP loops | SUM/COUNT/AVG in SQL with GROUP BY |
| Filtering in ABAP what SQL can filter | Push WHERE to SQL |
| Multiple SELECTs that could be one JOIN | Combine into single JOIN statement |
| Nested LOOPs on STANDARD tables | HASHED lookup for inner data |
| Complex ABAP transformations on large data | CDS view or AMDP |
| String concat in loops with `&&` | Build string table, or push to SQL |
| Ignoring CDS views | Use CDS for reusable data models |
| `UP TO 1 ROWS` on buffered table | `SELECT SINGLE` to use buffer |
| Authority check after data retrieval | Check before SELECT, or use CDS DCL |
| Writing ABAP for what SQL can express | Push to database — always ask "can SQL do this?" |
