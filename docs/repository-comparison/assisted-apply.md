# Assisted Apply

Assisted apply has two modes. Manual mode places one explicitly chosen source resource in a dirty
target editor and never saves it. Copilot-assisted mode can save every applicable changed text
resource for one user-selected table object with an explicitly user-directed transport. It verifies
inactive SAP source and records the complete attempt. Activation remains separate.

## Prepare the plan

After source comparison completes, choose whether relevance should use **Formatted differences**
(the default) or **Raw differences**, then choose **Prepare assisted apply**.

Plan preparation reads the persisted comparison and snapshot manifests. It does not contact SAP to change anything.

Each item receives one of these outcomes:

- **Ready** — source differs under the selected basis and all plan checks passed.
- **No action** — source and target are equal under the selected basis.
- **Blocked** — one or more safety checks failed.

An item is blocked when, for example:

- either snapshot is incomplete;
- source and target have different resource-file layouts;
- the object is generated or classified as standard;
- source and target object types do not match;
- formatted comparison was selected but is unavailable;
- the raw snapshot status is incomplete or failed.

The basis determines relevance only. Staging and stale checks always use the exact raw snapshots.

Source-only objects are not supported by this workflow. Assisted apply does not create missing target objects.

## Required editor settings

Staging is blocked unless:

- ABAP-effective `files.autoSave` is `off`;
- `chat.saveBeforeSend` is `false`.

The webview explains which setting is unsafe and provides a link to open it. These checks prevent an editor operation or chat message from silently saving staged ABAP content.

## Manual review of one item

For a ready item:

1. **Live source** — open the current source-system resource.
2. **Live target** — open the current target-system resource.
3. **Raw diff** or **Formatted diff** — compare the persisted local snapshots.
4. **Stage in target editor** — replace the target editor's in-memory text with the reviewed source snapshot.
5. Review the dirty editor.
6. Save manually and choose or confirm the appropriate transport.
7. Activate the object and any related components through the normal ABAP FS activation flow.

If several text resources changed, the workflow asks which one to review or stage. Repeat the process for every related component that must be changed together.

!!! danger "Staged does not mean saved"
    After staging, the target editor is dirty. SAP is not changed until you save through the normal editor flow.

## Stale-plan protection

Immediately before staging, the workflow verifies:

1. the saved source snapshot still matches the plan;
2. a freshly downloaded target snapshot still matches the target reviewed by the plan;
3. the target editor has no existing unsaved changes;
4. the editor safety settings are still valid.

If source or target changed, the old plan is rejected. Rerun source comparison, prepare a new plan, and review the new diff instead of forcing stale content through.

## What remains manual

The workflow deliberately leaves these decisions to you:

- whether to stage each item;
- whether the complete object is safe to save;
- which transport to use;
- when and how related objects should be activated;
- how to resolve syntax, dependency, or activation errors.

In manual mode, Copilot cannot click **Stage**, save the target editor, choose a transport, or
claim that synchronization succeeded.

## Copilot-assisted execution

The user explicitly enables Copilot-assisted mode, saves the exact eligible object selection, and
retains ownership of the transport decision. For one selected object, Copilot:

1. reviews a bounded diff and records `as-is`, `skip`, or `needs-human` with a reason;
2. checks current target transport status and obtains the user's exact transport direction;
3. invokes the singular repository apply tool;
4. receives one persisted attempt ID and per-resource save/verification results;
5. separately activates the exact related URL set;
6. records activation success or failure against that attempt.

The apply tool processes every applicable changed text resource belonging to that table row. A
new request created for the first resource is reused as the existing request for later resources.
It stops on the first unknown or failed resource and reports the object as partial when earlier
resources succeeded.

Each row shows attempt count, latest stage/status, actual apply transport, time, and error. Use
**History** to inspect every persisted lifecycle event, including hashes, intent IDs, resource
paths, transport details, verification, activation URLs, timestamps, and failures. Successful
activation recording marks the object done; failures leave it pending.

