# Create, Copy, Edit, and Delete

ABAP FS lets AI create, copy, edit, and delete supported Customizing entries. The user describes the desired result; AI chooses the appropriate action, shows a preview, and checks the saved result after the approved change.

## Create New Entries

AI can create entries from details supplied in the conversation, without needing an existing entry to copy. For example: "Create these storage locations with the following codes and descriptions."

AI checks which identifying details are required and asks for anything missing. It handles SAP formats such as leading zeros and can prepare several entries together. A single create operation supports up to 1,000 entries.

Existing entries are normally left unchanged. Replacing complete entries is possible when specifically requested, but differs from editing selected fields: values omitted from a full replacement can be cleared.

## Copy Reference Entries

An existing entry can act as a reference. A request such as "Create a new entry from this one, but use this description" lets AI prepare the copy and the requested differences together.

The reference stays unchanged. Existing target entries are normally skipped rather than overwritten. If replacing existing values is intended, that can be included in the request and previewed separately.

Descriptions and translations are not automatically copied. AI can include a supported description change or edit it afterwards. A copy also does not automatically include every related configuration setting.

## Edit Selected Fields

AI can change particular values while retaining the rest of an existing entry. Examples include correcting a description or changing a status rule.

For example: "Change this entry's description to the new wording and leave its other values unchanged." AI reads the entry, shows the proposed edit, and verifies the result. A value can also be explicitly cleared when requested.

Changing an entry's identifying code is not an ordinary field edit. That may require a separate business change, including checks of anything that uses the old code.

## Delete Selected Entries

AI can remove selected entries, including temporary configuration created during a test. It shows the affected entries before the deletion because one request can match more than one entry.

After the approved deletion, AI checks that the entries and relevant descriptions are gone. A warning about remaining data means the cleanup is not fully confirmed.

Saved deletions are not undone by closing the conversation or VS Code. Recovery is a separate SAP action.

## Descriptions and Languages

AI can read and change supported descriptions even when SAP stores them separately from the other values. Their proposed wording appears in the preview.

Text changes use the SAP logon language shown in that preview. Asking for an explanation in another language does not change which SAP translation is edited. Other translations may need separate maintenance; changing one description does not update all languages.

## Settings That Need Different Handling

!!! warning "Different checks apply"
    Some advanced write modes bypass the normal SAP maintenance checks. AI should explain those differences and obtain explicit agreement before using such a mode; it is not an automatic workaround for a rejected change.

Some settings still need SPRO or a dedicated transaction. AI can investigate and explain the limitation without changing configuration. Normal SAP permissions and business approval still apply to every supported change.

The [transport guide](transports.md) describes using an existing request or asking for a new one. [Troubleshooting](troubleshooting.md) explains messages that may appear during a task.