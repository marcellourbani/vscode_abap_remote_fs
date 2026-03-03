---
name: clean-abap
description: Clean ABAP coding standards and best practices. Use when writing ABAP code, reviewing ABAP code, or refactoring ABAP code to ensure it follows SAP's official Clean ABAP style guide. Covers naming conventions, modern language constructs, class/method design, error handling, formatting, comments, and unit testing patterns.
argument-hint: '[ABAP code task or ABAP code review request]'
user-invokable: true
disable-model-invocation: false
---

# Clean ABAP — AI-Optimized Rules

> Distilled from the [SAP Clean ABAP Style Guide](https://github.com/SAP/styleguides).
> Licensed under [Creative Commons BY 3.0](https://creativecommons.org/licenses/by/3.0/).
> © SAP SE. Attribution preserved per license terms.

Apply ALL rules below when writing or reviewing ABAP code. Every rule is mandatory unless explicitly marked "consider".

---

## Names

- Use descriptive names that convey meaning. `customizing_entries` not `ce_tab`.
- Prefer solution domain terms (queue, tree) in technical layers, problem domain terms (account, ledger) in business layers.
- Use plural for collections: `materials` not `material_tab`.
- Use pronounceable names: `detection_object_types` not `dobjt`.
- Use `snake_case`. When hitting length limits, abbreviate the least important words.
  ```abap
  DATA max_response_time_in_millisec TYPE i.
  ```
- Avoid abbreviations. Use the same abbreviation everywhere for the same concept.
- Use nouns for classes/interfaces, verbs for methods. Prefix boolean methods with `is_` or `has_`.
  ```abap
  CLASS /clean/account.
  METHODS read_entries.
  IF is_empty( table ).
  ```
- Avoid noise words: `account` not `account_data`; `user_preferences` not `user_info`.
- Pick one word per concept: always `read_*`, never mix `read_this` with `retrieve_that`.
- Use pattern names (factory, singleton) only if the class actually implements that pattern.
- **No Hungarian notation or prefixes.** Drop `iv_`, `rv_`, `lt_`, etc.
  ```abap
  " good
  result = a + b.
  " bad
  rv_result = iv_a + iv_b.
  ```
- Do not shadow built-in functions (`condense`, `lines`, `strlen`, etc.) with method names.

## Language

- Verify modern syntax is supported on the target release before using it.
- Do not optimize prematurely. Write clean code first, profile later.
- Prefer OO over procedural. Wrap function modules as thin shells around classes.
  ```abap
  FUNCTION check_business_partner [...].
    DATA(validator) = NEW /clean/biz_partner_validator( ).
    result = validator->validate( business_partners ).
  ENDFUNCTION.
  ```
- Prefer functional constructs:
  ```abap
  DATA(variable) = 'A'.              " not MOVE
  DATA(uppercase) = to_upper( str ). " not TRANSLATE
  index += 1.                        " not ADD 1 TO
  DATA(obj) = NEW /clean/cls( ).     " not CREATE OBJECT
  ```
- Use modern table expressions:
  ```abap
  DATA(line) = value_pairs[ name = 'A' ].
  ```
- Avoid obsolete elements. Use `@`-escaped host variables in SQL:
  ```abap
  SELECT * FROM spfli WHERE carrid = @carrid INTO TABLE @itab.
  ```
- Use design patterns only where they provide clear benefit.

## Constants

- Use constants instead of magic numbers:
  ```abap
  IF abap_type = cl_abap_typedescr=>typekind_date.   " not 'D'
  ```
- Give constants descriptive names reflecting meaning, not value:
  ```abap
  CONSTANTS status_inactive TYPE mmsta VALUE '90'.     " not c_01
  ```
- Prefer `ENUM` (7.51+) over constants interfaces:
  ```abap
  TYPES: BEGIN OF ENUM type, warning, error, END OF ENUM type.
  ```
- If not using ENUM, group constants with `BEGIN OF ... END OF`:
  ```abap
  CONSTANTS:
    BEGIN OF message_severity,
      warning TYPE symsgty VALUE 'W',
      error   TYPE symsgty VALUE 'E',
    END OF message_severity.
  ```

## Variables

- Prefer inline declarations at first use:
  ```abap
  DATA(name) = 'something'.
  ```
- Do not use a variable outside the block where it was declared.
- One `DATA` per variable — no chaining:
  ```abap
  DATA name TYPE seoclsname.
  DATA reader TYPE REF TO reader.
  ```
- Avoid field symbols when modern syntax suffices (2021+). Use `dref->*` directly.
- Loop targets:
  - `ASSIGNING FIELD-SYMBOL(<line>)` — read/modify in place (fastest).
  - `REFERENCE INTO DATA(line)` — when references needed outside loop.
  - `INTO DATA(line)` — when you need a copy.

## Tables

- `HASHED` — large, filled once, read often by unique key.
- `SORTED` — large, filled incrementally, read by full/partial key.
- `STANDARD` — small tables, arrays, or mixed access.
- Avoid `DEFAULT KEY`. Use explicit keys or `EMPTY KEY`:
  ```abap
  DATA itab TYPE STANDARD TABLE OF row_type WITH EMPTY KEY.
  ```
- Prefer `INSERT INTO TABLE` over `APPEND TO`.
- Use `line_exists( )` for existence checks:
  ```abap
  IF line_exists( my_table[ key = 'A' ] ).
  ```
- Prefer `READ TABLE` over `LOOP AT ... EXIT` for single-row retrieval.
- Prefer `LOOP AT ... WHERE` over nested IF inside LOOP.
- Avoid double reads — read once and catch the exception:
  ```abap
  TRY.
      DATA(row) = my_table[ key = input ].
    CATCH cx_sy_itab_line_not_found.
      RAISE EXCEPTION NEW /clean/not_found( ).
  ENDTRY.
  ```

## Strings

- Use backtick literals for constants: `` DATA(s) = `ABC`. `` Not single quotes.
- Use string templates `| |` to assemble text:
  ```abap
  DATA(msg) = |HTTP { status_code }: { text }|.
  ```

## Booleans

- Prefer enumerations when a third state may emerge. Use Booleans only for true binary states.
- Use `abap_bool` as the type. Use `abap_true`/`abap_false` for comparisons — never `'X'`, `' '`, or `IS INITIAL`.
  ```abap
  DATA has_entries TYPE abap_bool.
  IF has_entries = abap_false.
  ```
- Use `xsdbool( )` to set Booleans:
  ```abap
  DATA(has_entries) = xsdbool( line IS NOT INITIAL ).
  ```

## Conditions

- Prefer positive conditions. Avoid double negatives.
- Prefer `IS NOT` over `NOT IS`, `<>` over `NOT =`.
- Use predicative method calls for Boolean methods:
  ```abap
  IF condition_is_fulfilled( ).    " not = abap_true
  ```
- Decompose complex conditions into named Boolean helpers.
- Extract complex conditions into dedicated methods.

## Ifs

- No empty IF branches — negate instead.
- Prefer `CASE` over `ELSE IF` chains.
- Keep nesting depth low — flatten with sub-methods, Boolean helpers, or `AND`.

## Regular Expressions

- Prefer simple string methods over regex when possible.
- Prefer existing SAP basis checks over hand-written regex.
- Assemble complex regex from named constants.

## Classes

### Object Orientation

- Prefer objects to static classes. Static defeats mocking.
- Exception: stateless utility classes with pure functions are acceptable as static.
- Prefer composition to inheritance.
- Don't mix stateful and stateless in the same class.

### Scope

- Global classes by default. Local only for private structures, complex algorithms, or test injection.
- Mark classes `FINAL` unless designed for inheritance.
- Members `PRIVATE` by default. `PROTECTED` only for intentional subclass override.
- For immutable objects, prefer `READ-ONLY` attributes over getters:
  ```abap
  DATA name TYPE string READ-ONLY.
  ```

### Constructors

- Prefer `NEW` to `CREATE OBJECT`. Use `CREATE OBJECT` only for dynamic types.
- If `CREATE PRIVATE`, keep CONSTRUCTOR in PUBLIC SECTION.
- Prefer multiple static creation methods over optional constructor parameters:
  ```abap
  CLASS-METHODS new_from_template IMPORTING template TYPE REF TO zcl_tmpl
    RETURNING VALUE(result) TYPE REF TO zcl_doc.
  CLASS-METHODS new_from_name IMPORTING name TYPE string
    RETURNING VALUE(result) TYPE REF TO zcl_doc.
  ```
- Use singletons only when multiple instances genuinely don't make sense.

## Methods

### Calls

- Call static methods via class name, not instance:
  ```abap
  cl_my_class=>static_method( ).     " not lo_instance->static_method( )
  ```
- Access types via class name, not instance.
- Prefer functional call style. Use `CALL METHOD` only for dynamic dispatch.
- Omit `RECEIVING` — capture return value directly.
- Omit the optional `EXPORTING` keyword.
- Omit parameter name in single-parameter calls (unless ambiguous).
- Omit `me->` unless resolving a scope conflict.

### Object Orientation

- Prefer instance methods. Static only for factories.
- Public instance methods should be part of an interface.

### Parameters

- Aim for < 3 IMPORTING parameters. Combine related ones into structures.
- Split methods instead of adding OPTIONAL parameters.
- Use `PREFERRED PARAMETER` sparingly.
- Return/export/change exactly one parameter. Return a structure for multi-part output.
- Prefer `RETURNING` over `EXPORTING` — enables functional style.
- `RETURNING` large tables is okay — don't prematurely switch to `EXPORTING`.
- Don't mix `RETURNING` with `EXPORTING`/`CHANGING`.
- Use `CHANGING` sparingly — only for in-place updates.
- Split methods instead of Boolean input parameters:
  ```abap
  update_without_saving( ).     " not update( do_save = abap_true )
  update_and_save( ).
  ```
- Name RETURNING parameter `RESULT`:
  ```abap
  METHODS get_name RETURNING VALUE(result) TYPE string.
  ```

### Parameter Initialization

- Always clear/overwrite EXPORTING reference parameters at method start.
- Beware same-variable input/output — defer CLEAR if needed.
- Don't clear VALUE parameters (already empty).

### Method Body

- Do one thing, do it well, do it only.
- Focus on happy path OR error handling, not both. Extract validation separately.
- Descend one level of abstraction per method.
- Keep methods small: 3-5 statements, max ~20.

### Control Flow

- Fail fast — validate inputs at top before expensive work.
- Prefer `IF ... RETURN` over `CHECK`. Use `CHECK` only at method start.
- Never use `CHECK` inside loops — use `IF` + `CONTINUE`.

## Error Handling

### Messages

- Use `MESSAGE e001(ad) INTO DATA(message).` for where-used traceability.

### Return Codes

- Prefer exceptions to return codes.
- Check legacy return codes and convert to exceptions.

### Exceptions

- Exceptions are for errors only, not regular cases.
- Use class-based exceptions (`TRY`/`CATCH`), not legacy `EXCEPTIONS`.

### Throwing

- Create abstract app-specific super classes per exception category.
- Throw one exception type per method; use sub-classes for distinction.
- `CX_STATIC_CHECK` for manageable expected exceptions.
- `CX_NO_CHECK` for usually unrecoverable situations.
- `CX_DYNAMIC_CHECK` only when caller controls whether it can occur.
- Dump only for totally unrecoverable programming errors.
- Prefer `RAISE EXCEPTION NEW` to `RAISE EXCEPTION TYPE`:
  ```abap
  RAISE EXCEPTION NEW cx_gen_error( previous = exception ).
  ```

### Catching

- Wrap foreign exceptions — don't let them invade your API:
  ```abap
  CATCH cx_amdp_failure INTO DATA(ex).
    RAISE EXCEPTION NEW cx_generation_failure( previous = ex ).
  ```

## Comments

- Express yourself in code, not comments. Extract methods with descriptive names.
- Comments are no excuse for bad names.
- Write comments for the **why**, not the **what**.
- Comment with `"`, not `*`.
- Put comments **before** the statement they relate to.
- Delete dead code — don't comment it out.
- No manual versioning with ticket/transport markers.
- Use `FIXME`, `TODO`, `XXX` with your user ID.
- No method signature or end-of comments.
- ABAP Doc only for public APIs consumed by other teams.
- Prefer pragmas (`##NEEDED`) to pseudo comments (`"#EC NEEDED`).

## Formatting

- Be consistent with your team's style.
- Use the ABAP Formatter before activating.
- One statement per line.
- Max line length: 120 characters.
- Condense — no unneeded blanks.
- Single blank lines to separate, never more.
- Align assignments to the same object only:
  ```abap
  structure-type = 'A'.
  structure-id   = '4711'.
  ```
- Close brackets at line end, not on new line.
- Single-parameter calls on one line.
- Parameters behind the call; break only if too long.
- Indent broken parameters under the call.
- One parameter per line for multi-parameter calls.
- Align parameters vertically.
- Indent and snap to tab.
- Don't align TYPE clauses across different declarations.
- Don't chain assignments.

## Testing

### Principles

- Write testable code. Refactor if needed.
- Enable mocking — add interfaces at outward-facing places.
- Test code must be even more readable than production code.
- Automate — no $TMP copies or manual test reports.
- Test publics only. Needing to test privates signals design flaw.
- Don't obsess about coverage numbers.

### Test Classes

- Name by purpose: `ltc_reads_entry`, not `ltc_test`.
- Unit tests in the local test include.
- Component/integration tests in separate `FOR TESTING ABSTRACT` global class.
- Shared helpers in `lth_*` classes.

### Code Under Test

- Variable name: `cut` (default) or meaningful name.
- Type against interface, not class.
- Extract the call to CUT into its own method.

### Injection

- Use constructor injection for test doubles.
- No setter injection, no FRIENDS injection.
- Consider `cl_abap_testdouble` over hand-written doubles:
  ```abap
  DATA(mock) = CAST if_reader( cl_abap_testdouble=>create( 'if_reader' ) ).
  cl_abap_testdouble=>configure_call( mock )->returning( value ).
  ```
- Test seams only as temporary workaround.
- `LOCAL FRIENDS` only for `CREATE PRIVATE` constructor access.
- Don't mock what the test doesn't need.
- Don't build test frameworks with case-ID dispatching.

### Test Methods

- Name reflects given + expected: `reads_existing_entry`, `throws_on_invalid_key`.
- Structure: given-when-then. Extract sub-methods if long.
- "When" = exactly one call to CUT.
- No TEARDOWN unless cleaning external resources.

### Test Data

- Meaningless data must look meaningless: `'42'`, `'?=/"&'`.
- Make differences easy to spot.
- Use constants for test data purpose.

### Assertions

- Few, focused assertions per test method.
- Use the right assert type: `assert_equals`, `assert_false` — not `assert_true( xsdbool(...) )`.
- Assert content, not quantity.
- Assert quality, not content (for meta-properties).
- Use `fail( )` after CUT call for expected exceptions:
  ```abap
  TRY.
      cut->do_something( '' ).
      cl_abap_unit_assert=>fail( ).
    CATCH /clean/some_exception.
  ENDTRY.
  ```
- Forward unexpected exceptions via `RAISING` on the test method.
- Write custom assert methods to reduce duplication.
