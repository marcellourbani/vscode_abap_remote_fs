# ABAP SQL Syntax Guide

**🚨 CRITICAL: SAP HANA/Open SQL uses different syntax than standard SQL. Use these patterns:**

## Field Names:

- **ALWAYS use ABAP tools to discover correct field names before querying**

- **NEVER assume standard field names** - each table has its own conventions

- Use `GetABAPObjectLinesTool` to examine table structure first

## ORDER BY:

- ✅ `ORDER BY field DESCENDING` / `ASCENDING` 

- ❌ `ORDER BY field DESC` / `ASC`

## LIMIT:

- ✅ **Use tool maxRows parameter for reliable limiting**: `maxRows: 100` in tool call

- ⚠️ **`SELECT fields UP TO n ROWS FROM table`** (won't work - will be ignored)

- ❌ **`SELECT fields FROM table LIMIT n`** (standard SQL - NOT supported)

- ❌ **`SELECT TOP n fields FROM table`** (SQL Server style - NOT supported)

## Operators:

- ✅ `AND`, `OR`, `IN()`, `BETWEEN`, `IS NULL`, `IS NOT NULL`, `LIKE '%pattern%'`

- ❌ `&&`, `||`, `CONTAINS`, `NOT NULL`

## Aggregation & Grouping:

- ✅ `DISTINCT`, `COUNT(*)`, `GROUP BY`, `HAVING`, `UNION`, `UNION ALL`, `CASE`

- ✅ **Aliases required for computed columns in GROUP BY**

- ✅ **Functions require spaces around parentheses**: `SUM( column )`, `AVG( column )`, `MIN( column )`, `MAX( column )`

- ✅ **String functions**: `LENGTH( column )`, `UPPER( column )`, `LOWER( column )`, `SUBSTRING( column, start, length )`

- ✅ **Math functions**: `ROUND( column, decimals )`, `ABS( column )`, `+`, `-`, `*`, `/`

- ✅ **NULL functions**: `COALESCE( column, default_value )`

- ✅ **Subqueries**: `IN ( SELECT... )`, `NOT IN ( SELECT... )`, `ANY ( SELECT... )`, `ALL ( SELECT... )`

- ✅ **ABAP-style JOINs**: Use tilde notation `table~field` and `AS` aliases

  - `FROM table1 AS a INNER JOIN table2 AS b ON a~key = b~key`

  - `FROM table1 AS a LEFT OUTER JOIN table2 AS b ON a~key = b~key`

  - `FROM table1 AS a RIGHT OUTER JOIN table2 AS b ON a~key = b~key`

- ✅ **EXISTS/NOT EXISTS**: `WHERE EXISTS ( SELECT 1 FROM table AS b WHERE b~key = a~key )`

- ✅ **Multiple JOINs, JOINs with WHERE/GROUP BY/aggregates**

- ✅ **FULL OUTER JOIN simulation**: Use `LEFT OUTER JOIN ... UNION RIGHT OUTER JOIN ... WHERE left_table~key IS NULL`

- ✅ **Limited date functions**: `ADD_DAYS( date, number )`, `ADD_MONTHS( date, number )`

- ⚠️ **ABAP-specific clauses ignored**: `INTO CORRESPONDING FIELDS OF TABLE @DATA(var)` (parsed but ignored)

- ❌ **Function syntax without spaces**: `SUM(column)`, `AVG(column)` (parser error)

- ❌ **Standard SQL JOINs**: `table.field` notation (use tilde `table~field`)

- ❌ **Window functions**: `OVER()`, `PARTITION BY`, `LAG()`, `LEAD()`

- ❌ **FULL OUTER JOIN** (use simulation pattern above)

- ❌ **Advanced date functions**: `YEAR()`, `MONTH()`, `EXTRACT()`, `DAYS_BETWEEN()`, `CURRENT_DATE`

