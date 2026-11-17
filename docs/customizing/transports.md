# Customizing Requests

A user can ask AI to record changes on an existing Customizing request or create a new one. ABAP FS supports both choices; how the work is grouped remains the user's decision.

Examples in chat:

- "Use Customizing request <request number> for these changes."
- "Create a new Customizing request for this work, with the description <description>."

## Existing Requests

When an existing request is named in the conversation, AI uses it for the requested work. One request can cover a sequence of create, copy, edit, and delete operations. SAP checks that the selected request is open and suitable for Customizing changes.

## New Requests

When a new request is explicitly requested, AI can create it as part of saving a supported change and report its number. A description can be supplied in the conversation; otherwise ABAP FS generates one.

The preview does not create a request. No request is created when there is nothing to change. The returned number is available for further work, so AI can continue using it when that is what the user wants.

## Request and Task Numbers

SAP records work on tasks beneath a request. ABAP FS can find or create the current person's task under the selected request, so the result may mention both numbers. A task is not another Customizing request.

## If a Change Fails

Request creation can succeed before a later configuration change fails. AI may therefore report a new request even when the data change was rejected. The request remains in SAP; the failed change does not automatically remove it.

If a connection is lost, AI can check the original change's result rather than treating a new request as a continuation of that operation.

## Client Rules Still Apply

The request choice does not override SAP client restrictions. Some clients prohibit changes; others allow changes without transport recording. AI reports a restriction when a request cannot be used for the selected operation.

## Release and Import

ABAP FS does not automatically release requests or tasks, or import them into another system. Those actions remain part of the usual SAP transport process.

Deleting a temporary configuration entry does not delete its request. The request can still contain records of the work performed.