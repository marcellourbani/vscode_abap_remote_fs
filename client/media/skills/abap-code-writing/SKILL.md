---
name: abap-code-writing
description: Structured process for building ABAP solutions. Use BEFORE writing any ABAP code — reports, classes, function modules, enhancements, or full processes. Guides through requirement validation, system exploration, architecture planning, research of existing objects, and detailed design before any code is written.
argument-hint: '[description of what to build in ABAP]'
user-invocable: true
disable-model-invocation: false
---

# ABAP Code Writing Process

Follow this process **in order** whenever building ABAP solutions. Do NOT skip steps. Do NOT start writing code until Step 6.

Ask questions at ANY step if something is unclear — it is always better to clarify early than to rewrite later.

---

## Step 1: Understand the Requirement

Before anything else, demonstrate that you understand what the user is asking for.

**Actions:**
- Restate the requirement back to the user in your own words
- Describe the expected inputs, outputs, and behavior
- Identify the business context — what problem does this solve?
- Call out any assumptions you're making
- List open questions (edge cases, error scenarios, authorization needs, performance expectations)

**Do NOT proceed until the user confirms your understanding is correct.**

Example response:
> "Here's my understanding: You need a report that reads material master data for a given plant, filters by material type, and outputs an ALV grid with columns [X, Y, Z]. It should support multiple selection for plant and material type. Is this correct? A few questions: (1) Should it include cross-plant materials? (2) Do you need export to Excel? (3) Any authorization checks beyond standard?"

---

## Step 2: Explore the SAP System

Once requirements are confirmed, understand what you're working with.

**Actions:**
- Use the **SAP system info tool** to determine:
  - System type (S/4HANA vs ECC)
  - SAP release / ABAP version (affects available syntax and standard objects)
  - Installed components
- Check if standard SAP functionality already does what the user needs:
  - Search for standard transactions, BAPIs, or reports that cover the requirement
  - Search for BADIs, enhancement spots, or user exits that could be enhanced
  - Check if a standard Fiori app exists for this
- Inform the user of findings: "SAP already provides [X] which does 80% of what you need. We could enhance it via [BADI/exit Y] rather than building from scratch."

**If standard functionality can be enhanced, recommend that approach.** Custom code should be the last resort.

---

## Step 3: Architecture & High-Level Plan

If custom development is needed, plan the architecture BEFORE any code.

**Actions:**
- Break down the solution into **sub-tasks / capabilities** needed. Examples:
  - Sending emails
  - Downloading data to Excel
  - Price calculation
  - Updating a specific custom table
  - Reading master data
  - Calling an external API
  - Authorization checks
  - Logging / audit trail
- For each sub-task, note whether it's likely something that:
  - Already exists as standard SAP functionality (BAPI, FM, standard class)
  - May exist as a custom object (Z*/Y*) in this system that can be reused
  - Needs to be built from scratch
- Sketch the **data flow**: where data comes from, how it's transformed, where it goes
- Identify **integration points**: other systems, APIs, IDocs
- Consider **error handling strategy**: how errors are surfaced to the user
- Consider **authorization** and **performance** needs (expected data volumes)

**Present this as a capability breakdown** — not specific object names yet. Those come after research.

Example:
> **Capabilities needed:**
> 1. Read sales order data from SAP tables
> 2. Validate order data against business rules
> 3. Calculate pricing (may reuse existing pricing FM/class?)
> 4. Send confirmation email to customer
> 5. Update custom status table
> 6. Log all processing steps for audit

---

## Step 4: Research Existing Objects

For **each sub-task identified in Step 3**, search the SAP system for reusable objects.

**Actions:**
- For each capability/sub-task, search for:
  - **Custom objects (Z*/Y*)** that already do this or something similar — these are high-value reuse candidates
  - **Standard BAPIs, FMs, classes** that cover the functionality
  - **Tables and structures** you'll need to read from or write to
- For every object you find that looks promising:
  - **Read its signature**: get exact parameter names, types, and structures
  - **Read its code** to verify it actually does what you expect
  - **Check quality**: is it well-written? Does it handle errors properly?
- For tables and structures:
  - Confirm field names and data types
  - Check table keys and indexes

**NEVER assume an object exists or guess its parameters.** Every object and every parameter must be verified against the live system.

**Run searches in parallel** when possible — search for multiple sub-tasks simultaneously.

Report findings to the user: "For email sending, I found `ZCL_EMAIL_HELPER=>SEND` which takes X, Y, Z. For pricing, there's no existing custom object but standard FM `PRICING_GET_CONDITIONS` exists."

---

## Step 5: Detailed Code-Level Plan

Now — using research results from Step 4 — define the concrete architecture and detailed design.

**Actions:**
- Decide what **objects to create**:
  - Which classes, interfaces, exception classes, reports, FMs, tables, CDS views?
  - Name them following **Clean ABAP naming rules** (load the `clean-abap` skill if not already loaded): descriptive names, snake_case, no Hungarian notation, nouns for classes, verbs for methods
  - Define each object's responsibility
- For each class/FM:
  - Define methods and their exact signatures (importing, exporting, returning, raising)
  - Specify which reusable objects (found in Step 4) are called, with which parameters
  - Define the data flow through each method
  - Define error handling: which exceptions are raised/caught at each level
- Map out the **complete execution flow**:
  - Entry point → validation → processing → output
  - What happens on success vs failure at each step
- Include specifics:
  - SELECT statements with exact field and table names (verified in Step 4)
  - BAPI/FM calls with exact parameter mappings
  - ALV field catalog or CDS annotations
  - Authorization checks with exact auth objects

**Share this detailed plan with the user for confirmation before writing code.**

---

## Step 6: Write the Code

Only NOW do you write code.

**Rules:**
- Follow Clean ABAP rules (if the clean-abap skill is available, load and use it)
- Use modern ABAP syntax appropriate for the system version identified in Step 2
- Every object/parameter reference in your code must have been verified in Step 4
- Implement proper error handling as designed in Step 5
- Add meaningful ABAP Doc for public APIs
- Keep methods small and focused

**If you discover during coding that you need an object you haven't researched, STOP and go back to Step 4 for that object before continuing.**

---

## Key Principles

- **Questions > Assumptions**: Ask the user rather than guess. One question now saves an hour of rework.
- **Standard > Custom**: Always check if SAP provides something before building custom.
- **Verify > Trust**: Never trust your training data for object names or parameters. Always verify against the live system.
- **Plan > Code**: More time planning = less time debugging. The plan IS the deliverable — code is just the implementation.
- **Incremental confirmation**: Get user buy-in at Steps 1, 3, and 5. Don't surprise them at Step 6.
