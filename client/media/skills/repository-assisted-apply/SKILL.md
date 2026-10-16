---
name: repository-assisted-apply
description: Safely review, apply, verify, activate, and record one user-selected object in an ABAP FS Copilot-assisted repository-comparison workflow. Use only after the repository workflow has a prepared assisted-apply plan and the user has enabled Copilot-assisted apply.
---

# Repository Assisted Apply

Use this skill only for the Copilot-assisted apply phase of an ABAP FS repository-comparison
workflow. Do not use its apply or activation-record operations for ordinary ABAP editing.

Repository assisted apply propagates reviewed raw source between live SAP systems, saves inactive
code through CTS transport handling, and can activate executable repository objects. A wrong
object, stale review, guessed transport, incomplete activation set, or unintended retry can
overwrite pending work or affect unrelated code. The rules in this skill are authorization and
safety boundaries: follow them exactly, fail closed on missing evidence, and return control to the
user instead of guessing.

The user owns all authorization boundaries:

- enabling Copilot-assisted mode;
- selecting and saving the exact eligible objects;
- approving an existing transport request, a new-request description, or local handling;
- approving each tool confirmation.

Copilot reviews and orchestrates one selected object at a time. It never chooses objects or
transports.

## Preconditions

Before any per-object work:

1. The comparison and assisted-apply plan must already exist.
2. The workflow must currently be in Copilot-assisted mode with recorded user consent.
3. The user must have saved the allowed object selection in the workflow UI.
4. The exact object must be pending and eligible.

Use `abapfs_get_repository_workflow` with the smallest required includes. Read
`assistedApplyObjects` to confirm selection and state; use `diff` with one exact `objectKey` for a
bounded raw or formatted review. Never request unbounded repository source.

## Parent-agent orchestration

Prefer delegating execution to `abap-repository-assisted-apply` when that enabled subagent is
available. One invocation handles exactly one table object.

Before delegation, the parent agent must:

1. identify one exact `workflowId` and one exact saved `objectKey`;
2. obtain current target transport status when necessary;
3. explain any existing lock to the user;
4. collect the user's exact transport direction;
5. pass only that one object and direction to the subagent.

The transport direction must be one of:

- exact approved existing request number;
- exact approved new-request description for this object;
- explicit local-object handling.

If you are the main agent, you own the user conversation, ordering, bounded-wave approval, worker
concurrency, result synthesis, and transport-strategy choice. Follow the `repository-workflow`
skill's parallel-wave process. If the user wants one shared new request, create it as the main agent
and pass its exact number to the applicable workers. If the user wants one new request per object,
pass one exact approved description to each worker. Never infer which strategy the user wants, and
never delegate without a complete per-object transport path. Never send multiple objects to one
subagent.

If you are the delegated subagent, do not select objects, ask the user to choose a transport, run
the user-only bulk transport check, choose a transport strategy, process arrays, launch other
agents, or retry failed work. You may create exactly one request only when the parent supplied an
exact user-approved per-object description. You handle only the one object delegated to you.

## Review and decision

For one selected pending object:

1. Read a bounded object diff. Formatted diff is useful for low-noise review; raw snapshots remain
   authoritative for apply.
2. Decide exactly one:
   - `as-is`: the reviewed source snapshot should be propagated unchanged;
   - `skip`: it should not be propagated;
   - `needs-human`: uncertainty, target customizations, unsupported changes, or risk require review.
3. Call `abapfs_get_repository_workflow` with `assistedApplyAction: "setDecision"`, the singular
   `objectKey`, the decision, and a concise evidence-based reason.

Never batch decision updates. Never leave an unexplained `as-is` decision. Stop after `skip` or
`needs-human`.

## Transport gate

Immediately before applying `as-is`, call `abapfs_get_object_transport_status` for the singular
target object. A persisted webview transport check is useful context but can be stale.

| Current status | Allowed direction |
|---|---|
| `locked` | Use that exact request only after the user approves it |
| `not-locked` | Use only the exact existing request number or exact per-object new-request description supplied by the parent. |
| `local` | Use local handling; no request is assigned |
| error/unknown/conflict | Stop and return to the user |

Never invent a request or description. Never silently create, switch, or fall back to another
request. If an object becomes locked differently after approval, stop and ask the parent to resolve
the conflict with the user.

The workflow UI also has **Determine transport request for selected objects** with bounded SAP
concurrency. It is a visible user-only bulk operation and is not exposed through a Copilot-callable
tool, so you cannot invoke it. Do not simulate that bulk operation by looping
`abapfs_get_object_transport_status` across the selection.

## Guarded apply

Call `abapfs_apply_repository_workflow_object` with exactly:

- the workflow ID;
- one selected object key;
- the user-approved transport choice.

The tool, not the model:

- revalidates workflow consent, saved selection, pending state, eligibility, decision, and reason;
- derives all applicable changed text resources represented by the table object;
- revalidates reviewed raw source and current target hashes;
- arms a short-lived transport intent for each resource;
- writes the reviewed raw bytes directly through the normal ABAP filesystem provider, without
   editor staging or `document.save()`;
- waits for the filesystem write and transport result to finish;
- verifies every inactive SAP source against the reviewed raw snapshot, retrying briefly stale
   reads and tolerating line-ending and trailing-whitespace differences;
- returns verified SAP source, object, and activation-owner paths for each resource;
- persists apply, transport, save, verification, timestamps, request, and errors.

Do not use editor write tools, regenerate source, or apply resources individually. A fully
successful tool result still means only that inactive source was saved and verified; it is not
activation or completion.

If status is `failed`, `partial`, `timed-out`, or `cancelled`, stop. Report the exact attempt ID,
resource outcomes, actual request if known, and error. A timeout is an unknown outcome, not proof
of failure. Do not retry automatically.

## Activation gate

Activation is intentionally separate and agent-orchestrated:

1. Call `abapfs_activate_object` with `action: "get_inactive_objects"` on the target connection.
2. Collect each successful `resourceResults[]` entry's `objectUri`, `sapSourceUri`, `sapObjectUri`,
   and `sapActivationUri`. The first is a workspace URI; the `sap*Uri` fields are verified SAP ADT
   paths, not workspace paths. Do not compare one representation with another.
3. Correlate each applied resource with an inactive entry on the same target connection. Prefer an
   exact match between the entry's `uri` and `sapSourceUri` or `sapObjectUri`. Otherwise, an exact
   match between the entry's `uri` and `sapActivationUri` proves the owning activation object.
   Exact equality between `workspaceUri` and `objectUri` is also valid when available, but is not
   mandatory. Names, types, regex matches, path prefixes, and `parentUri` alone never prove membership.
4. Require complete, unambiguous coverage of every applied resource needing activation. Several
   resources may map to one owning activation object; this is valid, not a one-to-one requirement.
   Deduplicate the corresponding returned `url` values. If ownership evidence is missing, coverage
   is empty or incomplete, or an owner would activate unrelated inactive components that were not
   applied, stop with `NEEDS_HUMAN_ACTIVATION`. Older apply results without SAP identity fields may
   use exact workspace equality only; never guess or strip source suffixes to invent ownership.
5. Call `abapfs_activate_object` once with `action: "activate"` and the complete exact URL set.
6. Treat activation as successful only when the tool verifies none of the requested objects remain
   inactive.

Do not activate unrelated inactive work already present in the developer's session.

## Record activation and completion

After an activation attempt, use
`abapfs_record_repository_workflow_object_activation` only for this repository workflow attempt:

- pass the exact workflow ID, object key, successful apply attempt ID, and activated/attempted URLs;
- record `succeeded` only from the activation tool's verified result;
- record `failed` with the exact attempted URL set and returned error when activation fails.

Successful recording persists completion and marks the object done. Failed recording persists the
failure and leaves it pending. Never call this tool for normal ABAP activation, invent URLs, or use
`markDone` as a shortcut.

Execution history is available through `abapfs_get_repository_workflow` with
`include: ["assistedApplyHistory"]` and one exact object key. The workflow UI also exposes the
persisted per-object history.

## Manual-mode boundary

Manual assisted apply is a separate user-driven path. Its stage action opens one reviewed raw target
resource as a dirty editor and leaves save, transport selection, and activation to the user.
Copilot-assisted apply must use the singular workflow apply tool; do not automate the manual
button, and do not treat a manual dirty editor as a completed apply.
