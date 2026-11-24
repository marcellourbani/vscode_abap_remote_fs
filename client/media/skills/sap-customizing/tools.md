# Working With the Customizing Tools

Read this guide only after the chosen connection reports `ready: true`. The tool descriptions define the current fields and limits. This guide explains how to combine the tools safely without repeating every field description.

## Start With the Task

Identify the requested result, exact SAP connection and client, and whether the task is an investigation or an approved change. A request to find, explain, compare, or review settings is read-only unless a change is also requested.

Use the system already chosen in the conversation. Do not list connections or check unrelated systems. Read each table's current field and key information before using its fields, then reuse it while the object and system are unchanged.

## Find the Setting Efficiently

| Starting point | Useful next step |
| --- | --- |
| A business setting or IMG activity name | `abapfs_search_img`, using a short distinctive phrase |
| An exact table or maintenance-view name | `abapfs_describe_customizing`; no broad search is needed |
| Known source and target key values | Describe the object, then use `abapfs_diff_customizing` |
| A proposed copy | `abapfs_plan_customizing_change` for comparison, followed by an Apply dry run before any write |

Check that a search result is the intended business activity before following its table or view. Similar names can refer to different settings. If a search is cut short, narrow the phrase or area; do not treat the first page as a complete result.

Describe shows the main table, any text table, key fields, maintenance details, and transport information. A view cluster is a group of settings, not permission to copy the whole group. Work on the exact member table or view required for the task. This feature does not copy a whole company code, plant, or other organisational unit.

## Read and Compare

`abapfs_read_customizing` reads the main table behind a maintenance view. It does not merge descriptions from a text table. Use the text-table information from Describe to read the relevant descriptions separately, or use a small read-only SQL query after checking the field names.

Keep leading zeros, blank keys, dates, and language keys in SAP's required format. Blank and missing are not the same. Never infer that a description is missing just because the main-table read does not show it.

Read only the entries needed for the task. If a result is cut short, split the question into smaller reads or increase the limit deliberately. A partial read is not proof that an entry does not exist. Do not paste large tables into the answer when a few changed fields are enough.

## Required Change Sequence

1. Read the current entries and relevant descriptions. For a copy, read the source and check the target.
2. Confirm the requested change and transport choice. Ask about ambiguous keys, language, or affected entries before proceeding.
3. Call the intended change tool with `commit: false`, or leave `commit` out. **A dry run is mandatory before every change**, including a correction, repeat attempt, or cleanup deletion.
4. Inspect the row count, every target key, base values in `DATA`, view-only values in `EXTRAS`, and language messages. Check that unrelated entries and values are unchanged. Explain the important changes and any risks.
5. If the preview matches an authorised request, commit with the same change inputs. Do not silently add an override or switch to another transport. If any change input changes, run a new dry run.
6. If the result is pending, follow the returned `RUN_ID` with `abapfs_get_customizing_status` on the same connection. Do not submit the change again.
7. Read the saved entries and descriptions. Compare the actual result with the intended values, including fields that should have stayed the same.

A plan from `abapfs_plan_customizing_change` is a comparison, not the required write preview. A dry run is not saved approval data: the commit reads current data again. Unexpected differences or intervening changes require another check.

Dry runs do not run every check performed by SAP maintenance at commit. A preview can succeed and the real change can still fail a business rule or encounter a lock.

## Choose the Right Change Tool

### Edit Existing Entries

Use `abapfs_apply_customizing` with equal source and target keys, `onlyMissing: false`, and explicit `values`. Supply only the fields to change. Unmodified values are retained. Key changes are refused.

Example: change one description for an existing setting, then change a status field while keeping that description. Preview and verify each edit separately. An empty string explicitly clears a field; leaving it out keeps its value.

### Copy Reference Settings

Use Apply with different source and target keys. The default `onlyMissing: true` skips existing main-table keys, even when their descriptions are blank. Use an in-place edit to repair an existing entry rather than trying the copy again.

A copy does not automatically copy source descriptions or every dependent table. Add approved view-only overrides where supported, or edit the description afterwards. With `onlyMissing: false`, a copy can replace existing target values with the source values. It is not a partial edit of the target.

### Create Explicit Entries

Use `abapfs_create_customizing` when there is no reference row or the key has several fields. Include every non-client key explicitly, even when an intended key value is blank. Values must be strings. Let SAP supply the current client.

The default skips existing keys. `onlyMissing: false` is a full-row insert or replacement: omitted fields can become blank. Supply complete final rows when using it. For a partial edit, use Apply instead.

### Delete Entries

Use `abapfs_delete_customizing`. One equality filter can select several rows, so inspect the complete preview. A cleanup deletion needs its own dry run and read-back check too.

After deletion, check the main table and relevant text table. If a result warns about remaining rows or manual verification, report that limitation rather than claiming everything was removed.

## Descriptions and Languages

View-only fields, such as a description stored in another table, appear in `EXTRAS` rather than the main-table row. Read those extras before committing.

Text changes use the current SAP logon language reported by the write preview. A language chosen for a search does not change the write language. Do not invent a write-language option or promise that all translations will be copied or changed.

If another language is required, agree on a supported maintenance step in that language. Do not update the text table directly to work around the language restriction.

## Customizing Requests

- Prefer an approved existing Customizing request and keep using it for related changes on the same system.
- If the user explicitly asks for a new request, use `createTransport: true`; `transportText` can provide its description. Leave `transport` out.
- If no request has been chosen, ask whether to use an existing request or create a new one. Do not choose a new request silently.
- Preview and zero-row plans create no request. The commit reports the chosen or created number as `TRANSPORT`. Use that number on later calls; do not keep sending `createTransport: true`.
- SAP records changes on a task beneath the request. A returned task is not a second request. No request or task is released automatically.
- A request can be created before a later write fails. Keep any returned number and inspect the result before retrying; do not create another request just because the data change failed.

SAP client settings still apply. A client may prohibit changes or not record them. Do not try another write mode to get around that policy. Production changes need explicit permission and the organisation's normal approval.

## Direct Writes Are Exceptions

Normal work uses the SAP maintenance dialog's processing. It is not an automatic fallback when that processing is missing or rejects an entry.

`recordTableKeys: true` on Create allows an explicitly approved base-table write, with transport-key recording, when no generated maintenance exists. Complete base rows are required. The dedicated transaction's checks are not run, and view-only fields cannot be written this way.

`recordTransport: false` is an explicit unrecorded base-table write where supported. It bypasses maintenance checks, cannot write view-only fields, and cannot be combined with a request or new-request creation. In-place Apply edits and Delete do not offer this mode.

Explain the omitted checks and obtain permission for the direct mode itself. Never select it merely to make a refused normal change succeed. Prefer manual SPRO or the dedicated transaction when those checks matter.

## Errors and Uncertain Results

If these tools cannot complete an investigation, explain the limitation and read `legacy.md` only when you actually need that read-only fallback. Do not read it just in case. The old method does not offer editing. A failed or uncertain write must be checked before changing approach, and a SAP validation or permission error must not be bypassed.

- **SAP validation error:** Report the SAP message. Read back the affected entries to check for saved changes. Correct the business input only with permission, then preview again.
- **Lock or transport error:** Use the required request or wait for the responsible person. Do not release someone else's locks or requests automatically.
- **Pending or running:** Use the exact returned run ID; check at sensible intervals, not in a tight loop. Continue until a final result or a genuine blocker.
- **Timeout, connection loss, or unknown result:** Do not assume rollback. Check status and current data before considering another write. The original job may still finish.
- **Service unavailable or outdated:** Return to the entry skill's setup path. Do not install anything through general-purpose tools or replace the change with generated ABAP.

## Example Task Sequences

**Explain a setting:** Find the activity, describe the exact object, read the relevant configuration and texts, then explain the business values. No change tools are needed.

**Add a setting from a reference:** Read the reference and target, agree on overrides and request, preview the copy, commit it, and verify flags and descriptions separately. Edit any required description through Apply with another preview.

**Create several storage locations:** Describe the table, prepare complete composite keys and string values, preview the explicit rows, inspect every key, commit once, and read back all intended locations. Split a large batch into clear groups instead of assuming one successful sample proves every row.

**Correct one field:** Read the entry and text, preview an in-place Apply edit, commit, and verify both the new value and the fields that should remain unchanged.

**Test an approved temporary setting:** Check it is safe to use the chosen key, create it through a preview and commit, verify it, perform only the approved tests, then preview deletion and verify that both the entry and its texts are gone. Leave the source settings unchanged and the request unreleased.

## Save Time Without Skipping Checks

Prefer the dedicated tools for tasks they support. Do not rebuild their table-discovery or comparison work with manual SQL just because the old method is familiar. The tools can perform several SAP requests internally without making you read every intermediate table result. This reduces assistant calls and context use; it does not mean each tool makes only one SAP request.

With an exact table or view name, start with Describe rather than searching for the activity or reconstructing its SPRO path. Use the old guide only for a real missing capability or investigation that the tools cannot complete, such as a complete reverse SPRO path when it is actually required.

Reuse field information and saved-value checks within the same unchanged task. Prefer a specific key to repeated broad searches. Independent read-only checks can run together; writes that depend on each other cannot. Keep the chosen request and exact run ID available rather than searching for them again.

Do not save tokens by skipping a dry run, hiding extra rows, ignoring warnings, guessing field names, assuming language behaviour, or treating a success message as proof of the saved result.