# Transport Object Operations

Work with individual objects inside a transport request directly from the **Transports** view in the sidebar.

## Accessing Object Actions

Right-click any object listed under a transport request to see available actions.

## Available Actions

| Action | What it does |
|---|---|
| **Open** | Opens the object in the editor |
| **Diff with current version** | Shows a side-by-side diff between the transported version and the current active version |
| **Reveal in Explorer** | Navigates to the object in the ABAP file explorer |

## Adding Objects to a Transport

Objects are added to a transport automatically when you save changes to an ABAP object that is assigned to a transport request. You can also manually assign an object:

1. Right-click the object in the explorer
2. Select **Add to Transport**
3. Choose the target transport request from the list

## Removing Objects from a Transport

1. Open the **Transports** view
2. Expand the transport request
3. Right-click the object you want to remove
4. Select **Remove from Transport**

> **Note:** Removing an object from a transport does not revert its source code — it only unlinks the object from that transport request.
