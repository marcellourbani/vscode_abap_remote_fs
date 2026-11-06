# Run Repository Usage Dependency Checks

Dependencies extends the usage evidence by following relationships between repository objects. It answers a different question from workload collection: which additional objects are needed by code already considered Used?

Finish Discovery and process ST03N or Jobs first. **Analyse / Resume** becomes available when one of those stages has completed or has partial results with at least one usable usage match.

## How usage spreads

Suppose a Used report calls a class, and the class uses a table. Dependency checks can establish the class and table as Used even when neither appears by name in your workload exports.

The direction matters. A reference from object A to object B can establish B as Used when A is Used. Knowing B is Used does not, by itself, establish every caller of B as Used.

Where-used and object relations contribute relationships where supported by the selected SAP system. The analysis chooses the available capabilities; you do not have to select an API.

Some dynamically constructed calls and special activation/binding mechanisms might not be represented. An empty lookup does not prove the object is unused. Listing an object in Discovery also does not guarantee that its relationships can be read on that system.

## Choose the system and load

Select a connected **Dependency system** with objects and code matching the review. A recent production copy can be suitable even when the usage files came from production.

**Concurrent SAP checks** controls the number of simultaneous lookups. Its default is `5`, with an allowed range of 1 to 20. Reduce it to lower SAP load or investigate slow requests. Increasing it does not change the evidence rules.

## Choose a processing mode

| Mode | SAP lookups | Existing results |
|---|---|---|
| Both checkboxes clear | Reuses successful checks, retries failures, and reads newly needed relationships | Retained and reassessed against current usage evidence |
| **Only process failed/empty refs** | Retries previously recorded failures or empty lookups only | Other checks and existing relationships are retained |
| **Refresh dependency cache** | Reads dependency information again after confirmation | Previous dependency cache and collected relationships are cleared; direct ST03N/job evidence remains |

### Normal processing

Use a normal run for the first dependency check and after adding ST03N or job evidence from the same code landscape. A newly Used object may need a relationship that has never been collected. Normal processing can obtain it without repeating successful cached lookups.

### Selective retry

Use **Only process failed/empty refs** to revisit missing or unsuccessful results while preserving the rest of the review. Empty means the earlier lookup returned no retained relationships; an empty result is not necessarily an error.

The retry list is chosen when you start. Each selected check is retried once during that run, even if it is still empty or unsuccessful. Other cached relationships remain available for reassessing usage through subsequent passes.

This mode does not request newly needed lookups that were never checked before. If you also need those relationships, follow with a normal run.

If no matching checks exist, an OK-only notification appears and no run starts.

### Full refresh

Use **Refresh dependency cache** when code has changed or the dependency system has been refreshed from a different source. It deliberately discards dependency lookup results so SAP is queried again.

Selecting a different Dependency system also clears the previous system's dependency cache after confirmation. Do not reuse relationships from an unrelated or differently versioned system as if they described the current code.

Full refresh and selective retry are mutually exclusive. Their checkboxes automatically clear when a run starts because they are one-run requests. The chosen processing mode remains part of the active run; an unchecked box after starting does not cancel it.

## Understand the passes and counters

Each pass checks the selected relationships and reassesses the Used set. More Used objects can lead to another pass. Processing ends when a pass finds no further Used objects.

| Display | Meaning |
|---|---|
| **Pass** | The current round of dependency reassessment |
| **Checks** | Lookups in that pass, not unique inventory objects. Where-used and outgoing relationships are separate checks. |
| **Used / Unclear** | Inventory counts from the latest reassessment; they update at pass boundaries |
| **Cached checks reused** | Checks reused in the current pass, not the total cache stored for the analysis |
| **Failed this pass** | Unsuccessful lookups in the current pass |
| **Pass history** | The number of additional Used objects found in each completed pass |

For selective retry, the check total is the saved retry-list size. It can differ from both the total inventory and the Unclear count. A zero reused-cache counter does not mean other cached relationships were deleted.

## Pause, resume, and handle issues

Choose **Pause**, or close the panel. In-flight requests can take time to settle. Resume continues saved progress, including a selective run's retry list and completed attempts.

Open **Issues** to filter failed lookups by source, object, type, or message. Export a filtered XLSX/CSV review list if several objects share the same cause. Resolve connection, authorization, missing-object, or system-alignment problems before retrying.

A successful retry removes its error row. A failed lookup does not erase independent evidence that already established an object as Used. A partial run keeps its successful results but still has review gaps.

## Change evidence without discarding the cache

Resetting or reprocessing ST03N/Jobs preserves dependency caches and relationships, but clears the old pass checkpoint. A normal dependency run then reassesses the current evidence and fetches only newly needed or unsuccessful checks.

**Reset** in Dependencies clears the dependency lookup cache and collected relationships while keeping Discovery and direct evidence. See [Run an analysis](workflow.md) for the full reset table, or [Review and export results](results.md) for interpreting the outcome.