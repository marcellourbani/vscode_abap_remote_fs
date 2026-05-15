# Object Property View

The Object Property View shows metadata and history for whichever ABAP object is currently open in the editor — similar to the Properties view in ABAP Development Tools (Eclipse).

## Opening the View

Click the ABAP FS icon in the **Activity Bar** (left sidebar), then select the **Object Property** panel. The view updates automatically as you switch between ABAP files.

## What It Shows

| Section | Details |
|---|---|
| **Object metadata** | Type, package, responsible user, creation date, object URI |
| **Lock status** | Whether the object is locked and by whom |
| **Transport history** | All transport requests that contain this object |
| **Revision history** | Each saved version — author, date, and transport number |

## Comparing Revisions

1. In the **Revision history** section, tick the checkboxes next to any two versions.
2. A side-by-side diff opens in the editor, showing exactly what changed between them.

## Performance Note

Property data is cached after the first load. If you switch back to an object you already viewed, the extension reuses the cached data instead of querying SAP again.
