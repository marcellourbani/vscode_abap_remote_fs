# SAP Customizing Guide

ABAP FS lets AI find, explain, compare, and change supported SAP Customizing settings through a conversation. A request can start with a business question rather than a table name or a list of technical steps.

For example, AI can find the setting behind a document type, explain its current values, compare two entries, or create a new entry from a reference. It uses the connected SAP system to do the investigation and, when requested, make the change.

The feature complements SPRO and normal SAP maintenance. Business decisions remain with the user, and SAP permissions and checks still apply.

## What Can Be Asked

| Example request in chat | What AI can do |
| --- | --- |
| "Where is this setting maintained?" | Find matching IMG activities and identify the relevant configuration |
| "Explain the current settings for this entry." | Read the SAP values and descriptions and explain them |
| "Compare these two entries." | Show missing entries and differences without changing either one |
| "Create a new entry based on this reference, with a different description." | Prepare the copy and requested differences, show a preview, and make the approved change |
| "Change this description and leave everything else as it is." | Edit the requested value and check that other values were retained |
| "Remove these temporary entries." | Show which entries would be deleted, perform the approved deletion, and check the result |

AI handles the table lookups and tool calls. The conversation supplies the intended result, SAP system, and any business choices that cannot be inferred safely.

## Two Ways to Work

| Way of working | What is available | Setup |
| --- | --- | --- |
| Dedicated Customizing tools | AI finds, reads, compares, and makes approved changes to supported settings | The optional ABAP FS Customizing service must be installed in the selected SAP system |
| Investigation without that service | AI investigates and explains settings through the general SAP tools; this method cannot edit configuration | No extra Customizing service; the usual SAP connection and read permissions still apply |

Installation is optional. Choosing not to install does not prevent normal SPRO work or read-only investigation through other available features. The dedicated Customizing tools, including their read actions, do require the service.

## Effort and Cost

Without the dedicated tools, AI may need many separate queries and intermediate results to find and understand a setting. Finding a complete SPRO path can take particularly many steps. That usually takes more time, fills more conversation space, and can increase model usage charges.

The new tools perform much of that work internally, so AI generally needs fewer conversation steps for supported tasks. The saving varies by task and by the model service and plan. There is no fixed cost or time reduction, and some investigations still need the older read-only approach.

## How Changes Work

AI reads the current configuration and shows a preview before saving a change. The preview does not save configuration or create a transport request. It makes the affected entries and proposed values visible in the conversation.

When the requested change is approved, AI saves it through the Customizing tools and reads the affected entries again to check the result. It can use an existing Customizing request or create a new one when asked. It does not automatically release requests.

AI may ask for clarification when the SAP system, intended entry, business value, or transport choice is unclear. It does not need the user to prepare tool parameters or write the underlying queries.

## What Is Not Included

This is not a whole-system or whole-organisational-unit copy. Asking AI to copy one setting does not automatically copy every related setting or translation. The feature also does not synchronise configuration between systems.

Some settings still require SPRO or a dedicated SAP transaction. AI can explain such a limitation and continue an investigation, but the availability of a tool does not remove SAP permissions, client restrictions, business checks, or locks.

## Connections and Permissions

Each operation runs on a selected SAP connection and client, using that connection's SAP identity and permissions. Read access and permission to change configuration are separate. Normal production approval and transport processes still apply.

Setup and readiness belong to the selected system. Different systems or clients can have different installations, access, and change restrictions.

## Read More

- [Setup and installation](setup.md): installation choices, permissions, and the readiness check.
- [Workflow](workflow.md): the stages of a configuration task and the results they provide.
- [Create, copy, edit, and delete](changes.md): action behaviour, descriptions, and languages.
- [Customizing requests](transports.md): existing requests, new requests, tasks, and request reuse.
- [Updates](updates.md): update notices, installation methods, and version checks.
- [Troubleshooting and questions](troubleshooting.md): common messages, limitations, and recovery steps.