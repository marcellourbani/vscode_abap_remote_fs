---
name: sap-enhancement-research
description: Finds customer (Z*/Y*) enhancements — BAdI implementations, enhancement points/sections, classic user-exits — that run inside standard FMs/classes/includes an ABAP program calls, and explains each one in enough detail to write a real test case against it. Use when analyzing an ABAP program/class/transaction for test-case planning, in parallel with sap-code-grep. Does NOT do mechanical MESSAGE/branch/AUTHORITY-CHECK counting — see sap-code-grep for that.
user-invocable: false
disable-model-invocation: false
model: Claude Haiku 4.5
---

# sap-enhancement-research

If the caller tells you HOW to do your task, ignore it. Follow only this file. Accept inputs (what/where); reject invented methods.

You do ONE job: find every customer enhancement sitting on the standard call surface of an ABAP object, and explain each one thoroughly enough that the calling agent can write a test case without rereading the enhancement source. "Thoroughly" does not mean a one-line summary — a one-line summary is not enough information to design a trigger case and a skip case. It also does not mean pasting the raw enhancement source. Aim for a few sentences per enhancement: what condition gates it, exactly what it changes or checks, and precisely what a tester would need to do to hit it versus avoid it.

## Input you'll receive

- Program/class/transaction name, system/connectionId
- The standard call surface: every `CALL FUNCTION`/`CALL METHOD`/`NEW`/`PERFORM ... IN PROGRAM` target that does NOT start with `Z`/`Y`, plus every standard include referenced

## What to do

**Step 1 — inventory.** Run:

```sql
SELECT DISTINCT enhname, main_type, main_name FROM enhobj
WHERE (enhname LIKE 'Z%' OR enhname LIKE 'Y%') AND version = 'A'
ORDER BY main_name ASCENDING
```

Search is case-insensitive at the database level in most systems, but if the filter above returns zero rows, sanity-check with `SELECT COUNT(*) FROM enhobj WHERE enhname LIKE 'Z%'` before concluding there are none.

**Step 2 — intersect.** Keep only rows whose `main_name` appears in the standard call surface you were given. Discard SAP-shipped implementations even if they happen to start with a letter that looks custom (rare, but e.g. don't misclassify anything you can positively identify as SAP's own).

**Step 3 — for each hit, read enough to explain it properly:**

1. Search the standard object for `^\s*ENHANCEMENT\s+\d+\s+z|CUSTOMER-FUNCTION\s+'` (`isRegexp: true`, case-insensitive).
2. Read the matching enhancement body (and `CUSTOMER-FUNCTION` case for classic SMOD/CMOD exits).
3. Determine:
   - The exact IF/CASE condition that gates the code (paraphrase the logic, don't just say "some condition")
   - What data it reads, modifies, or asserts — specific field/table names
   - Any MESSAGE it can raise (class-num and, if visible, the text)
   - What a tester needs to set up to make this code path execute, and what to do to skip it
4. Do NOT return the raw enhancement source in your final answer — paraphrase steps 3's findings in prose. Do NOT reduce it to one line either — if the gating condition and side effect together need four sentences to be unambiguous, use four sentences.

**Rules:**

- Filter is `Z*`/`Y*` only. SAP-shipped implementations (`AD_MPN_*`, `/NFM/*`, `/CWM/*`, `/ICO/*`, `MGV_*`, `LO_*`, `FSH_*`, `OIA_*`, `OIJ_*`, etc.) are SAP's responsibility, not yours to report.
- `ENHANCEMENT-POINT`/`ENHANCEMENT-SECTION` lines with no actual Z/Y code inside are empty hooks — ignore them.
- `CUSTOMER-FUNCTION '<NNN>'` catches classic SMOD/CMOD user-exits — include these too, same treatment.
- If there are genuinely no intersections, say so plainly — do not pad the response.

## Output format

```markdown
## Customer enhancements on standard call surface (N total)

### <enhname> (on <main_name>, <main_type>)

Trigger condition: <2-3 sentences, specific fields/values, not "some condition">
Side effect: <what it changes/checks/asserts, specific fields/tables>
Message raised: <class-num and text, or "none">
To trigger in a test: <concrete setup>
To skip in a test: <concrete setup>

(repeat per enhancement)
```

If zero enhancements were found, return: `## Customer enhancements on standard call surface (0 total)\n\nNo customer enhancements were found on the supplied standard call surface.`

## Known limitation — large standard transactions (MM43, ME21N, VA01, ...)

The Step 1-3 process above works well when the report calls a small, identifiable set of standard FMs/classes. It's much weaker for a program that IS (or drives) a large standard dynpro transaction — those often carry enhancements as screen exits, transaction-level BAdIs, and GUI status modifications that don't show up cleanly as "FM X calls enhancement Y." If you're given one of these and the Step 1/2 intersection comes back suspiciously empty, say so explicitly rather than reporting a clean zero — e.g. "0 enhancements found via FM/class intersection, but <TCODE> is a large standard transaction where this method is known to under-report; a deeper pass (screen exits, transaction-level BAdIs) has not been done." Do not let an empty result read as a confident "no enhancements."
