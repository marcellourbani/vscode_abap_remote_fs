# Customizing Setup and Installation

AI uses the Customizing tools through a small ABAP FS service installed in SAP. A user or SAP administrator performs this one-time setup through the **Customizing Setup** panel; AI can explain the result and provide guidance, but does not install the service itself.

Setup is optional. Without it, AI can still investigate and explain configuration through the older read-only method, but cannot edit configuration through that method.

## Requirements

- A connection to the intended SAP system and client.
- Approval to install the supplied SAP objects and enable their services.
- Appropriate development, transport, and service-administration permissions, or help from the responsible SAP administrator.
- A suitable existing SAP package and, for a transportable installation, an approved installation request.

The feature uses classic SAP maintenance. Availability depends on the SAP system and release. It is not a promise of support for every SAP product, configuration object, or cloud environment.

## The Customizing Setup Panel

**ABAP FS > Customizing Setup** contains the installation and readiness controls used by the person performing setup. Its selected system determines where installation takes place.

| Control | Purpose |
| --- | --- |
| **SAP system** | The connected system whose installation is being checked or changed |
| **Check installation** | A read-only check of installed objects, versions, and service access |
| **Deployment method** | Direct ADT deployment or an abapGit offline ZIP |
| **Existing SAP package** | The package that holds the installation objects |
| **Workbench request or task** | The request for a transportable installation; blank for local `$TMP` installation |
| **Deploy objects & configure SICF** | Direct installation or update, followed by service configuration |
| **Save abapGit ZIP** | A locally generated installation file for the abapGit method |
| **Configure SICF services** | Service configuration without redeploying the supplied objects |
| **Open installation & SICF guide** | The detailed installation guide, including administrator-level service setup |

**Check installation** uses the current SAP sign-in. It does not install anything or change configuration. A connection or sign-in failure can make an installed service appear unavailable.

## Installation Methods

Both methods install the same supplied version. The choice depends on the development and transport process used for the SAP system.

### Direct ADT Deployment

With **Direct ADT deployment**, the extension installs the supplied objects into the selected existing SAP package. **Deploy objects & configure SICF** saves and activates those objects, then configures their services. The progress notification and final result show whether the installation completed.

A transportable package requires an approved Workbench request or task. `$TMP` is available for local development without an installation request.

Existing objects remain in their current package. The deployment refuses an unrelated or unrecognised object with the same name rather than overwriting it as a new installation. Package moves are not part of this action.

### abapGit Offline ZIP

With **abapGit offline ZIP**, **Save abapGit ZIP** produces the supplied sources as an offline repository file. Import and activation then take place through the organisation's normal abapGit process. The package and installation request are part of that process.

ZIP import and service configuration are separate. After import, **Configure SICF services** in the panel configures the services using the installation package and request details. Manual service configuration is also described in the panel's installation guide.

The existing offline repository supports later updates. Saving or importing a ZIP does not, by itself, make the services available.

## Installation Requests and Configuration Requests

Installation changes SAP development objects and normally uses a **Workbench request**. Later business configuration changes use a **Customizing request** where the client requires recording. These are separate purposes and are not interchangeable.

The installation request does not choose the request that AI will use for later configuration work. That choice can be provided in the conversation, as described in [Customizing requests](transports.md).

## Readiness and Partial Setup

Ready means the required objects are active, their versions match the extension, and the services respond correctly through the selected connection. It does not grant permission to change every setting.

Service checks retry for up to two minutes when a service is unavailable or still reports an older version. The panel may therefore continue checking briefly after installation or activation finishes.

!!! warning "Setup is a real SAP change"
    Installation and service configuration can save changes before a later step fails or is cancelled. Cancellation does not undo completed work. A partially completed installation can therefore contain both successful and unfinished steps. No transport is released automatically.

The services use the connection's SAP identity and permissions. Setup does not replace the normal sign-in and secure-connection requirements.

The installation is specific to each SAP system. Access and client restrictions can also differ between clients within a system.

## Without the Optional Installation

Without the optional service, AI can use the general SAP tools for read-only investigation according to the connection's permissions. Any configuration edit then remains a separate user task in SPRO, SM30, or another supported SAP transaction. The new Customizing actions become available for use once their readiness check succeeds.

The next step after successful setup is [the Customizing workflow](workflow.md). For an older installation, see [updates](updates.md).