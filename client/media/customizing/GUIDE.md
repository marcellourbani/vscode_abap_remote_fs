# ABAP FS Customizing setup

ABAP FS provides IMG discovery, configuration inspection, comparison and governed configuration changes. Use the existing embedded SAP GUI for manual SPRO/SM30 maintenance. This view installs the supporting backend; it is not a replacement for SPRO.

## Choose an installation method

Both methods install the same versioned ABAP sources. The download is generated locally and contains no connection details or credentials.

### Direct ADT deployment

1. Connect to the intended SAP system and choose it in **Customizing Setup**.
2. Click **Check installation**. Review every object and service result.
3. Select **Direct**, enter an existing package and Workbench request. For local development choose `$TMP` and leave the request empty.
4. Click **Deploy objects & configure SICF**. The extension creates missing objects, writes source, activates the payload, and automatically provisions the SICF services below. Existing installations must carry an ABAP FS version header before they may be updated.
5. Review the result and click **Check installation** again. If service setup needs to be rerun, use **Configure SICF services**, or follow the manual SICF procedure below.

Direct deployment requires repository development/transport authorizations. It is not transactional across objects: if a step fails, earlier objects can remain installed or inactive. Correct the reported error and rerun. No transport is released automatically. Do not use another installation's names or move existing objects to a different package implicitly.

### abapGit offline ZIP

1. Click **Save abapGit ZIP** and choose a local destination.
2. Open your organization's installed abapGit transaction/report in SAP. If abapGit is not installed, ask your SAP administrator to install the official abapGit standalone report using your organization's software approval procedure.
3. Create an **offline repository** in an appropriate package. Use a package dedicated to this payload, not a package containing unrelated objects.
4. Import the ZIP and review the repository changes. Pull/import and activate all objects; select a Workbench request for a transportable package.
5. Return to **Customizing Setup**, choose the connected system, and enter the same existing package and Workbench request/task used for installation (`$TMP` with a blank request for local development). These fields and **Configure SICF services** remain available with the abapGit method selected. Click that action to provision services after import, or use the manual SICF procedure below. Exporting/importing the ZIP does not itself provision services.
6. Review the result and click **Check installation**.

Use the same offline repository for upgrades. Review the new ZIP before importing. ABAP FS never silently upgrades an abapGit-managed installation.

## SICF services

### Automatic, user-triggered setup

**Deploy objects & configure SICF** includes service provisioning after direct deployment. **Configure SICF services** runs service provisioning separately without redeploying the backend payload, including after abapGit import. Select a currently connected system and supply the existing package and Workbench request/task before either action. The backend objects must be installed and active for service-only setup. Invalid fields or a disconnected selection are rejected; actions are disabled while setup is busy.

Automatic provisioning runs the generated setup report **`ZABAPFS_ICF_SETUP`** via **ABAP Unit**. Its installer test class is declared **`RISK LEVEL DANGEROUS`** and **`DURATION MEDIUM`**; it performs installation, not a harmless unit test. Despite that execution mechanism, this is a **real SAP mutation**, not a harmless test or a dry run. It is initiated explicitly by the user's setup action in this view; there is no AI deployment tool. It creates/configures and activates SICF services using the selected connection's SAP identity and authorizations. It does not change credentials or authentication settings, and it does not release transports. Repository development, SICF administration and transport authorizations are required according to local policy.

A cancellable VS Code progress notification covers deployment/provisioning. Cancellation is cooperative: it cannot undo completed SAP work or necessarily interrupt an in-flight SAP operation. Failure, disconnection or cancellation may leave objects or services partially configured. Inspect the reported result and current installation/SICF state before retrying; do not assume rollback. Correct the error, then rerun service setup or finish manually.

### Manual SICF option

Automatic provisioning is optional after abapGit import; administrators may configure services manually instead. It is also an alternative for repairing service setup after direct deployment. Under the appropriate virtual host, create these children of `/sap/bc`:

| Node           | HTTP handler class       |
| -------------- | ------------------------ |
| `zabapfs_cust` | `ZCL_ABAPFS_CUST_ENGINE` |
| `zabapfs_diag` | `ZCL_ABAPFS_DIAG`        |

Assign the package and transport according to local policy. Activate the nodes and verify their parent services are active. Retain authenticated logon; do not configure anonymous users. Do not weaken TLS or bypass authorizations to make a probe pass.

## Status and troubleshooting

- **Missing object**: import/deploy that object.
- **Inactive changes**: inspect them before deployment; another developer may be working on the installation.
- **Unversioned object**: investigate the name collision; ABAP FS will not overwrite it automatically.
- **Version mismatch**: install the matching payload using your chosen method.
- **Service inaccessible**: check SICF, handler, parent activation, authentication, and SAP authorizations. An HTTP error alone does not prove a node is missing.
- **Timeout during a write**: check the returned run ID/status and current configuration before retrying. A disconnected client does not imply rollback.

Installation uses a **Workbench request**. Configuration writes use their own **Customizing request** where recording applies. Never reuse one blindly for the other.

## Scope and compatibility

The engine uses classic SAP maintenance and background-job APIs and `/UI2/CL_JSON`. Availability and authorization vary by SAP release. This is not an ABAP Cloud implementation. Setup status shows errors rather than installing compatibility workarounds silently.

Configuration mutations default to dry run. Set `commit: true` deliberately to execute. The AI/MCP client owns tool-call approval; no additional VS Code approval is required for headless clients. All operations run with the selected connection's SAP identity and authorizations.

## Attribution

Adapted from abap-config-mcp, Copyright (c) 2026 Geert Steyaert, under the MIT License. See the accompanying LICENSE. ABAP FS uses its own object names, services and background-result storage areas so both installations can coexist.
