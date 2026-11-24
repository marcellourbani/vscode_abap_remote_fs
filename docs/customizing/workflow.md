# Customizing Workflow

A Customizing task starts with a request to AI. ABAP FS gives AI the tools to investigate the setting and carry out supported changes. The user describes the intended result; AI handles the SAP lookups, previews, tool calls, and saved-value checks.

For example: "Find the setting for this process and explain the current values" is an investigation. "Create a new entry based on this reference and change its description" also asks for a configuration change.

## Selected System and Task

AI works on the SAP connection and client identified in the conversation. If the choice is unclear, it asks which system is intended. It also checks whether the Customizing tools are ready there.

An explanation or comparison does not give AI permission to change configuration. Business choices and approval of the requested work remain with the user.

## Finding a Setting

AI can search from a business description, so a table name is not required to start. An exact setting or table name can make the investigation shorter when it is already known.

AI can explain similar matches and ask which business area is intended rather than assuming that the first result is correct.

## Setting Details

AI uses the setting's SAP details to find the relevant fields, entries, descriptions, and maintenance options. It can explain those details when useful; the user does not have to work out the table relationships before asking a question.

AI works on the particular setting requested. Finding one member of a larger group does not mean it will change the whole group.

## Current Entries

AI reads the relevant entries and their descriptions and presents the values needed for the question. It handles details such as leading zeros and descriptions stored separately in SAP.

If the selection is too large to read completely, AI can narrow it or explain the limit. A partial result is not presented as a complete picture of the configuration.

## Reference and Target Comparisons

AI can compare two entries or groups of entries in the same SAP system and explain what is missing or different. This does not change either set.

For a proposed copy, AI can show how the new entries would differ from the reference before preparing the change.

## Change Previews

Before a change, AI produces a preview, also called a dry run. It shows which entries would be affected and the proposed values, including descriptions and the language used for text changes.

The preview does not save configuration or create a request. It helps make the intended effect visible, particularly when one request affects several entries.

If the requested change is revised, AI produces another preview. The data is not reserved between preview and save, so changes made elsewhere in SAP can still affect the final operation.

## Saving Changes

AI saves the approved change using the existing or new [Customizing request](transports.md) chosen in the conversation.

SAP applies its maintenance checks during the operation. A business rule, lock, or permission restriction can reject a change even after a successful preview. AI reports the SAP message rather than treating the preview as proof that the save must succeed.

Some changes continue running in SAP after the first response. AI can check their progress and report the final result without starting the change again.

## Saved Results

After the operation, AI reads the affected entries again. It can report the saved values, confirm fields that stayed unchanged, and identify any warning or incomplete result.

For a copy, this includes checking the new entries without altering the reference. For a deletion, it includes the entry and relevant descriptions. The Customizing request remains open; release and import are separate from the conversation's configuration change.

## Example Tasks

| Request in chat | What AI handles |
| --- | --- |
| "Explain this setting." | Finding it, reading the values, and explaining their meaning |
| "Create a new setting based on this reference." | Comparing existing data, showing the copy preview, and checking the saved entry |
| "Correct this description without changing the other values." | Reading the current entry, previewing the edit, and verifying what changed |
| "Add these storage locations." | Checking the supplied details, preparing the entries, and verifying each result |
| "Remove the temporary setting from this test." | Showing the affected entries and checking the approved deletion |

The action-specific differences are covered in [Create, copy, edit, and delete](changes.md).