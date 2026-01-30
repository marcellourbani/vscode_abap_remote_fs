/**
 * SAP Connection Manager
 * Modern webview-based connection management UI
 * 
 * Features:
 * - Add/Edit/Delete SAP system connections
 * - Export connections for sharing
 * - Save to user or workspace settings
 * - Handle all RemoteConfig fields including sapGui, atcapprover, etc.
 */

import * as vscode from 'vscode';
import { funWindow as window } from '../services/funMessenger';
import { RemoteConfig, GuiType, validateNewConfigId, formatKey } from '../config';
import { logCommands } from '../services/abapCopilotLogger';
import { logTelemetry } from '../services/telemetry';

interface ConnectionData extends RemoteConfig {
    // All fields from RemoteConfig are inherited
}

export class SapConnectionManager {
    private static currentPanel: SapConnectionManager | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        // Set the webview's initial html content
        this.update();

        // Listen for when the panel is disposed
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            message => {
                this.handleMessage(message);
            },
            null,
            this.disposables
        );
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.ViewColumn.One;

        // If we already have a panel, show it
        if (SapConnectionManager.currentPanel) {
            SapConnectionManager.currentPanel.panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel
        const panel = window.createWebviewPanel(
            'sapConnectionManager',
            'SAP Connection Manager',
            column,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(extensionUri, 'client', 'media'),
                    vscode.Uri.joinPath(extensionUri, 'client', 'dist', 'media')
                ],
                retainContextWhenHidden: true
            }
        );

        SapConnectionManager.currentPanel = new SapConnectionManager(panel, extensionUri);
    }

    private update() {
        const webview = this.panel.webview;
        this.panel.webview.html = this.getHtmlForWebview(webview);
    }

    private async handleMessage(message: any) {
        switch (message.type) {
            case 'ready':
                // Webview is ready, send initial data
                await this.sendConnectionsToWebview();
                break;

            case 'loadConnections':
                await this.sendConnectionsToWebview();
                break;

            case 'saveConnection':
                await this.saveConnection(message.connectionId, message.connection, message.target, message.isEdit);
                break;

            case 'deleteConnection':
                await this.deleteConnection(message.connectionId, message.target);
                break;

            case 'exportConnections':
                await this.exportConnections(message.target);
                break;

            case 'importFromJson':
                await this.importFromJson(message.jsonContent, message.target);
                break;

            case 'createCloudConnection':
                if (message.cloudType === 'serviceKey') {
                    await this.createCloudConnectionFromServiceKey(message.serviceKey, message.target);
                } else if (message.cloudType === 'endpoint') {
                    await this.createCloudConnectionFromEndpoint(message.endpoint, message.target);
                }
                break;
                
            case 'confirmDeleteConnection':
                await this.confirmDeleteConnection(message.connectionId, message.target);
                break;
                
            case 'confirmBulkDelete':
                await this.confirmBulkDelete(message.connectionNames, message.target);
                break;
                
            case 'requestBulkUsernameEdit':
                await this.requestBulkUsernameEdit(message.connectionNames, message.target);
                break;
                
            case 'bulkEditUsername':
                await this.bulkEditUsername(message.connectionNames, message.newUsername, message.target);
                break;
                
            case 'bulkDelete':
                await this.bulkDelete(message.connectionNames, message.target);
                break;
        }
    }

    private async sendConnectionsToWebview() {
        const config = vscode.workspace.getConfiguration('abapfs');
        const userRemotes = config.inspect('remote')?.globalValue as Record<string, any> || {};
        const workspaceRemotes = config.inspect('remote')?.workspaceValue as Record<string, any> || {};

        this.panel.webview.postMessage({
            type: 'connections',
            data: {
                user: userRemotes,
                workspace: workspaceRemotes
            }
        });
    }

    private async saveConnection(connectionId: string, connection: ConnectionData, target: 'user' | 'workspace', isEdit: boolean) {
        let backupRemotes: Record<string, RemoteConfig> | undefined;
        
        try {
            const configTarget = target === 'user' 
                ? vscode.ConfigurationTarget.Global 
                : vscode.ConfigurationTarget.Workspace;

            const config = vscode.workspace.getConfiguration('abapfs');
            const currentRemotes = target === 'user'
                ? (config.inspect('remote')?.globalValue as Record<string, RemoteConfig> || {})
                : (config.inspect('remote')?.workspaceValue as Record<string, RemoteConfig> || {});

            // Backup current state for rollback
            backupRemotes = { ...currentRemotes };

            // Validate connection ID for new connections
            if (!isEdit) {
                const validator = validateNewConfigId(configTarget);
                const validation = validator(connectionId);
                if (validation) {
                    this.panel.webview.postMessage({
                        type: 'formValidationError',
                        message: validation
                    });
                    return;
                }
            }

            // Clean up connection object - remove empty values
            const cleanConnection = this.cleanConnectionObject(connection);

            // Build updated remotes
            const updatedRemotes = {
                ...currentRemotes,
                [connectionId]: cleanConnection
            };

            // Validate JSON syntax by attempting to stringify/parse
            try {
                const jsonString = JSON.stringify(updatedRemotes);
                JSON.parse(jsonString); // Verify it's valid JSON
            } catch (jsonError) {
                throw new Error(`Invalid JSON structure: ${jsonError}`);
            }

            // Save connection
            await config.update('remote', updatedRemotes, configTarget);

            // Verify the save was successful by reading it back
            const verifyConfig = vscode.workspace.getConfiguration('abapfs');
            const savedRemotes = target === 'user'
                ? (verifyConfig.inspect('remote')?.globalValue as Record<string, RemoteConfig> || {})
                : (verifyConfig.inspect('remote')?.workspaceValue as Record<string, RemoteConfig> || {});

            if (!savedRemotes[connectionId]) {
                throw new Error('Verification failed: Connection not found after save');
            }

            // Note: Password is NOT stored in settings for security
            // It will be requested on first connection and stored in OS credential manager

            this.panel.webview.postMessage({
                type: 'success',
                message: `Connection "${connectionId}" saved successfully`
            });

            logTelemetry('command_connection_manager_save_called');

            // Refresh connections in webview
            await this.sendConnectionsToWebview();

        } catch (error) {
            logCommands.error(`Error saving connection: ${error}`);
            
            // Rollback changes if backup exists
            if (backupRemotes) {
                try {
                    const configTarget = target === 'user' 
                        ? vscode.ConfigurationTarget.Global 
                        : vscode.ConfigurationTarget.Workspace;
                    const config = vscode.workspace.getConfiguration('abapfs');
                    await config.update('remote', backupRemotes, configTarget);
                    logCommands.info('Rolled back changes due to error');
                } catch (rollbackError) {
                    logCommands.error(`Failed to rollback changes: ${rollbackError}`);
                }
            }

            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to save connection: ${error}. Changes have been reverted.`
            });
        }
    }

    private cleanConnectionObject(connection: ConnectionData): RemoteConfig {
        const cleaned: any = {
            url: connection.url,
            username: connection.username,
            password: "", // Empty string - actual password stored in OS credential manager only
            client: connection.client,
            language: connection.language || 'en',
            allowSelfSigned: connection.allowSelfSigned || false,
            diff_formatter: connection.diff_formatter || 'ADT formatter'
        };

        // IMPORTANT: Password field must be present but empty - actual password stored in OS credential manager

        // Add optional fields only if they have values
        if (connection.atcapprover) cleaned.atcapprover = connection.atcapprover;
        if (connection.atcVariant) cleaned.atcVariant = connection.atcVariant;
        if (connection.maxDebugThreads) cleaned.maxDebugThreads = connection.maxDebugThreads;
        if (connection.customCA) cleaned.customCA = connection.customCA;

        // Handle sapGui configuration
        if (connection.sapGui && this.hasSapGuiValues(connection.sapGui)) {
            cleaned.sapGui = {
                disabled: connection.sapGui.disabled || false,
                guiType: connection.sapGui.guiType || 'SAPGUI'
            };

            // Add optional sapGui fields
            if (connection.sapGui.server) cleaned.sapGui.server = connection.sapGui.server;
            if (connection.sapGui.systemNumber) cleaned.sapGui.systemNumber = connection.sapGui.systemNumber;
            if (connection.sapGui.routerString) cleaned.sapGui.routerString = connection.sapGui.routerString;
            if (connection.sapGui.messageServer) cleaned.sapGui.messageServer = connection.sapGui.messageServer;
            if (connection.sapGui.messageServerPort) cleaned.sapGui.messageServerPort = connection.sapGui.messageServerPort;
            if (connection.sapGui.group) cleaned.sapGui.group = connection.sapGui.group;
            if (connection.sapGui.browserPath) cleaned.sapGui.browserPath = connection.sapGui.browserPath;
        }

        // Handle OAuth if present
        if (connection.oauth) {
            cleaned.oauth = connection.oauth;
        }

        // Cast to RemoteConfig - password field will be populated from credential manager at runtime
        return cleaned as RemoteConfig;
    }

    private hasSapGuiValues(sapGui: any): boolean {
        return !!(
            sapGui.server || 
            sapGui.systemNumber || 
            sapGui.messageServer || 
            sapGui.messageServerPort || 
            sapGui.group || 
            sapGui.routerString ||
            sapGui.browserPath ||
            sapGui.guiType !== 'SAPGUI'
        );
    }

    private async deleteConnection(connectionId: string, target: 'user' | 'workspace') {
        let backupRemotes: Record<string, RemoteConfig> | undefined;
        
        try {
            const configTarget = target === 'user' 
                ? vscode.ConfigurationTarget.Global 
                : vscode.ConfigurationTarget.Workspace;

            const config = vscode.workspace.getConfiguration('abapfs');
            const currentRemotes = target === 'user'
                ? (config.inspect('remote')?.globalValue as Record<string, RemoteConfig> || {})
                : (config.inspect('remote')?.workspaceValue as Record<string, RemoteConfig> || {});

            // Backup current state for rollback
            backupRemotes = { ...currentRemotes };

            // Remove the connection
            const { [connectionId]: removed, ...remaining } = currentRemotes;

            // Validate JSON syntax
            try {
                const jsonString = JSON.stringify(remaining);
                JSON.parse(jsonString);
            } catch (jsonError) {
                throw new Error(`Invalid JSON structure: ${jsonError}`);
            }

            await config.update('remote', remaining, configTarget);

            // Verify deletion
            const verifyConfig = vscode.workspace.getConfiguration('abapfs');
            const savedRemotes = target === 'user'
                ? (verifyConfig.inspect('remote')?.globalValue as Record<string, RemoteConfig> || {})
                : (verifyConfig.inspect('remote')?.workspaceValue as Record<string, RemoteConfig> || {});

            if (savedRemotes[connectionId]) {
                throw new Error('Verification failed: Connection still exists after deletion');
            }

            // Clear password from secure storage
            const { PasswordVault } = await import('../lib');
            const vault = PasswordVault.get();
            if (removed) {
                await vault.deletePassword(
                    `vscode.abapfs.${formatKey(connectionId)}`,
                    removed.username
                );
            }

            this.panel.webview.postMessage({
                type: 'success',
                message: `Connection "${connectionId}" deleted successfully`
            });

            logTelemetry('command_connection_manager_delete_called');

            // Refresh connections in webview
            await this.sendConnectionsToWebview();

        } catch (error) {
            logCommands.error(`Error deleting connection: ${error}`);
            
            // Rollback changes if backup exists
            if (backupRemotes) {
                try {
                    const configTarget = target === 'user' 
                        ? vscode.ConfigurationTarget.Global 
                        : vscode.ConfigurationTarget.Workspace;
                    const config = vscode.workspace.getConfiguration('abapfs');
                    await config.update('remote', backupRemotes, configTarget);
                    logCommands.info('Rolled back deletion due to error');
                } catch (rollbackError) {
                    logCommands.error(`Failed to rollback deletion: ${rollbackError}`);
                }
            }

            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to delete connection: ${error}. Changes have been reverted.`
            });
        }
    }

    private async createCloudConnectionFromServiceKey(serviceKeyJson: string, target: 'user' | 'workspace') {
        try {
            // Parse service key
            const serviceKey = JSON.parse(serviceKeyJson);
            
            // Validate it's an ABAP service key
            const { isAbapServiceKey } = await import('abap_cloud_platform');
            if (!isAbapServiceKey(serviceKey)) {
                throw new Error('Invalid ABAP service key format');
            }

            // Extract connection details from service key
            const { url, uaa: { clientid, clientsecret, url: loginUrl } } = serviceKey;
            
            // Get system info to determine name
            const { cfCodeGrant, getAbapSystemInfo, getAbapUserInfo, loginServer } = await import('abap_cloud_platform');
            const server = loginServer();
            const grant = await cfCodeGrant(loginUrl, clientid, clientsecret, server);
            const user = await getAbapUserInfo(url, grant.accessToken);
            const info = await getAbapSystemInfo(url, grant.accessToken);
            server.server.close();

            // Create connection configuration (password not included - stored in credential manager only)
            const connection: any = {
                name: info.SYSID,
                url,
                username: user.UNAME,
                language: 'en',
                client: user.MANDT,
                allowSelfSigned: false,
                diff_formatter: 'ADT formatter',
                oauth: {
                    clientId: clientid,
                    clientSecret: clientsecret,
                    loginUrl,
                    saveCredentials: true
                }
            };

            // Send to webview for user to review/edit before saving
            this.panel.webview.postMessage({
                type: 'cloudConnectionCreated',
                connection: connection,
                availableLanguages: info.INSTALLED_LANGUAGES.map((l: any) => l.ISOLANG?.toLowerCase() || 'en')
            });

            logTelemetry('command_connection_manager_cloud_connection_created');

        } catch (error) {
            logCommands.error(`Error creating cloud connection from service key: ${error}`);
            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to create cloud connection: ${error}`
            });
        }
    }

    private async createCloudConnectionFromEndpoint(endpoint: string, target: 'user' | 'workspace') {
        try {
            // This will guide the user through the Cloud Foundry login flow
            const vscode = await import('vscode');
            
            // Import cloud platform utilities
            const { cfInfo, cfPasswordGrant, cfOrganizations, cfSpaces, cfServices, cfServiceInstances, 
                    cfInstanceServiceKeys, getAbapSystemInfo, getAbapUserInfo } = await import('abap_cloud_platform');
            
            // Get CF info
            const info = await cfInfo(endpoint);
            const loginUrl = info.links.login?.href;
            if (!loginUrl) {
                throw new Error('Could not determine login URL from endpoint');
            }

            // Get username and password from user
            const username = await window.showInputBox({
                prompt: 'Enter Cloud Foundry username',
                ignoreFocusOut: true
            });
            if (!username) return;

            const password = await window.showInputBox({
                prompt: 'Enter Cloud Foundry password',
                password: true,
                ignoreFocusOut: true
            });
            if (!password) return;

            // Login
            const grant = await cfPasswordGrant(loginUrl, username, password);
            
            // Get org
            const orgs = await cfOrganizations(endpoint, grant.accessToken);
            if (orgs.length === 0) {
                throw new Error('No organizations found');
            }
            
            const orgItems = orgs.map(o => ({ label: o.entity.name, org: o }));
            const selectedOrg = await window.showQuickPick(orgItems, {
                placeHolder: 'Select Cloud Foundry organization'
            });
            if (!selectedOrg) return;

            // Get space
            const spaces = await cfSpaces(endpoint, selectedOrg.org.entity, grant.accessToken);
            if (spaces.length === 0) {
                throw new Error('No spaces found');
            }
            
            const spaceItems = spaces.map(s => ({ label: s.entity.name, space: s }));
            const selectedSpace = await window.showQuickPick(spaceItems, {
                placeHolder: 'Select Cloud Foundry space'
            });
            if (!selectedSpace) return;

            // Get services and instances to find ABAP service
            const services = await cfServices(endpoint, grant.accessToken);
            const instances = await cfServiceInstances(endpoint, selectedSpace.space.entity, grant.accessToken);
            
            // Find ABAP service by tag
            const abapService = services.find(s => s.entity.tags && s.entity.tags.includes('abapcp'));
            if (!abapService) {
                throw new Error('No ABAP service found in this space');
            }

            // Find instance matching ABAP service
            const abapInstance = instances.find(i => i.entity.service_guid === abapService.metadata.guid);
            if (!abapInstance) {
                throw new Error('No ABAP service instance found');
            }

            // Get service keys
            const keys = await cfInstanceServiceKeys(endpoint, abapInstance.entity, grant.accessToken);
            if (keys.length === 0) {
                throw new Error('No service keys found for this instance');
            }

            // Filter for keys with valid names and credentials
            const validKeys = keys.filter(k => k.entity && typeof (k.entity as any).name === 'string');
            if (validKeys.length === 0) {
                throw new Error('No valid service keys found');
            }

            const keyItems = validKeys.map(k => ({ 
                label: (k.entity as any).name, 
                key: k 
            }));
            const selectedKey = await window.showQuickPick(keyItems, {
                placeHolder: 'Select service key'
            });
            if (!selectedKey) return;

            // Extract credentials from the selected key
            const credentials = (selectedKey.key.entity as any).credentials;
            if (!credentials) {
                throw new Error('Selected key has no credentials');
            }

            // Now use the credentials to create connection
            await this.createCloudConnectionFromServiceKey(JSON.stringify(credentials), target);

        } catch (error) {
            logCommands.error(`Error creating cloud connection from endpoint: ${error}`);
            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to create cloud connection: ${error}`
            });
        }
    }

    private async exportConnections(target: 'user' | 'workspace') {
        try {
            const config = vscode.workspace.getConfiguration('abapfs');
            const rawConnections = target === 'user'
                ? (config.inspect('remote')?.globalValue || {}) as Record<string, any>
                : (config.inspect('remote')?.workspaceValue || {}) as Record<string, any>;

            // Sanitize connections for export - clear username and password values but keep fields.
            const sanitizedConnections: Record<string, any> = {};
            for (const [name, conn] of Object.entries(rawConnections)) {
                sanitizedConnections[name] = {
                    ...conn,
                    username: "",  // Clear value but keep field for import compatibility
                    password: ""   // Clear value but keep field for import compatibility
                };
            }

            const json = JSON.stringify(sanitizedConnections, null, 2);

            // Prompt user to save file
            const uri = await window.showSaveDialog({
                defaultUri: vscode.Uri.file(`abap-connections-${target}.json`),
                filters: {
                    'JSON files': ['json'],
                    'All files': ['*']
                }
            });

            if (!uri) {
                return; // User cancelled
            }

            // Write to file
            await vscode.workspace.fs.writeFile(uri, Buffer.from(json, 'utf8'));

            this.panel.webview.postMessage({
                type: 'success',
                message: `Connections exported (no passwords)`
            });

            logTelemetry('command_connection_manager_export_called');

        } catch (error) {
            logCommands.error(`Error exporting connections: ${error}`);
            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to export connections: ${error}`
            });
        }
    }

    private async importFromJson(jsonContent: string, target: 'user' | 'workspace') {
        try {
            const connections = JSON.parse(jsonContent);

            const configTarget = target === 'user' 
                ? vscode.ConfigurationTarget.Global 
                : vscode.ConfigurationTarget.Workspace;

            const config = vscode.workspace.getConfiguration('abapfs');
            const currentRemotes = target === 'user'
                ? (config.inspect('remote')?.globalValue as Record<string, RemoteConfig> || {})
                : (config.inspect('remote')?.workspaceValue as Record<string, RemoteConfig> || {});

            // Merge imported connections with existing
            const merged = { ...currentRemotes, ...connections };

            await config.update('remote', merged, configTarget);

            this.panel.webview.postMessage({
                type: 'success',
                message: `Imported ${Object.keys(connections).length} connection(s) successfully`
            });

            logTelemetry('command_connection_manager_import_json_called');

            // Refresh connections in webview
            await this.sendConnectionsToWebview();

        } catch (error) {
            logCommands.error(`Error importing JSON: ${error}`);
            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to import JSON: ${error}`
            });
        }
    }

    private async confirmDeleteConnection(connectionId: string, target: 'user' | 'workspace') {
        const result = await window.showWarningMessage(
            `Delete connection "${connectionId}"?`,
            { modal: true },
            'Delete'
        );
        
        if (result === 'Delete') {
            await this.deleteConnection(connectionId, target);
        }
    }

    private async confirmBulkDelete(connectionNames: string[], target: 'user' | 'workspace') {
        const result = await window.showWarningMessage(
            `Delete ${connectionNames.length} connection(s)? This cannot be undone.`,
            { modal: true },
            'Delete All'
        );
        
        if (result === 'Delete All') {
            await this.bulkDelete(connectionNames, target);
        }
    }

    private async requestBulkUsernameEdit(connectionNames: string[], target: 'user' | 'workspace') {
        const newUsername = await window.showInputBox({
            prompt: `Enter new username for ${connectionNames.length} connection(s)`,
            placeHolder: 'username',
            ignoreFocusOut: true
        });
        
        if (newUsername) {
            await this.bulkEditUsername(connectionNames, newUsername, target);
        }
    }

    private async bulkEditUsername(connectionNames: string[], newUsername: string, target: 'user' | 'workspace') {
        try {
            const configTarget = target === 'user' 
                ? vscode.ConfigurationTarget.Global 
                : vscode.ConfigurationTarget.Workspace;

            const config = vscode.workspace.getConfiguration('abapfs');
            const currentRemotes = target === 'user'
                ? (config.inspect('remote')?.globalValue as Record<string, RemoteConfig> || {})
                : (config.inspect('remote')?.workspaceValue as Record<string, RemoteConfig> || {});

            // Update usernames for selected connections
            const updatedRemotes = { ...currentRemotes };
            connectionNames.forEach(name => {
                if (updatedRemotes[name]) {
                    updatedRemotes[name] = {
                        ...updatedRemotes[name],
                        username: newUsername
                    };
                }
            });

            await config.update('remote', updatedRemotes, configTarget);

            this.panel.webview.postMessage({
                type: 'success',
                message: `Updated username for ${connectionNames.length} connection(s)`
            });

            // Refresh connections in webview
            await this.sendConnectionsToWebview();

        } catch (error) {
            logCommands.error(`Error in bulk edit username: ${error}`);
            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to update usernames: ${error}`
            });
        }
    }

    private async bulkDelete(connectionNames: string[], target: 'user' | 'workspace') {
        try {
            const configTarget = target === 'user' 
                ? vscode.ConfigurationTarget.Global 
                : vscode.ConfigurationTarget.Workspace;

            const config = vscode.workspace.getConfiguration('abapfs');
            const currentRemotes = target === 'user'
                ? (config.inspect('remote')?.globalValue as Record<string, RemoteConfig> || {})
                : (config.inspect('remote')?.workspaceValue as Record<string, RemoteConfig> || {});

            // Remove selected connections
            const updatedRemotes = { ...currentRemotes };
            connectionNames.forEach(name => {
                delete updatedRemotes[name];
            });

            await config.update('remote', updatedRemotes, configTarget);

            // Clear passwords from secure storage
            const { PasswordVault } = await import('../lib');
            const vault = PasswordVault.get();
            for (const name of connectionNames) {
                const conn = currentRemotes[name];
                if (conn) {
                    await vault.deletePassword(
                        `vscode.abapfs.${formatKey(name)}`,
                        conn.username
                    );
                }
            }

            this.panel.webview.postMessage({
                type: 'success',
                message: `Deleted ${connectionNames.length} connection(s)`
            });

            // Refresh connections in webview
            await this.sendConnectionsToWebview();

        } catch (error) {
            logCommands.error(`Error in bulk delete: ${error}`);
            this.panel.webview.postMessage({
                type: 'error',
                message: `Failed to delete connections: ${error}`
            });
        }
    }

    private getHtmlForWebview(webview: vscode.Webview) {
        const nonce = getNonce();

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; ">            <title>SAP Connection Manager</title>
            <style nonce="${nonce}">
                ${this.getStyles()}
            </style>
        </head>
        <body>
            <div class="container">
                <header>
                    <h1>SAP Connection Manager</h1>
                    <div class="header-actions">
                        <div id="bulkActions" style="display: none; gap: 10px;">
                            <button id="bulkEditUsernameBtn" class="btn btn-secondary">✏️ Change Username</button>
                            <button id="bulkDeleteBtn" class="btn btn-danger">🗑️ Delete Selected</button>
                        </div>
                        <button id="addCloudBtn" class="btn btn-secondary">☁️ Add Cloud Connection</button>
                        <button id="exportBtn" class="btn btn-secondary">📤 Export Connections</button>
                        <button id="importJsonBtn" class="btn btn-secondary">📥 Import from JSON</button>
                        <button id="addBtn" class="btn btn-primary">➕ Add Application Server</button>
                    </div>
                </header>

                <div class="target-selector">
                    <label>
                        <input type="radio" name="target" value="user" checked>
                        User Settings (Global)
                    </label>
                    <label>
                        <input type="radio" name="target" value="workspace">
                        Workspace Settings
                    </label>
                </div>

                <div id="connectionsList" class="connections-list">
                    <!-- Connections will be populated here -->
                </div>

                <!-- Connection Editor Modal -->
                <div id="editorModal" class="modal" style="display: none;">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h2 id="modalTitle">Add New Connection</h2>
                            <button class="close-btn" id="closeEditorBtn">✕</button>
                        </div>
                        <form id="connectionForm">
                            ${this.getFormHtml()}
                        </form>
                    </div>
                </div>

                <!-- Cloud Connection Modal -->
                <div id="cloudModal" class="modal" style="display: none;">
                    <div class="modal-content" style="max-width: 700px;">
                        <div class="modal-header">
                            <h2 id="cloudModalTitle">Add Cloud Connection</h2>
                            <button class="close-btn" id="closeCloudBtn">✕</button>
                        </div>
                        <div style="padding: 20px;">
                            <div style="margin-bottom: 20px;">
                                <label style="font-weight: 600; margin-bottom: 8px; display: block;">Select Cloud Type:</label>
                                <select id="cloudTypeSelect" style="width: 100%; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border)); font-size: 14px;">
                                    <option value="LOADKEY">Load service key from file</option>
                                    <option value="EU10">Cloud instance - Europe trial (eu10)</option>
                                    <option value="US10">Cloud instance - USA trial (us10)</option>
                                    <option value="MANUAL">Cloud instance - enter connection endpoint</option>
                                </select>
                            </div>
                            
                            <!-- Service Key Section -->
                            <div id="serviceKeySection" style="display: none;">
                                <p style="margin-bottom: 8px; font-weight: 500;">Paste your ABAP Cloud service key JSON:</p>
                                <textarea id="serviceKeyInput" style="width: 100%; min-height: 200px; padding: 10px; font-family: 'Consolas', 'Courier New', monospace; font-size: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border)); border-radius: 4px;"></textarea>
                            </div>
                            
                            <!-- Manual Endpoint Section -->
                            <div id="manualEndpointSection" style="display: none;">
                                <label style="font-weight: 500; margin-bottom: 8px; display: block;">Cloud Foundry API Endpoint:</label>
                                <input type="text" id="manualEndpointInput" placeholder="https://api.cf.region.hana.ondemand.com" style="width: 100%; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border)); border-radius: 4px;">
                            </div>
                            
                            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px;">
                                <button class="btn btn-secondary" id="cancelCloudBtn">Cancel</button>
                                <button class="btn btn-primary" id="processCloudBtn">Continue</button>
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Import JSON Modal -->
                <input type="file" id="jsonFileInput" accept=".json" style="display: none;">
            </div>

            <script nonce="${nonce}">
                ${this.getScript()}
            </script>
        </body>
        </html>`;
    }

    private getStyles() {
        return `
            * {
                box-sizing: border-box;
                margin: 0;
                padding: 0;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                padding: 20px;
                color: var(--vscode-foreground);
                background: var(--vscode-editor-background);
            }

            .container {
                max-width: 1400px;
                margin: 0 auto;
            }

            header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 20px;
                padding-bottom: 15px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }

            h1 {
                font-size: 24px;
                font-weight: 600;
            }

            .header-actions {
                display: flex;
                gap: 10px;
            }

            .btn {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s;
            }

            .btn-primary {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
            }

            .btn-primary:hover {
                background: var(--vscode-button-hoverBackground);
            }

            .btn-secondary {
                background: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }

            .btn-secondary:hover {
                background: var(--vscode-button-secondaryHoverBackground);
            }

            .btn-danger {
                background: #d73a49;
                color: white;
            }

            .btn-danger:hover {
                background: #cb2431;
            }

            .btn-small {
                padding: 4px 12px;
                font-size: 12px;
            }

            .target-selector {
                margin-bottom: 20px;
                padding: 12px;
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 4px;
                display: flex;
                gap: 20px;
            }

            .target-selector label {
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
                font-weight: 500;
            }

            .connections-list {
                overflow-x: auto;
            }

            table {
                width: 100%;
                border-collapse: collapse;
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
            }

            thead {
                background: var(--vscode-editor-background);
                position: sticky;
                top: 0;
                z-index: 10;
            }

            th {
                padding: 12px 8px;
                text-align: left;
                font-weight: 600;
                border-bottom: 2px solid var(--vscode-panel-border);
                font-size: 12px;
                color: var(--vscode-foreground);
                white-space: nowrap;
            }

            td {
                padding: 10px 8px;
                border-bottom: 1px solid var(--vscode-panel-border);
                font-size: 12px;
                vertical-align: middle;
            }

            tbody tr:hover {
                background: var(--vscode-list-hoverBackground);
            }

            .connection-name {
                font-weight: 600;
                color: var(--vscode-textLink-foreground);
            }

            .connection-actions {
                display: flex;
                gap: 4px;
                white-space: nowrap;
            }

            .default-value {
                color: var(--vscode-descriptionForeground);
                font-style: italic;
            }

            .gui-badge {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 10px;
                font-size: 10px;
                font-weight: 600;
                background: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                white-space: nowrap;
            }

            .modal {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.7);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }

            .modal-content {
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                width: 90%;
                max-width: 900px;
                max-height: 90vh;
                overflow-y: auto;
            }

            .modal-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }

            .modal-header h2 {
                font-size: 20px;
                font-weight: 600;
            }

            .close-btn {
                background: none;
                border: none;
                font-size: 24px;
                cursor: pointer;
                color: var(--vscode-foreground);
                padding: 0;
                width: 30px;
                height: 30px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
            }

            .close-btn:hover {
                background: var(--vscode-toolbar-hoverBackground);
            }

            form {
                padding: 20px;
            }

            .form-section {
                margin-bottom: 24px;
                padding-bottom: 24px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }

            .form-section:last-of-type {
                border-bottom: none;
            }

            .form-section h3 {
                font-size: 16px;
                margin-bottom: 16px;
                color: var(--vscode-textLink-foreground);
            }

            .form-row {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                gap: 16px;
                margin-bottom: 16px;
            }

            .form-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .form-group label {
                font-size: 13px;
                font-weight: 500;
                color: var(--vscode-foreground);
            }

            .form-group input,
            .form-group select {
                padding: 8px 12px;
                border: 1px solid var(--vscode-input-border, var(--vscode-editorWidget-border));
                border-radius: 4px;
                background: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                font-size: 13px;
            }

            .form-group input:focus,
            .form-group select:focus {
                outline: none;
                border-color: var(--vscode-focusBorder);
                border-width: 2px;
            }

            .form-group input[type="checkbox"] {
                width: auto;
                margin-right: 8px;
            }

            .checkbox-group {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 8px 0;
            }

            .help-text {
                font-size: 12px;
                color: var(--vscode-descriptionForeground);
                margin-top: 4px;
            }

            .form-actions {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding-top: 20px;
                border-top: 1px solid var(--vscode-panel-border);
            }

            .empty-state {
                text-align: center;
                padding: 60px 20px;
                color: var(--vscode-descriptionForeground);
            }

            .empty-state-icon {
                font-size: 48px;
                margin-bottom: 16px;
            }

            .message {
                padding: 12px 16px;
                border-radius: 4px;
                margin-bottom: 16px;
                display: flex;
                align-items: center;
                gap: 12px;
            }

            .message-success {
                background: rgba(40, 167, 69, 0.1);
                border: 1px solid rgba(40, 167, 69, 0.3);
                color: #28a745;
            }

            .message-error {
                background: rgba(220, 53, 69, 0.1);
                border: 1px solid rgba(220, 53, 69, 0.3);
                color: #dc3545;
            }

            .conditional-field {
                display: none;
            }

            .conditional-field.show {
                display: block;
            }
        `;
    }

    private getFormHtml() {
        return `
            <div id="formError" style="display: none; padding: 12px; margin-bottom: 16px; background: rgba(220, 53, 69, 0.1); border: 1px solid rgba(220, 53, 69, 0.3); color: #dc3545; border-radius: 4px;"></div>
            
            <div class="form-section">
                <h3>Basic Configuration</h3>
                <div class="form-row">
                    <div class="form-group">
                        <label for="name">Connection Name *</label>
                        <input type="text" id="name" name="name" required>
                        <div class="help-text">Unique identifier for this connection</div>
                    </div>
                    <div class="form-group">
                        <label for="url">Server URL (ADT URL) *</label>
                        <input type="text" id="url" name="url" required placeholder="https://server:44300">
                        <div class="help-text">Contact your Basis team for this URL. Format: http(s)://domain[:port] (e.g., https://myserver.com:44311)</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="username">Username *</label>
                        <input type="text" id="username" name="username" required>
                        <div class="help-text">Password will be requested on first connection and stored securely in OS credential manager</div>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="client">Client *</label>
                        <input type="text" id="client" name="client" required pattern="[0-9]{3}" maxlength="3" minlength="3" placeholder="100">
                        <div class="help-text">3 digit number from 000 to 999</div>
                    </div>
                    <div class="form-group">
                        <label for="language">Language *</label>
                        <input type="text" id="language" name="language" required pattern="[a-z]{2}" maxlength="2" minlength="2" value="en" style="text-transform: lowercase;">
                        <div class="help-text">2 lowercase letters (e.g., en, de, fr)</div>
                    </div>
                </div>
            </div>

            <div class="form-section">
                <h3>Additional Options</h3>
                <div class="form-row">
                    <div class="form-group">
                        <label for="diff_formatter">Diff Formatter</label>
                        <select id="diff_formatter" name="diff_formatter">
                            <option value="ADT formatter">ADT formatter</option>
                            <option value="AbapLint">AbapLint</option>
                            <option value="simple">Simple</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="maxDebugThreads">Max Debug Threads</label>
                        <input type="number" id="maxDebugThreads" name="maxDebugThreads" min="1" max="20" value="4">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label for="atcapprover">ATC Approver</label>
                        <input type="text" id="atcapprover" name="atcapprover" placeholder="Optional">
                    </div>
                    <div class="form-group">
                        <label for="atcVariant">ATC Variant</label>
                        <input type="text" id="atcVariant" name="atcVariant" placeholder="Optional">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group checkbox-group">
                        <input type="checkbox" id="allowSelfSigned" name="allowSelfSigned">
                        <label for="allowSelfSigned">Allow Self-Signed Certificates</label>
                    </div>
                </div>
                <div class="form-row conditional-field" id="customCAField">
                    <div class="form-group">
                        <label for="customCA">Custom CA Certificate Path</label>
                        <input type="text" id="customCA" name="customCA" placeholder="/path/to/ca.pem">
                        <div class="help-text">Path to custom certificate authority file</div>
                    </div>
                </div>
            </div>

            <div class="form-section">
                <h3>SAP GUI Integration</h3>
                <div class="form-row">
                    <div class="form-group checkbox-group">
                        <input type="checkbox" id="sapGui_enabled" name="sapGui.enabled">
                        <label for="sapGui_enabled">Enable SAP GUI Integration</label>
                    </div>
                </div>
                <div id="sapGuiFields" class="conditional-field">
                <div class="form-row">
                    <div class="form-group">
                        <label for="sapGui_guiType">GUI Type</label>
                        <select id="sapGui_guiType" name="sapGui.guiType">
                            <option value="WEBGUI_UNSAFE_EMBEDDED">SAP GUI for HTML (Embedded)</option>
                            <option value="SAPGUI">Native SAP GUI</option>
                            <option value="WEBGUI_CONTROLLED">SAP GUI for HTML (Controlled)</option>
                        </select>
                        <div class="help-text">Embedded works in VS Code; Native requires SAP GUI installed; Controlled opens in browser</div>
                    </div>
                    <div class="form-group">
                        <label for="sapGui_connectionType">Connection Type</label>
                        <select id="sapGui_connectionType" name="sapGui.connectionType">
                            <option value="DIRECT">Direct Application Server</option>
                            <option value="LOADBALANCING">Load Balancing (Group/Server Selection)</option>
                        </select>
                        <div class="help-text">Needed for opening unsupported objects in native SAPGUI (e.g., transactions)</div>
                    </div>
                </div>
                
                <!-- Direct Server Fields -->
                <div id="directServerFields" class="conditional-field">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="sapGui_server">Application Server</label>
                            <input type="text" id="sapGui_server" name="sapGui.server" placeholder="sapserver.domain.com">
                            <div class="help-text">Needed for opening unsupported objects in native SAPGUI</div>
                        </div>
                        <div class="form-group">
                            <label for="sapGui_systemNumber">System Number</label>
                            <input type="text" id="sapGui_systemNumber" name="sapGui.systemNumber" pattern="[0-9]{2}" maxlength="2" placeholder="00">
                            <div class="help-text">Instance number (00-99).Needed for opening unsupported objects in native SAPGUI</div>
                        </div>
                    </div>
                </div>
                
                <!-- Load Balancing Fields -->
                <div id="loadBalancingFields" class="conditional-field">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="sapGui_messageServer">Message Server</label>
                            <input type="text" id="sapGui_messageServer" name="sapGui.messageServer" placeholder="messageserver.domain.com">
                            <div class="help-text">Needed for opening unsupported objects in native SAPGUI</div>
                        </div>
                        <div class="form-group">
                            <label for="sapGui_messageServerPort">Message Server Port</label>
                            <input type="text" id="sapGui_messageServerPort" name="sapGui.messageServerPort" placeholder="3600">
                            <div class="help-text">Message server port (default: 3600)</div>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="sapGui_group">Logon Group</label>
                            <input type="text" id="sapGui_group" name="sapGui.group" placeholder="PUBLIC">
                            <div class="help-text">Logon group name</div>
                        </div>
                    </div>
                </div>
                
                <!-- Common Fields -->
                <div class="form-row">
                    <div class="form-group">
                        <label for="sapGui_routerString">SAP Router String (Optional)</label>
                        <input type="text" id="sapGui_routerString" name="sapGui.routerString" placeholder="/H/saprouter.domain.com/S/3299">
                        <div class="help-text">SAProuter connection string if required</div>
                    </div>
                </div>
                <div class="form-row conditional-field" id="browserPathField">
                    <div class="form-group">
                        <label for="sapGui_browserPath">Browser Path</label>
                        <input type="text" id="sapGui_browserPath" name="sapGui.browserPath" placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe">
                        <div class="help-text">For controlled WebGUI mode only</div>
                    </div>
                </div>
                </div>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancelEditorBtn">Cancel</button>
                <button type="submit" class="btn btn-primary">💾 Save Connection</button>
            </div>
        `;
    }

    private getScript() {
        return `
            const vscode = acquireVsCodeApi();
            let currentTarget = 'user';
            let editingConnectionKey = null; // Store the connection key (ID) being edited
            let connections = { user: {}, workspace: {} };

            // Initialize
            window.addEventListener('load', () => {
                vscode.postMessage({ type: 'ready' });
                setupEventListeners();
            });

            // Handle messages from extension
            window.addEventListener('message', event => {
                const message = event.data;
                
                switch (message.type) {
                    case 'connections':
                        connections = message.data;
                        renderConnections();
                        break;
                    case 'success':
                        showMessage(message.message, 'success');
                        // Close editor modal on successful save
                        const modal = document.getElementById('editorModal');
                        if (modal && modal.style.display === 'flex') {
                            closeEditor();
                        }
                        break;
                    case 'error':
                        showMessage(message.message, 'error');
                        break;
                    case 'formValidationError':
                        // Show error in the form modal without closing it
                        const formError = document.getElementById('formError');
                        if (formError) {
                            formError.textContent = message.message;
                            formError.style.display = 'block';
                        }
                        break;
                    case 'testResult':
                        showMessage(message.message, message.success ? 'success' : 'error');
                        break;
                    case 'cloudConnectionCreated':
                        handleCloudConnection(message.connection, message.availableLanguages);
                        break;
                }
            });

            function setupEventListeners() {
                // Target selector
                document.querySelectorAll('input[name="target"]').forEach(radio => {
                    radio.addEventListener('change', (e) => {
                        currentTarget = e.target.value;
                        renderConnections();
                    });
                });

                // Header buttons
                document.getElementById('addBtn').addEventListener('click', () => openEditor());
                document.getElementById('addCloudBtn').addEventListener('click', () => openCloudModal());
                document.getElementById('exportBtn').addEventListener('click', () => exportConnections());
                document.getElementById('importJsonBtn').addEventListener('click', () => document.getElementById('jsonFileInput').click());
                
                // Bulk action buttons
                document.getElementById('bulkEditUsernameBtn').addEventListener('click', bulkEditUsername);
                document.getElementById('bulkDeleteBtn').addEventListener('click', bulkDelete);

                // File inputs
                document.getElementById('jsonFileInput').addEventListener('change', handleJsonFile);

                // Form submission
                const connectionForm = document.getElementById('connectionForm');
                if (connectionForm) {
                    connectionForm.addEventListener('submit', handleFormSubmit);
                }

                // GUI Type change handler - only add if element exists
                const guiTypeElement = document.getElementById('sapGui_guiType');
                if (guiTypeElement) {
                    guiTypeElement.addEventListener('change', handleGuiTypeChange);
                }
                
                // SAP GUI connection type change handler - only add if element exists
                const connectionTypeElement = document.getElementById('sapGui_connectionType');
                if (connectionTypeElement) {
                    connectionTypeElement.addEventListener('change', handleSapGuiConnectionTypeChange);
                }
                
                // SAP GUI Enable checkbox handler - only add if element exists
                const sapGuiEnabledElement = document.getElementById('sapGui_enabled');
                if (sapGuiEnabledElement) {
                    sapGuiEnabledElement.addEventListener('change', handleSapGuiEnabledChange);
                }
                
                // Allow Self-Signed checkbox handler - only add if element exists
                const allowSelfSignedElement = document.getElementById('allowSelfSigned');
                if (allowSelfSignedElement) {
                    allowSelfSignedElement.addEventListener('change', handleAllowSelfSignedChange);
                }
                
                // Modal close buttons - only add if elements exist
                const closeEditorBtn = document.getElementById('closeEditorBtn');
                if (closeEditorBtn) {
                    closeEditorBtn.addEventListener('click', closeEditor);
                }
                
                const cancelEditorBtn = document.getElementById('cancelEditorBtn');
                if (cancelEditorBtn) {
                    cancelEditorBtn.addEventListener('click', closeEditor);
                }
                
                const closeCloudBtn = document.getElementById('closeCloudBtn');
                if (closeCloudBtn) {
                    closeCloudBtn.addEventListener('click', closeCloudModal);
                }
                
                const cancelCloudBtn = document.getElementById('cancelCloudBtn');
                if (cancelCloudBtn) {
                    cancelCloudBtn.addEventListener('click', closeCloudModal);
                }
                
                const processCloudBtn = document.getElementById('processCloudBtn');
                if (processCloudBtn) {
                    processCloudBtn.addEventListener('click', processCloudConnection);
                }
                
                // Cloud type selector handler - only add if element exists
                const cloudTypeSelect = document.getElementById('cloudTypeSelect');
                if (cloudTypeSelect) {
                    cloudTypeSelect.addEventListener('change', handleCloudTypeChange);
                }
                
                // Event delegation for table buttons (since they're dynamically created)
                document.getElementById('connectionsList').addEventListener('click', (e) => {
                    const target = e.target.closest('button');
                    if (!target) {
                        return;
                    }
                    
                    const name = target.dataset.name;
                    if (target.classList.contains('edit-btn')) {
                        editConnection(name);
                    } else if (target.classList.contains('delete-btn')) {
                        deleteConnection(name);
                    }
                });
            }

            function renderConnections() {
                const list = document.getElementById('connectionsList');
                const conns = connections[currentTarget];

                if (Object.keys(conns).length === 0) {
                    list.innerHTML = \`
                        <div class="empty-state">
                            <div class="empty-state-icon">🔌</div>
                            <h3>No connections configured</h3>
                            <p>Add a new connection to get started</p>
                        </div>
                    \`;
                    document.getElementById('bulkActions').style.display = 'none';
                    return;
                }

                // Build table
                list.innerHTML = \`
                    <table>
                        <thead>
                            <tr>
                                <th><input type="checkbox" id="selectAll"></th>
                                <th>Name</th>
                                <th>URL</th>
                                <th>Username</th>
                                <th>Client</th>
                                <th>Language</th>
                                <th>GUI Type</th>
                                <th>GUI Server</th>
                                <th>System #</th>
                                <th>ATC Approver</th>
                                <th>Max Threads</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            \${Object.entries(conns).map(([name, conn]) => \`
                                <tr>
                                    <td><input type="checkbox" class="row-checkbox" data-name="\${name}"></td>
                                    <td><span class="connection-name">\${escapeHtml(name)}</span></td>
                                    <td>\${escapeHtml(conn.url || '')}</td>
                                    <td>\${escapeHtml(conn.username || '')}</td>
                                    <td>\${escapeHtml(conn.client || '')}</td>
                                    <td>\${formatValue(conn.language, 'en')}</td>
                                    <td><span class="gui-badge">\${getGuiTypeLabel(conn.sapGui?.guiType || 'SAPGUI')}</span></td>
                                    <td>\${formatValue(conn.sapGui?.server, '')}</td>
                                    <td>\${formatValue(conn.sapGui?.systemNumber, '')}</td>
                                    <td>\${formatValue(conn.atcapprover, '')}</td>
                                    <td>\${formatValue(conn.maxDebugThreads, 4)}</td>
                                    <td>
                                        <div class="connection-actions">
                                            <button class="btn btn-small btn-secondary edit-btn" data-name="\${name}" title="Edit">✏️</button>
                                            <button class="btn btn-small btn-danger delete-btn" data-name="\${name}" title="Delete">🗑️</button>
                                        </div>
                                    </td>
                                </tr>
                            \`).join('')}
                        </tbody>
                    </table>
                \`;
                
                // Re-attach select all handler after table is recreated
                const selectAllCheckbox = document.getElementById('selectAll');
                if (selectAllCheckbox) {
                    selectAllCheckbox.addEventListener('change', (e) => {
                        const checkboxes = document.querySelectorAll('.row-checkbox');
                        checkboxes.forEach(cb => cb.checked = e.target.checked);
                        updateBulkActions();
                    });
                }
                
                // Re-attach checkbox handlers after table is recreated
                const rowCheckboxes = document.querySelectorAll('.row-checkbox');
                rowCheckboxes.forEach(checkbox => {
                    checkbox.addEventListener('change', updateBulkActions);
                });
                
                updateBulkActions();
            }
            
            function updateBulkActions() {
                const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
                const bulkActions = document.getElementById('bulkActions');
                
                if (checkedBoxes.length > 0) {
                    bulkActions.style.display = 'flex';
                } else {
                    bulkActions.style.display = 'none';
                }
            }
            
            function bulkEditUsername() {
                const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
                if (checkedBoxes.length === 0) return;
                
                const names = Array.from(checkedBoxes).map(cb => cb.dataset.name);
                
                // Send to backend for input (can't use prompt() due to CSP)
                vscode.postMessage({
                    type: 'requestBulkUsernameEdit',
                    connectionNames: names,
                    target: currentTarget
                });
            }
            
            function bulkDelete() {
                const checkedBoxes = document.querySelectorAll('.row-checkbox:checked');
                if (checkedBoxes.length === 0) return;
                
                const names = Array.from(checkedBoxes).map(cb => cb.dataset.name);
                
                // Send to backend for confirmation (can't use confirm() due to CSP)
                vscode.postMessage({
                    type: 'confirmBulkDelete',
                    connectionNames: names,
                    target: currentTarget
                });
            }

            function formatValue(value, defaultValue) {
                if (value === undefined || value === null || value === '') {
                    if (defaultValue !== undefined && defaultValue !== null && defaultValue !== '') {
                        return \`<span class="default-value">\${escapeHtml(String(defaultValue))}</span>\`;
                    }
                    return '<span class="default-value">-</span>';
                }
                return escapeHtml(String(value));
            }

            function getGuiTypeLabel(type) {
                const labels = {
                    'SAPGUI': 'Native SAP GUI',
                    'WEBGUI_CONTROLLED': 'Web (Controlled)',
                    'WEBGUI_UNSAFE': 'Web (Browser)',
                    'WEBGUI_UNSAFE_EMBEDDED': 'Web (Embedded)'
                };
                return labels[type] || type;
            }

            function openEditor(connectionKey = null, connection = null) {
                editingConnectionKey = connectionKey;
                const modal = document.getElementById('editorModal');
                const title = document.getElementById('modalTitle');
                const form = document.getElementById('connectionForm');
                const formError = document.getElementById('formError');
                
                // Clear any previous error messages
                if (formError) {
                    formError.style.display = 'none';
                    formError.textContent = '';
                }

                if (connection) {
                    title.textContent = 'Edit Connection: ' + connectionKey;
                    populateForm(connectionKey, connection);
                } else {
                    title.textContent = 'Add New Connection';
                    
                    // Re-enable name field BEFORE resetting form
                    const nameField = document.getElementById('name');
                    nameField.readOnly = false;
                    nameField.style.backgroundColor = '';
                    nameField.style.opacity = '';
                    nameField.title = '';
                    
                    form.reset();
                    
                    // Set defaults
                    document.getElementById('language').value = 'en';
                    document.getElementById('diff_formatter').value = 'ADT formatter';
                    document.getElementById('maxDebugThreads').value = '4';
                    document.getElementById('sapGui_enabled').checked = true;
                    document.getElementById('sapGui_guiType').value = 'WEBGUI_UNSAFE_EMBEDDED';
                    document.getElementById('sapGui_connectionType').value = 'DIRECT';
                    handleSapGuiEnabledChange(); // Show SAP GUI fields
                    handleSapGuiConnectionTypeChange(); // Show direct server fields
                }

                modal.style.display = 'flex';
                handleGuiTypeChange(); // Show/hide conditional fields
            }

            function closeEditor() {
                document.getElementById('editorModal').style.display = 'none';
                editingConnectionKey = null;
            }

            function populateForm(connectionKey, conn) {
                const nameField = document.getElementById('name');
                nameField.value = connectionKey;
                // Make name field readonly when editing (cannot rename existing connections)
                nameField.readOnly = true;
                nameField.style.backgroundColor = 'var(--vscode-input-background)';
                nameField.style.opacity = '0.6';
                nameField.title = 'Change name in settings.json if needed.';
                
                document.getElementById('url').value = conn.url;
                document.getElementById('username').value = conn.username;
                document.getElementById('client').value = conn.client;
                document.getElementById('language').value = (conn.language || 'en').toLowerCase();
                document.getElementById('diff_formatter').value = conn.diff_formatter || 'ADT formatter';
                document.getElementById('maxDebugThreads').value = conn.maxDebugThreads || 4;
                document.getElementById('allowSelfSigned').checked = conn.allowSelfSigned || false;
                handleAllowSelfSignedChange(); // Update conditional field visibility
                
                // Clear optional fields, then set if they exist
                document.getElementById('atcapprover').value = conn.atcapprover || '';
                document.getElementById('atcVariant').value = conn.atcVariant || '';
                document.getElementById('customCA').value = conn.customCA || '';

                // SAP GUI fields
                const hasGui = conn.sapGui && !conn.sapGui.disabled;
                document.getElementById('sapGui_enabled').checked = hasGui;
                handleSapGuiEnabledChange(); // Update conditional field visibility
                
                if (conn.sapGui) {
                    document.getElementById('sapGui_guiType').value = conn.sapGui.guiType || 'SAPGUI';
                    
                    // Determine connection type based on which fields are populated
                    const isLoadBalancing = !!(conn.sapGui.messageServer && conn.sapGui.group);
                    document.getElementById('sapGui_connectionType').value = isLoadBalancing ? 'LOADBALANCING' : 'DIRECT';
                    handleSapGuiConnectionTypeChange(); // Update conditional fields
                    
                    // Populate fields (always set, even if empty, to clear old values)
                    document.getElementById('sapGui_server').value = conn.sapGui.server || '';
                    document.getElementById('sapGui_systemNumber').value = conn.sapGui.systemNumber || '';
                    document.getElementById('sapGui_messageServer').value = conn.sapGui.messageServer || '';
                    document.getElementById('sapGui_messageServerPort').value = conn.sapGui.messageServerPort || '';
                    document.getElementById('sapGui_group').value = conn.sapGui.group || '';
                    document.getElementById('sapGui_routerString').value = conn.sapGui.routerString || '';
                    document.getElementById('sapGui_browserPath').value = conn.sapGui.browserPath || '';
                    handleGuiTypeChange(); // Update conditional field visibility
                } else {
                    // Default to direct server and clear all fields
                    document.getElementById('sapGui_connectionType').value = 'DIRECT';
                    document.getElementById('sapGui_server').value = '';
                    document.getElementById('sapGui_systemNumber').value = '';
                    document.getElementById('sapGui_messageServer').value = '';
                    document.getElementById('sapGui_messageServerPort').value = '';
                    document.getElementById('sapGui_group').value = '';
                    document.getElementById('sapGui_routerString').value = '';
                    document.getElementById('sapGui_browserPath').value = '';
                    handleSapGuiConnectionTypeChange();
                }

                // Handle OAuth for cloud connections
                if (conn.oauth) {
                    // OAuth credentials are maintained automatically
                }
            }

            function handleGuiTypeChange() {
                const guiType = document.getElementById('sapGui_guiType').value;
                const browserPathField = document.getElementById('browserPathField');
                
                if (guiType === 'WEBGUI_CONTROLLED') {
                    browserPathField.classList.add('show');
                } else {
                    browserPathField.classList.remove('show');
                }
            }
            
            function handleSapGuiConnectionTypeChange() {
                const connectionType = document.getElementById('sapGui_connectionType').value;
                const directServerFields = document.getElementById('directServerFields');
                const loadBalancingFields = document.getElementById('loadBalancingFields');
                
                if (connectionType === 'DIRECT') {
                    directServerFields.classList.add('show');
                    loadBalancingFields.classList.remove('show');
                } else if (connectionType === 'LOADBALANCING') {
                    directServerFields.classList.remove('show');
                    loadBalancingFields.classList.add('show');
                }
            }
            
            function handleSapGuiEnabledChange() {
                const enabled = document.getElementById('sapGui_enabled').checked;
                const sapGuiFields = document.getElementById('sapGuiFields');
                
                if (enabled) {
                    sapGuiFields.classList.add('show');
                } else {
                    sapGuiFields.classList.remove('show');
                }
            }
            
            function handleAllowSelfSignedChange() {
                const allowed = document.getElementById('allowSelfSigned').checked;
                const customCAField = document.getElementById('customCAField');
                
                if (allowed) {
                    customCAField.classList.add('show');
                } else {
                    customCAField.classList.remove('show');
                }
            }

            function handleFormSubmit(e) {
                e.preventDefault();
                
                const formData = new FormData(e.target);
                const formError = document.getElementById('formError');
                
                // Clear previous errors
                formError.style.display = 'none';
                formError.textContent = '';
                
                // Validate URL format
                const url = formData.get('url');
                if (url) {
                    try {
                        const urlObj = new URL(url);
                        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                            formError.textContent = 'URL must use http or https protocol';
                            formError.style.display = 'block';
                            return;
                        }
                    } catch (e) {
                        formError.textContent = 'Invalid URL format. Expected: http(s)://domain[:port] (e.g., https://myserver.com:44311)';
                        formError.style.display = 'block';
                        return;
                    }
                }
                
                const connection = {
                    url: formData.get('url'),
                    username: formData.get('username'),
                    password: "", // Empty string - password stored in OS credential manager only, never in settings.json
                    client: formData.get('client'),
                    language: (formData.get('language') || 'en').toLowerCase(), // Enforce lowercase
                    allowSelfSigned: formData.get('allowSelfSigned') === 'on',
                    diff_formatter: formData.get('diff_formatter') || 'ADT formatter',
                    maxDebugThreads: parseInt(formData.get('maxDebugThreads')) || 4,
                    atcapprover: formData.get('atcapprover') || undefined,
                    atcVariant: formData.get('atcVariant') || undefined,
                    customCA: formData.get('customCA') || undefined,
                    sapGui: {
                        disabled: formData.get('sapGui.enabled') !== 'on', // Inverted logic - enabled checkbox -> disabled flag
                        guiType: formData.get('sapGui.guiType') || 'SAPGUI',
                        server: formData.get('sapGui.server') || undefined,
                        systemNumber: formData.get('sapGui.systemNumber') || undefined,
                        messageServer: formData.get('sapGui.messageServer') || undefined,
                        messageServerPort: formData.get('sapGui.messageServerPort') || undefined,
                        group: formData.get('sapGui.group') || undefined,
                        routerString: formData.get('sapGui.routerString') || undefined,
                        browserPath: formData.get('sapGui.browserPath') || undefined
                    }
                };
                
                const connectionId = editingConnectionKey || formData.get('name');

                // Preserve OAuth config if editing a cloud connection
                if (editingConnectionKey) {
                    const existingConn = connections[currentTarget][editingConnectionKey];
                    if (existingConn && existingConn.oauth) {
                        connection.oauth = existingConn.oauth;
                    }
                }

                vscode.postMessage({
                    type: 'saveConnection',
                    connectionId: connectionId,
                    connection: connection,
                    target: currentTarget,
                    isEdit: !!editingConnectionKey
                });

                // Don't close editor here - wait for backend response
                // Modal will close on 'success' message or stay open on 'formValidationError'
            }

            function editConnection(name) {
                const conn = connections[currentTarget][name];
                openEditor(name, conn);
            }

            function deleteConnection(name) {
                // Send to backend for confirmation (can't use confirm() due to CSP)
                vscode.postMessage({
                    type: 'confirmDeleteConnection',
                    connectionId: name,
                    target: currentTarget
                });
            }

            function exportConnections() {
                vscode.postMessage({
                    type: 'exportConnections',
                    target: currentTarget
                });
            }

            function openCloudModal() {
                document.getElementById('cloudModal').style.display = 'flex';
                document.getElementById('serviceKeyInput').value = '';
                document.getElementById('manualEndpointInput').value = '';
                document.getElementById('cloudTypeSelect').value = 'LOADKEY';
                handleCloudTypeChange(); // Show appropriate section
            }

            function closeCloudModal() {
                document.getElementById('cloudModal').style.display = 'none';
            }
            
            function handleCloudTypeChange() {
                const cloudType = document.getElementById('cloudTypeSelect').value;
                const serviceKeySection = document.getElementById('serviceKeySection');
                const manualEndpointSection = document.getElementById('manualEndpointSection');
                
                // Hide all sections first
                serviceKeySection.style.display = 'none';
                manualEndpointSection.style.display = 'none';
                
                // Show appropriate section based on selection
                if (cloudType === 'LOADKEY') {
                    serviceKeySection.style.display = 'block';
                } else if (cloudType === 'MANUAL') {
                    manualEndpointSection.style.display = 'block';
                }
                // EU10 and US10 don't need extra input sections - just continue with endpoint
            }

            function processCloudConnection() {
                const cloudType = document.getElementById('cloudTypeSelect').value;
                let endpoint = '';
                
                switch (cloudType) {
                    case 'LOADKEY':
                        const serviceKey = document.getElementById('serviceKeyInput').value.trim();
                        if (!serviceKey) {
                            showMessage('Please paste a service key', 'error');
                            return;
                        }
                        
                        vscode.postMessage({
                            type: 'createCloudConnection',
                            cloudType: 'serviceKey',
                            serviceKey: serviceKey,
                            target: currentTarget
                        });
                        break;
                        
                    case 'EU10':
                        endpoint = 'https://api.cf.eu10.hana.ondemand.com';
                        vscode.postMessage({
                            type: 'createCloudConnection',
                            cloudType: 'endpoint',
                            endpoint: endpoint,
                            target: currentTarget
                        });
                        break;
                        
                    case 'US10':
                        endpoint = 'https://api.cf.us10.hana.ondemand.com';
                        vscode.postMessage({
                            type: 'createCloudConnection',
                            cloudType: 'endpoint',
                            endpoint: endpoint,
                            target: currentTarget
                        });
                        break;
                        
                    case 'MANUAL':
                        endpoint = document.getElementById('manualEndpointInput').value.trim();
                        if (!endpoint) {
                            showMessage('Please enter a Cloud Foundry API endpoint', 'error');
                            return;
                        }
                        if (!endpoint.startsWith('https://')) {
                            showMessage('Endpoint must start with https://', 'error');
                            return;
                        }
                        
                        vscode.postMessage({
                            type: 'createCloudConnection',
                            cloudType: 'endpoint',
                            endpoint: endpoint,
                            target: currentTarget
                        });
                        break;
                }

                closeCloudModal();
            }

            function handleCloudConnection(connection, availableLanguages) {
                // Store available languages for the cloud connection
                connection._availableLanguages = availableLanguages;
                
                // Open editor with pre-filled cloud connection data
                openEditor(connection);
                
                showMessage('Cloud connection created. Please review and save.', 'success');
            }

            async function handleJsonFile(e) {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    vscode.postMessage({
                        type: 'importFromJson',
                        jsonContent: event.target.result,
                        target: currentTarget
                    });
                };
                reader.readAsText(file);
                
                // Reset file input
                e.target.value = '';
            }

            function showMessage(text, type) {
                const existing = document.querySelector('.message');
                if (existing) existing.remove();

                const message = document.createElement('div');
                message.className = \`message message-\${type}\`;
                message.textContent = type === 'success' ? '✓ ' + text : '✗ ' + text;
                
                document.querySelector('.container').insertBefore(message, document.querySelector('.target-selector'));
                
                setTimeout(() => message.remove(), 5000);
            }

            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }

            // Make functions globally accessible
            window.openEditor = openEditor;
            window.closeEditor = closeEditor;
            window.editConnection = editConnection;
            window.deleteConnection = deleteConnection;
            window.openCloudModal = openCloudModal;
            window.closeCloudModal = closeCloudModal;
            window.processCloudConnection = processCloudConnection;
            window.handleCloudTypeChange = handleCloudTypeChange;
        `;
    }

    public dispose() {
        SapConnectionManager.currentPanel = undefined;

        // Clean up our resources
        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Command handler for Connection Wizard
 */
export async function openConnectionManager(context: vscode.ExtensionContext) {
    try {
        logTelemetry('command_connection_manager_opened');
        SapConnectionManager.createOrShow(context.extensionUri);
    } catch (error) {
        logCommands.error(`Error opening connection manager: ${error}`);
        window.showErrorMessage(`Failed to open connection manager: ${error}`);
    }
}
