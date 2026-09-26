# Assisted Apply

Assisted apply helps you review a source difference and place one approved source file in the target editor. It does not save, select a transport, activate, create, or delete SAP objects.

## Prepare the plan

After source comparison completes, choose **Prepare assisted apply**.

Plan preparation reads the persisted comparison and snapshot manifests. It does not contact SAP to change anything.

Each item receives one of these outcomes:

- **Ready** — source differs from target and all plan checks passed.
- **No action** — source and target are already identical.
- **Blocked** — one or more safety checks failed.

An item is blocked when, for example:

- either snapshot is incomplete;
- source and target have different resource-file layouts;
- the object is generated or classified as standard;
- source and target object types do not match;
- the comparison status is not `different`.

Source-only objects are not supported by this workflow. Assisted apply does not create missing target objects.

## Required editor settings

Staging is blocked unless:

- ABAP-effective `files.autoSave` is `off`;
- `chat.saveBeforeSend` is `false`.

The webview explains which setting is unsafe and provides a link to open it. These checks prevent an editor operation or chat message from silently saving staged ABAP content.

## Review one item

For a ready item:

1. **Review Live source** — open the current source-system resource.
2. **Review Live target** — open the current target-system resource.
3. **Review Diff** — compare the saved source snapshot with the current target resource.
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

Copilot can prepare and explain a plan, but it cannot click **Stage**, save the target editor, choose a transport, or claim that sync succeeded.

