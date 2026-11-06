# Check Which Objects Are Called By Used Code

A program can be used without every class or function it calls appearing in ST03N or the job list. This step uses where-used and object relations to find more of those objects.

For example, suppose a used report calls a class, and that class calls a function module. This check can mark the class, the FM's own row, and its function group Used too. It follows the chain even if the checks finish in a different order.

Finish Discovery, then process ST03N or Jobs first. Either one is enough, but it must find at least one usable usage match. Until then, **Analyse / Resume** is disabled and the screen explains why. Without a Used starting point, where-used would have nothing to follow and could not mark more objects Used.

## Which System Should I Choose?

For a production review, **Dependency system** can be production itself or a production-like system from the same SAP landscape. Prefer a recent production copy with the same objects and code as production. QA is also an option if the code you are reviewing matches production.

You do not have to connect production itself. This step checks the code and where-used results in the system you select; it does not need that system's usage history. You can use production ST03N and job files with where-used checks from a matching copy.

Check for code changes or missing objects before choosing another system. A different version of a program can call different objects and give different results.

## Run The Check

1. In **Dependency system**, choose a connected SAP system containing the code you are reviewing.
2. Leave **Concurrent SAP checks** at `5` unless you have a reason to change it.
3. Choose a cache option below, or leave both checkboxes clear for a normal run.
4. Click **Analyse / Resume**.

**Concurrent SAP checks** means how many checks can run at once. Use a smaller number if SAP is slow or your team wants to reduce the load. The allowed range is 1 to 20.

The analysis uses object relations when the system supports it. Otherwise, it uses where-used only. You do not need to choose the API yourself.

## Choose What To Check Again

| Option | When To Use It | What Happens |
|---|---|---|
| Leave both checkboxes clear | First run, or after adding more ST03N/job evidence | Reuses successful cached checks, retries failed checks, and reads any newly needed relationships. Reassesses the objects using the current usage evidence. |
| **Only process failed/empty refs** | Retry previous failures or checks that returned no relationships | Retries only those previously recorded checks. Keeps other cached results and existing relationships. Does not read relationships that have never been checked. |
| **Refresh dependency cache** | Code or the contents of the dependency system have changed | After confirmation, clears earlier dependency checks and relationships and reads them again. Direct ST03N/job evidence is kept. |

Full refresh and selective retry cannot be selected together. Each checkbox applies to the run you start and automatically clears when the run begins. This does not cancel the selected mode. Pausing and resuming continues the saved run without restarting its selection.

If selective retry has no matching checks, an OK-only message appears and no run starts. Empty results are eligible for retry, but are not errors by themselves.

After adding usage evidence, a normal run is usually the right choice. It can obtain a relationship needed for a newly Used object; selective retry deliberately limits SAP requests to its saved retry list.

## Follow The Passes

The check runs in passes. Each pass uses known relationships to reassess which objects are Used. Newly Used callers can lead to more Used objects in the next pass. The run stops when a pass finds no further objects.

- **Checks** counts lookups, not unique objects. A where-used lookup and an outgoing-relations lookup are separate checks.
- In selective retry, the total is the number of failed/empty checks selected at the start. It is not the number of Unclear objects.
- **Cached checks reused** counts checks reused in the current pass, not every entry kept in the saved analysis.
- **Failed this pass** counts unsuccessful lookups. A run can finish as **partial** while keeping the successful results.
- Used/Unclear counts are reassessed at pass boundaries. They need not change after every individual lookup.

## Read The Results

Objects found to be called by Used code are marked Used. The Reasons column shows which caller led to that result. Choose **Unclear** in **View** to see what still needs your attention.

An object is not marked Used just because another object refers to it. That caller must already be Used, or be reached from Used code. A group of objects that only call each other stays Unclear if nothing Used calls into it.

Some calls cannot be found by where-used, for example when a program builds a function-module name at runtime. An object that stays Unclear may still be used. Do not treat this list as approval to delete it.

A function group marked Used because of one function module does not mean all the other function modules in that group ran. Likewise, a caller's usage date is not shown as the date its called objects ran.

## Pause And Continue

Click **Pause**, or close the panel. A SAP call already running may need to finish before the check stops.

Open the saved analysis and click **Analyse / Resume** to continue. Finished checks are kept, so you do not have to start from scratch. You can review or export the results while some checks are still unfinished.

If a check fails, open the **Issues** tab. Filter by Stage, Source, Object, Type, Package, File, or Issue to investigate. Export **All issues** or **Filtered issues** as XLSX or CSV to review them outside VS Code.

Reconnect or resolve the reported access/object problem, then run normally or select **Only process failed/empty refs**. Successful retries remove the corresponding error rows. An unsuccessful lookup does not erase usage evidence established by other checks.

## Check Again After Code Changes

Select **Refresh dependency cache** before running the check if the code has changed or your production copy has been refreshed. This tells the analysis to ask SAP again rather than use the earlier where-used results.

Choosing a different **Dependency system** also clears the earlier checks for you.

You can also click **Reset** in Dependencies to clear this step's checks without removing Discovery, ST03N, or Jobs results.

Resetting or reprocessing ST03N or Jobs keeps the dependency cache and relationships. Used/Unclear statuses are reassessed against the remaining or new usage evidence. Run Dependencies normally afterward to reuse that cache and read any newly needed relationships.