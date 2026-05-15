# Dependency Graph Visualizer

Visualize where any ABAP object is used across the system as an interactive, expandable graph.

## Opening the Graph

1. Open an ABAP file in the editor
2. *(Optional)* Place your cursor on a specific method or variable for symbol-level analysis
3. Right-click → **Visualize Dependency Graph**

For graphs with fewer than 100 nodes, the graph renders immediately. For larger graphs, adjust the filters first, then click **Build Graph**.

## Reading the Graph

| Color | Meaning |
|---|---|
| Red | Root object (your starting point) |
| Purple | Nodes you have expanded |
| Other colors | Auto-assigned per object type |

A **double border** on a node means it has more dependencies available to explore.

## Exploring Dependencies

- **Double-click a node** — opens the object in the editor at the exact usage location
- **Right-click a node** — shows a context menu with Open / Expand / Focus options
- **Right-click → Expand Dependencies** — fetches where that object is used and merges results into the graph
- **Hover** — shows object details: type, package, responsible developer, parent class (for methods)

You can expand nodes as many levels deep as needed. Use **Reset to Root** to restore the original graph and clear all expansions.

## Filtering

Use the filter panel to reduce large graphs to what matters:

- **Custom/Standard toggle** — show only Z\*/Y\* objects or only SAP standard objects
- **Object type** — show only CLAS, PROG, FUNC, etc.
- **Name pattern** — wildcards supported (e.g., `Z*MD*`)
- **Usage type** — filter by edge relationship type

Real-time counts show how many objects match each filter. Click **Reset Filters** to clear all.

## Layout Options

| Layout | Best for |
|---|---|
| **Cose** *(default)* | General use — physics-based clustering |
| **Concentric** | Seeing distance from root object |
| **Breadthfirst** | Tree-shaped dependency chains |
| **Circle** | Compact overview |
| **Grid** | Ordered comparison |

## Exporting

Click **Export SVG** to save the current graph as a static image file.

## Requirements

- An ABAP file open in the editor
- An active SAP connection
