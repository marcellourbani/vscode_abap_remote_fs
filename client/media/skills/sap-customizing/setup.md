# Optional Customizing Setup

Read this guide after the readiness check, when the user has chosen help with setup or an update. Do not read the tools guide yet.

Your role is to explain the result and guide the user through the panel. The user performs the installation, update, and service configuration. The readiness check is the tool action you use to confirm completion.

## Explain the Choice

The new tools need an ABAP FS service in each SAP system where they are used. The existing SAP connection alone is not enough. Installing the service is optional; table-based investigation and normal SPRO/SM30 maintenance remain available without it.

Tell the user that setup is optional. Without it, you can investigate and explain settings through the read-only method, but cannot edit configuration through that method. If they change their mind about setup, return to the entry skill and follow their choice; do not keep asking.

- **Ready:** Continue with `tools.md`; do not ask for installation again.
- **Missing or older version:** Explain that the user needs to install or update the service before the new tools can be used.
- **Connection, sign-in, or permission error:** Ask the user to check access first. An unavailable service is not proof that its SAP objects are missing.
- **User declines setup:** Return to the entry skill and read `legacy.md` for read-only investigation.

Do not install, activate, create services, or change sign-in settings through general-purpose tools. Setup is handled by a person in the panel. Never ask for passwords or tokens in chat.

## Guide the User Through the Panel

1. Ask the user to open **ABAP FS > Customizing Setup** or run command **ABAP FS: Focus on Customizing Setup View** and select the intended connected SAP system.
2. Ask them to use **Check installation** and review any issues. Help explain the result they share.
3. Explain the two installation methods and let the user choose:
   - **Direct ADT deployment:** The user enters an existing SAP package and installation request where required, then selects **Deploy objects & configure SICF**.
   - **abapGit offline ZIP:** The user selects **Save abapGit ZIP**, imports and activates it through their approved abapGit process, then returns to the panel and selects **Configure SICF services**.
4. When they finish, ask them to use **Check installation** again. Explain any specific remaining issue.
5. Call `abapfs_check_customizing_setup` again for that same connection. Continue with `tools.md` only after `ready: true`.

For detailed service or administrator steps, ask the user to open **Open installation & SICF guide** in the panel. That button opens a guide for them; do not imply that you have opened or read it through the panel.

Installation may require help from a developer or SAP administrator. A transportable installation uses an approved package and a Workbench request. A local development installation can use `$TMP` with no installation request. These are setup choices, not the Customizing request used later for configuration changes.

Explain that setup changes SAP objects and will create and activate SICF services. Cancellation and errors do not undo work already completed. If setup fails, ask the user to review what completed before another attempt. Use the read-only readiness result to help explain any remaining issue. No transport is released automatically.

## Updates

An extension update may include a new version of the SAP service. The Customizing tools check the chosen system before working and report when its service is missing or incompatible. This does not trigger an automatic installation.

For an update, guide the user to use the same installation method and existing package. If they use abapGit, advise them to update the existing offline repository rather than create a second copy. Explain that they should update the complete supplied set of SAP objects together and avoid updating while configuration jobs are still running. These are user actions, not instructions to install or activate objects yourself.

After installation, the panel retries service checks for up to two minutes while a service is unavailable or still reports an older version. Explain that this wait does not install or update anything. If the old version remains, ask the user to check their activation result and selected system.

## Keep the Conversation Short

- Give only the setup steps needed for the reported problem.
- Do not paste SAP source, service definitions, or the whole installation guide unless requested.
- Do not keep polling while waiting for the user to finish setup. Check again when they report completion.
- After setup is confirmed, return to the original configuration task. Do not treat installation as permission to change business configuration.
- If setup is declined, use `legacy.md`; do not load `tools.md` just in case.