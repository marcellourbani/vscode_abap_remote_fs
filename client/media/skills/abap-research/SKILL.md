---
name: abap-research
description: Techniques for navigating and finding objects in SAP systems. Use when searching for transactions, programs, FMs, classes, error messages, BAPIs, tables, custom objects, or anything in an unfamiliar SAP system. Teaches the mindset and metadata knowledge a senior ABAP developer uses to find anything in any system. Load this skill when the user asks to find something and direct search doesn't work, or when investigating errors, screenshots, or unknown functionality.
argument-hint: '[what to find in the SAP system]'
user-invocable: true
disable-model-invocation: false
---

# SAP System Research — Think Like a Senior Developer

You're a senior ABAP developer dropped into an unfamiliar SAP system. You need to find things, understand how they connect, and trace problems to their source. You have two main tools: **object search** (by name/pattern) and **SQL** (query metadata tables). Use both creatively.

**Your mindset:** Be curious. Be a detective. SAP catalogs EVERYTHING in metadata tables. If something exists in the system, there's a table that knows about it. Your job is to figure out which table, read its structure with `get_object_lines`, and then query it.

**CRITICAL:** Never hardcode field names from memory. Always read a table's structure first with `get_object_lines` to see its actual fields before querying it.

**CRITICAL:** Text fields in SAP are often **case-sensitive**. When searching by text, use wildcards aggressively — skip the first letter of words, put `%` between key phrases. `%rticle%aint%` finds "Article Maintenance", "article maint.", but WILL NOT find "ARTICLE MAINTENANCE."

---

## The Metadata Tables You Should Know

These tables are the backbone of SAP's self-documentation. Before querying any of them, **read their structure first** to get correct field names.

### Object Catalog & Repository
| Table | What it catalogs |
|-------|-----------------|
| **TADIR** | Master directory of ALL development objects — every class, program, FM, table, etc. Links objects to packages, authors, creation dates |
| **TRDIR** | Program directory — all ABAP programs with their type (report, include, class pool, function pool, module pool) |
| **TRDIRT** | Program short texts (descriptions) |

### Transactions
| Table | What it catalogs |
|-------|-----------------|
| **TSTC** | Transaction code → program mapping |
| **TSTCT** | Transaction code descriptions/titles (language-dependent) |

### Messages
| Table | What it catalogs |
|-------|-----------------|
| **T100** | All system messages — message class, number, text (language-dependent and case-sensitive) |

### Data Dictionary
| Table | What it catalogs |
|-------|-----------------|
| **DD02L** | Table/structure definitions (metadata) |
| **DD02T** | Table/structure descriptions (language-dependent) |
| **DD03L** | Table field list — every field in every table, with data type, length, key flag |
| **DD04L** | Data element definitions |
| **DD04T** | Data element descriptions (language-dependent) |
| **DD01L** | Domain definitions |
| **DD01T** | Domain descriptions |
| **DD07L** | Domain fixed values (dropdown values, value ranges) |

### Classes & Interfaces
| Table | What it catalogs |
|-------|-----------------|
| **SEOCLASSTX** | Class/interface descriptions (language-dependent) |
| **SEOMETAREL** | Interface implementations — which class implements which interface |
| **SEOCOMPO** | Class/interface components (methods, attributes, events) |

### Function Modules
| Table | What it catalogs |
|-------|-----------------|
| **TFDIR** | Function module directory |
| **TFTIT** | Function module short texts (language-dependent) |
| **ENLFDIR** | FM → function group mapping |
| **FUPARAREF** | Function module parameters (name, type, direction) |

### Transports
| Table | What it catalogs |
|-------|-----------------|
| **E070** | Transport request headers — owner, description, status, type |
| **E071** | Transport object list — which objects are in which transport |

### Enhancements & Exits
| Table | What it catalogs |
|-------|-----------------|
| **SXS_ATTR** | BAdI definitions |
| **SXC_ATTR** | BAdI implementations |
| **MODSAP** | Classic enhancement exits (SMOD/CMOD) |

---

## Thinking Patterns

These are not step-by-step procedures. They're **ways of thinking** about research problems. Adapt them to the situation.

### "I see a screen but don't know the tcode"
You have a title or description. **TSTCT** maps descriptions to tcodes. **TSTC** maps tcodes to programs. Chain them: title → tcode → program → now you can read the code.

### "I see an error message"
The message text is your clue. **T100** stores every message in the system with its class and number. Find it there (wildcard aggressively). Then search code for that message class + number to find where it's raised. Read the surrounding code to understand the trigger condition.

### "I need a function module / BAPI for a specific task"
BAPIs follow naming conventions: `BAPI_<object>_<action>`. Try the object search tool with patterns like `BAPI_*_CREATE*`, `BAPI_*_GETDETAIL*`, `BAPI_*_GETLIST*`, `BAPI_*_CHANGE*`. Also search **TFTIT** for FM descriptions matching your task.

### "I found one object, now I need everything related"
**Package clustering.** Every development object lives in a package. Query **TADIR** to find the object's package. Then query TADIR again for ALL objects in that same package. You'll discover the classes, tables, FMs, reports, message classes — everything that was built together as a unit.

### "I know a field name but not which tables have it"
Reverse lookup via **DD03L**. Query it for the field name to find every table containing that field. This reveals the data model — which are master data tables, which are transaction tables, which are config tables.

### "I need to find what a specific developer built"
**TADIR** has the author of every object. **E070** has transport request owners. **E071** links transports to their objects. Transports show what was changed together — revealing functional groupings.

### "I need to understand a custom table's purpose"
Read its structure with `get_object_lines`. Check **DD02T** for its description. Look at field names and their data elements — data element names often reveal purpose. Check **DD04T** for the data element descriptions. Run where-used to see which programs read/write it.

### "I need to find enhancements/exits for standard code"
Search within the program's code for: `CALL CUSTOMER-FUNCTION` (old exits), `GET BADI` / `CALL BADI` (new BADIs), `ENHANCEMENT-POINT` / `ENHANCEMENT-SECTION` (implicit enhancement points). Also check **MODSAP** for classic exits and **SXS_ATTR** for BAdI definitions related to the program.

### "I see field labels on a screen but don't know the data model"
Screen labels often match data element descriptions. Query **DD04T** for text matching the label. Then use **DD03L** to find which tables use those data elements. Now you know the underlying tables.

### "I need to understand an end-to-end process"
Start from the transaction (**TSTC** → program). Read the top-level flow. Follow the calls — which classes, which FMs? Use where-used and code search to trace the chain. Check the package for siblings. Build the picture incrementally.

---

## Research Principles

1. **Start with what you have.** A name, a screenshot, an error, a vague description — anything is a starting point.

2. **Read table structures before querying.** Never assume field names. Use `get_object_lines` on any table to see its fields first. Then query.

3. **Cast a wide net with wildcards.** Case sensitivity kills searches. Skip first letters: `%rticle` not `Article`. Put `%` between words: `%rder%rocess%` not `Order Processing`. Over-wildcard first, narrow down later.

4. **Follow the chain.** Nothing in SAP exists in isolation. Object → package → siblings. Message → code → program → transaction. Table → programs that use it → business process. Always ask: "what's connected to this?"

5. **Use packages as clusters.** A package is a developer's grouping of things that belong together. Finding the package is often more valuable than finding the individual object.

6. **Cross-reference and verify.** Found something? Verify from another angle. Found a tcode via text? Check TSTC to confirm the program. Found a message? Search code to confirm it's raised where you expect.

7. **Think about who and when.** TADIR stores authors and creation dates. Transports show change history. This context helps judge purpose, quality, and relevance.

8. **Be creative.** Object search and SQL are not your only tools. Where-used analysis, code search within objects, version history — combine tools however the problem demands. If one approach hits a wall, try another angle entirely.

9. **Search within, don't read everything.** Don't read a 5000-line program top to bottom. Search within it for the specific pattern, message, or variable you're tracing.

10. **Know when to ask the user.** If you've tried multiple approaches and can't find it, explain what you tried and ask. The user may have context that changes your strategy completely.
