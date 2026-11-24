# Customizing Updates

AI uses the Customizing tools with the SAP service installed for the feature. Some ABAP FS extension updates also require an update to that service. The user or SAP administrator performs the SAP update through **Customizing Setup**; it is not installed automatically by AI.

## How an Update Is Reported

When AI calls a Customizing tool, ABAP FS checks the required service in the selected SAP system. If it is unavailable or needs an update, the tool returns a message instead of proceeding with the requested operation. AI can then explain that setup needs attention and point to **ABAP FS > Customizing Setup**.

There is no need to know about the service's internal workings to use the feature. An update requirement becomes visible in the conversation when the tools are used.

The panel's **Check installation** action can also show that an update is needed. A version mismatch is different from a sign-in or permission problem. An unavailable service alone is not proof that the installation is absent.

The check is specific to the selected connection. A ready development system does not prove that a quality or production system has the same installation.

## Update Methods

The user or administrator updates the installation through the same **Customizing Setup** panel and methods used for the original setup. AI can explain which reported issue is preventing the tools from working.

| Method | How the update works |
| --- | --- |
| **Direct ADT deployment** | **Deploy objects & configure SICF** saves and activates the supplied version in the existing package, then configures its services |
| **abapGit offline ZIP** | **Save abapGit ZIP** provides the updated files for import into the existing offline repository; activation and service configuration complete that installation |

The supplied SAP objects form one versioned set. Readiness depends on both the installed objects and the services reporting the expected version. An older component left in place can leave the installation not ready even if the other components were updated.

An update uses the existing package and the normal installation approval and transport process. It does not move objects to another package or release the installation request automatically. The installation result and **Check installation** show whether the expected version is available.

## Waiting for the New Version

After service configuration, the panel can continue checking for up to two minutes while the updated version becomes available. This includes a service that is responding but still reports the old version.

The wait allows a newly activated version to become available. It does not deploy another version or repair a failed activation. An old-version result after the wait means that the service on the selected connection still reports a different version. The installation, activation, and service results help distinguish an unfinished update from a connection to another system.

## What an Update Changes

The update replaces the ABAP FS software supporting the feature. It is not a configuration change: existing business settings and Customizing requests are not removed or released by the update.

After setup reports ready, AI can use the updated tools. Work that was already running in SAP has its own result, which AI can check separately. The installation is intended to be updated when no configuration jobs are running.

[Troubleshooting](troubleshooting.md) explains old-version messages, unavailable services, and configuration results that remain unknown after a connection problem.