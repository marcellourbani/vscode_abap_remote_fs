# RAP Generator

RAP (RESTful ABAP Programming model) is SAP's modern framework for building OData services on S/4HANA. Building a RAP service manually requires creating many interdependent objects — CDS views, behavior definitions, service definitions, and bindings. The RAP Generator creates the entire stack from a single database table in one step.

## Requirements

- S/4HANA or BTP system with ADT RAP Generator API support
- The source database table must already exist on the system

## Open the RAP Generator

Three ways to open it:

- **Activity Bar** → ABAP FS icon → **RAP Generator** panel
- **Right-click** a database table in the editor → **Generate RAP Service**
- **Command Palette** (`Ctrl+Shift+P`) → `ABAP FS: Generate RAP Service`

## Generate a Service

1. Select your SAP system from the dropdown
2. Enter the source **database table name** — default artifact names are fetched automatically from SAP
3. Review and adjust the generated names (CDS view, behavior definition, service binding, etc.)
4. Set the **package** (leave `$TMP` for local objects; a transport request will be prompted for other packages)
5. Click **Preview** to see the full list of objects that will be created
6. Click **Generate** — all artifacts are created on the server in a single operation

After generation, the service binding opens automatically in the editor.

## Generated Artifacts

| Artifact | Purpose |
|----------|---------|
| CDS Interface View | Data model layer |
| CDS Projection View | Service projection / field selection |
| Behavior Definition | CRUD operations and validations |
| Behavior Implementation Class | ABAP class implementing the behavior |
| Service Definition | Exposes the CDS view as a service |
| Service Binding | Binds to OData V2 or V4 protocol |
| Draft Table | Created for managed scenarios with draft enabled |

## Publish and Test

After generating, the service must be **published** before it can be consumed.

- **Publish**: Click **Publish Service** in the panel, or use `ABAP FS: Publish Service Binding`
- **Test**: Click **Test Service** to open the OData URL in the browser — the extension detects whether the service is published and offers to publish it if not, then builds the correct V2/V4 URL with authentication parameters. Or use `ABAP FS: Test Service Binding`
