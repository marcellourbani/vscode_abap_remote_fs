# Run a Repository Comparison

This guide follows the three stages shown in the Repository Comparison Workflow webview.

You can run the same persistent workflow through Copilot. See [Repository Comparison with Copilot](ai-tools.md) for the dedicated LM tools, example prompts, and bounded result reads.

## 1. Create the workflow

1. Connect both SAP systems in VS Code.
2. Run **ABAP FS: Repository Comparison Workflow**.
3. Select the source and target connections.
4. Enter an optional description and choose **Create workflow**.

Source and target are fixed for the life of the workflow. Check the direction before running discovery, and check it again before assisted apply.

## 2. Define the discovery scope

Enter at least one object-name pattern or package pattern.

| Criterion | Behaviour |
|---|---|
| Object name pattern | One pattern with `*` for any characters and `?` for one character |
| Exclude object names | Comma-separated wildcard patterns |
| Package patterns | Comma-separated patterns such as `ZDEMO*` or `/EXAMPLE/*` |
| Object types | Leave empty for every supported type, or select only the types you need |
| Customer namespaces | Exact namespace values |
| Authors | Exact author values |
| Created from/to | Inclusive dates in `YYYYMMDD` format |
| Include subpackages | Resolves and includes child packages |
| Include deleted/generated/`$TMP` | Includes objects normally excluded from discovery |

When both an object-name pattern and package patterns are present, an object must match both.

Package patterns `*` and `/*` are rejected because they are unrestricted. Prefer the narrowest useful scope: broad discovery can query and later download a large part of a repository.

Choose **Save criteria** to persist the scope without running it, or **Run discovery** to save and start.

!!! warning "Saving criteria resets derived results"
    Saving criteria clears previous discovery output, inventory comparison, source selection, downloaded snapshots, source comparison, and assisted-apply results. Do not use it as a resume button.

## 3. Discover both systems

Discovery queries source and target independently and saves an inventory for each system. When both inventories finish, their existence comparison runs locally and automatically.

The inventory tables show:

- object name and type;
- package;
- classification (`custom`, `standard`, `partner`, `generated`, or `uncertain`);
- the reason for that classification.

You can filter and sort either table, then export it.

If you pause discovery, the current package checkpoint is saved. **Resume discovery** continues from that checkpoint. Running an already completed discovery again is a deliberate rerun and clears downstream results.

## 4. Review inventory presence

The comparison table reports each unique repository key as:

- **Present on both** — potentially available for source comparison;
- **Only on source** — no corresponding target object;
- **Only on target** — no corresponding source object;
- **Error** — inspect the row before continuing.

A repository key includes program ID, object type, and object name. Objects with the same name but different types remain separate rows.

`DEVC` package containers remain visible in the inventory but cannot be selected for source comparison. Downloading a package container could recursively repeat work already represented by its individual objects.

## 5. Select source-comparable objects

By default, all comparable objects are selected.

Use the controls above the table to change that:

- **Select all comparable objects** selects or clears the full comparable set.
- **Select filtered** adds every comparable row matching the current table filters.
- **Clear filtered** removes matching rows while preserving selections outside the filter.
- The checkbox in each row selects one object.

Table filters use prefix matching by default. Add a trailing space for an exact match, or use `*` and `?` wildcards.

For example:

- `CL` matches types beginning with `CL`;
- `CLAS ` matches only `CLAS`;
- `ZCL_*` matches class names beginning with `ZCL_`.

## 6. Configure verification and downloads

The comparison stage has three independent concurrency controls:

- **Parallel downloads from source** — 1 to 10 SAP object downloads.
- **Parallel downloads from target** — 1 to 10 SAP object downloads.
- **Parallel local snapshot verification** — 1 to 128 local verification tasks; default 32.

The first two values affect SAP and network load. Local verification reads only the workflow folder and does not send SAP requests.

On resume, both sides are verified before missing snapshots are downloaded. The progress label changes from **Verifying current state before resuming…** to **Downloading source and target snapshots…** at the real phase boundary.

Choose **Compare selected source code** to save the selection, download both sides, and run the local comparison.

## 7. Read source-comparison results

| Status | Meaning |
|---|---|
| `identical` | Source and target snapshot hashes match |
| `different` | At least one resource file differs |
| `partial` | One or both snapshots were incomplete |
| `source-missing` / `target-missing` | An expected snapshot manifest is absent |
| `error` | The comparison could not be completed |

The table also shows changed-file and line counts. These are textual metrics: reordered ABAP code can appear as removed and added lines even when its behaviour is similar.

Use **Open diff** for a standard VS Code side-by-side comparison. If an object contains several changed text resources, you are prompted to choose one.

## 8. Pause, resume, and rerun

- Pausing freezes the elapsed timer and preserves completed snapshots.
- Resuming rechecks saved snapshots locally, then downloads only missing or invalid ones.
- Changing only the three concurrency values does not invalidate discovery or snapshots.
- Supplying a new source selection clears earlier snapshots and downstream results.
- Saving discovery criteria clears the entire derived workflow.

If a step fails, read its displayed error before resetting anything. Retrying without changing criteria or selection preserves reusable artifacts.

When the source comparison is complete:

- continue with [Assisted apply](assisted-apply.md) only if you intend to review possible source-to-target changes;
- see [Repository Comparison with Copilot](ai-tools.md) to inspect results or operate later stages through LM tools;
- use the [Technical reference](technical-reference.md) for persistence, invalidation, statuses, and limits.

