# Customizing Troubleshooting and Questions

AI can explain the messages returned by the Customizing tools and check the affected SAP data. Installation and service repairs remain user or administrator tasks in **Customizing Setup**.

## The Tools Are Not Ready

Readiness is checked for the selected SAP connection and client. **ABAP FS > Customizing Setup** shows the installed-object and service results through **Check installation**.

| Reported problem | Meaning |
| --- | --- |
| Required objects are missing | The selected SAP system does not contain the complete installation |
| Versions differ | At least one installed component or service reports a different version from the one expected by the extension |
| A service is unavailable | Connection, sign-in, permissions, or service configuration can prevent access; the message alone does not establish that installation is missing |
| Another developer has inactive changes | Deployment cannot safely replace objects that already have unfinished changes |
| An existing object is not recognised as part of this installation | A name conflict prevents automatic replacement |
| Setup failed or was cancelled | Earlier steps may have completed; the result identifies what was saved or created before setup stopped |

Setup is optional. Without it, AI can continue read-only investigation through the general SAP tools. Configuration changes then remain a separate user task in normal SAP maintenance.

## Does a Dry Run Change SAP?

A dry run is the preview AI shows before making a change. It does not save entries or create a Customizing request. AI saves configuration in a separate step for the approved change.

This is different from installation. **Deploy objects & configure SICF** and **Configure SICF services** make real setup changes; they are not configuration previews.

## Why Did Saving Fail After a Successful Preview?

The preview shows the planned data but does not run every SAP business check. The real write can also encounter a new lock, changed data, missing permission, or transport restriction.

AI can explain the SAP message and read back the entries to check whether anything was saved. A successful preview is not a guarantee that SAP will accept the actual change.

## Why Is the Description Missing?

SAP can store descriptions separately from other setting values. AI can read those descriptions as part of the investigation; their absence from one tool result does not necessarily mean they are blank in SAP.

For a change, AI can show the proposed description in the preview and verify its saved wording afterwards.

## Why Did a Copy Leave the Description Blank?

Copying reference values does not automatically copy descriptions or every translation. A request to AI can include the required description, or ask for it to be changed afterwards.

Existing target entries are normally left unchanged, including any blank descriptions. AI can correct a description through an edit rather than another copy.

## Which Language Is Changed?

AI reports the SAP logon language used for the text change. Asking for an explanation in another language does not select a different SAP translation. Other translations remain a separate maintenance task.

## Why Were Several Rows Selected?

Some configuration entries share part of their identifying information. A request can therefore match several entries. AI's preview shows which entries would be affected before it saves the change.

## What If a Read Is Cut Short?

Large results have limits. AI can ask a more specific question or read another suitable selection, rather than assuming the first result includes everything. Comparisons report when the required data could not be read completely.

## What Does Pending Mean?

The change is still running or waiting in SAP. AI can follow its progress and report the final result without starting the change again. A reference number, called a run ID, identifies that particular operation.

| Result | Meaning |
| --- | --- |
| Pending | Submitted work is waiting or has not produced a final result yet |
| Running | The background job is active |
| Successful | SAP reported completion; AI can verify the saved values |
| Error or aborted | Processing reported an error or the job stopped without a normal result |
| Unknown | No retained result or job information was found for that run ID |

## What If the Connection Times Out?

A lost connection does not necessarily cancel work already running in SAP. AI can check the original operation and current entries to find out what happened before considering another attempt.

An unknown or expired run ID also does not prove that nothing was saved. Status information is kept for a limited time, while the configuration and requests can remain in SAP.

## Was a New Request Created Even Though the Write Failed?

That is possible: the request can be created before a later SAP validation or write error. AI can report that request number even when the configuration change was rejected. The request remains open in SAP.

The [Customizing requests](transports.md) page explains existing requests, new requests, tasks, and request reuse.

## Why Is a Setting Not Supported by the Normal Change Actions?

Not every IMG activity has a generated maintenance dialog suitable for these actions. Some settings are maintained only through a dedicated SAP transaction or have application-specific processing that must be kept.

AI can explain the limitation and continue the investigation. The actual change may need normal SPRO or a dedicated transaction. Advanced write options exist for some cases, but have different checks and need explicit agreement; they do not make every setting supported.

## Does Copy Mean a Whole Plant or Company Code Is Copied?

No. Asking AI to copy one setting does not copy an entire organisational unit or every related setting. This feature works on the particular configuration entries being discussed.

## Can an Edit Change a Key?

Changing selected values does not change the entry's identifying code. AI can help investigate a code-replacement request, but that is a different business change and may affect other settings that use the old code.

## Does Closing the Panel Undo a Change?

No. Saved SAP configuration and any running job are separate from the open panel. Likewise, cancelling setup does not undo completed installation steps. Closing a view or ending a connection is not a rollback operation.

## Are Requests Released Automatically?

No. Requests and tasks remain subject to the normal review, release, and import process.