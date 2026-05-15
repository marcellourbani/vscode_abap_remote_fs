# Mermaid Diagram Creation

[Mermaid](https://mermaid.js.org/) is a text-based diagramming language that lets you describe diagrams as simple text — no drawing tools needed. ABAP FS can generate and display Mermaid diagrams directly in VS Code via Copilot chat.

## How to Create a Diagram

1. Open Copilot Chat (`Ctrl+Alt+I`).
2. Describe the diagram you want. Examples:
   - *"Create a flowchart showing the flow of method `PROCESS_DATA`"*
   - *"Generate a class diagram for `ZCL_MY_CLASS`"*
   - *"Show a sequence diagram for the BAPI call in `ZMY_PROGRAM`"*
3. The diagram renders in an interactive webview at 200% zoom.

## Working with the Diagram Viewer

| Action | How |
|--------|-----|
| Zoom in / out | Use the zoom controls in the webview (20% increments) |
| Save diagram | Click the save button in the webview |

## Supported Diagram Types

Flowchart · Sequence · Class · State · ER · User Journey · Gantt · Pie · Git Graph · Mind Map · Timeline · Sankey · XY Chart · Block · Packet

## Themes

`default` · `dark` · `forest` · `neutral`

Specify a theme in your prompt: *"Create a flowchart … using the dark theme"*
