# abapGit Integration

abapGit integration lets you manage Git version control for ABAP objects directly in VS Code, without leaving the editor.

## Opening the abapGit Panel

1. Click the **ABAP FS** icon in the Activity Bar (left sidebar).
2. Expand the **abapGit** section.

## Common Tasks

### Link an existing repository
1. In the abapGit panel, click **Link Repository**.
2. Enter the Git URL and select the SAP package to link.

### Create a new repository
1. Click **Create Repository**.
2. Provide the Git URL and target package.

### View staged/unstaged changes
The abapGit panel lists all changed ABAP objects. Each entry shows whether it is staged or unstaged.

### Stage and commit (Push)
1. Select objects to stage, or stage all changes.
2. Click **Push** — this commits and pushes to the remote Git repository.
3. Enter a commit message when prompted.

### Pull (update from Git)
1. Click **Pull** on the linked repository.
2. **Note:** Pull overwrites local ABAP objects with the version from Git. Unsaved local changes will be lost.

### Register with VS Code Source Control
Click **Register in VS Code SCM** to surface the repository in VS Code's built-in Source Control view (`Ctrl+Shift+G`), enabling diffs and history browsing alongside the ABAP FS panel.

### Unlink a repository
Click the **Unlink** icon next to the repository to remove the connection without deleting any code.

## Tips

- Use **Pull** to sync a fresh system with an existing codebase stored in Git.
- The abapGit panel respects the active SAP connection — switch connections in the ABAP FS panel first if you work with multiple systems.
