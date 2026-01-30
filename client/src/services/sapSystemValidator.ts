import * as vscode from 'vscode';
import { StatusBarAlignment, StatusBarItem } from 'vscode';
import { funWindow as window } from './funMessenger';
import * as crypto from 'crypto';

/**
 * Central SAP System and User Whitelist Validator
 * Fetches allowed systems and users and validates connections
 */
// Interface for developer mapping
interface DeveloperMapping {
    uniqueId: string;
    manager: string;
}

export class SapSystemValidator {
    private static instance: SapSystemValidator;
    private allowedDomains: string[] = [];
    private allowedUsers: string[] = [];
    private userMapping: Map<string, DeveloperMapping> = new Map(); // userId -> {uniqueId, manager}
    private minimumExtensionVersion: string | null = null; // Store minimum version from whitelist
    private lastFetch: number = 0;
    
    // ⚙️ CONFIGURATION: Set to true to skip validation (allow all)
    // TODO: Organization admins - set these before building VSIX
    private readonly ALLOW_ALL_SYSTEMS = true;  // Set to true to allow all SAP systems (skip system whitelist)
    private readonly ALLOW_ALL_USERS = true;    // Set to true to allow all users (skip user whitelist)
    
    private readonly TTL_MS = 2 * 60 * 60 * 1000; // 2 hour TTL
    // TODO: Replace with your organization's whitelist file URL - like https://example.com/site/whitelist.json 
    // The file must be directly accessible in your network without authentication (read access is sufficient) 
    // See whitelist.example.json in this folder for sample JSON whitelist file
    private readonly WHITELIST_URL = 'your-whitelist-url-here';
    
    // 🔒 BACKUP WHITELIST - Used when remote whitelist fetch fails
    private readonly BACKUP_WHITELIST = [
        '*dev1*',
        '*dev2*', 
        '*qa1*',
        '*qa2*',
        '*prd1*'
    ];
    
    // 🔒 BACKUP USERS - Used when remote fetch fails
    private readonly BACKUP_USERS: string[] = [
        //  Fill with backup users
        '*user1*',
        '*user2*'
    ];
    
    // 🔄 Corporate Network Retry Logic
    private whitelistRefreshed: boolean = false;
    private retryCount: number = 0;
    private readonly MAX_RETRIES = 10; // 10 minutes max
    private readonly RETRY_INTERVAL_MS = 60 * 1000; // 60 seconds
    private retryTimer: NodeJS.Timeout | null = null;
    private statusBarItem: StatusBarItem | null = null;
    
    private constructor() {}
    
    public static getInstance(): SapSystemValidator {
        if (!SapSystemValidator.instance) {
            SapSystemValidator.instance = new SapSystemValidator();
        }
        return SapSystemValidator.instance;
    }
    
    /**
     * Initialize validator - fetch whitelist on extension startup with corporate network retry logic
     */
    public async initialize(): Promise<void> {
        // If both allow_all flags are true, skip whitelist fetch entirely
        if (this.ALLOW_ALL_SYSTEMS && this.ALLOW_ALL_USERS) {
            console.log('🔓 SAP System Validator: ALLOW_ALL_SYSTEMS and ALLOW_ALL_USERS enabled - skipping whitelist fetch');
            this.whitelistRefreshed = true;
            return;
        }
        
        try {
            await this.fetchWhitelist();
            // Success - whitelistRefreshed is already set to true in fetchWhitelist
            // No status bar or notification needed on initial successful load
        } catch (error) {
            // Use backup whitelist as fallback
            this.allowedDomains = [...this.BACKUP_WHITELIST];
            this.allowedUsers = [...this.BACKUP_USERS];
            this.lastFetch = Date.now();
            
            // Start corporate network retry logic (whitelistRefreshed remains false)
            this.startVpnRetryProcess();
        }
    }
    
    /**
     * Start the corporate network retry process with status bar countdown
     */
    private startVpnRetryProcess(): void {
        if (this.whitelistRefreshed) return; // Already got whitelist
        
        this.retryCount = 0;
        this.createStatusBarItem();
        this.scheduleNextRetry();
    }
    
    /**
     * Create and show status bar item for countdown
     */
    private createStatusBarItem(): void {
        if (!this.statusBarItem) {
            this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
            this.statusBarItem.command = 'abapfs.retryWhitelist';
        }
        this.statusBarItem.show();
    }
    
    /**
     * Update status bar with countdown and schedule next retry
     */
    private scheduleNextRetry(): void {
        if (this.whitelistRefreshed || this.retryCount >= this.MAX_RETRIES) {
            this.handleMaxRetriesReached();
            return;
        }
        
        let secondsLeft = 60;
        this.updateStatusBar(secondsLeft);
        
        // Update countdown every second
        const countdownInterval = setInterval(() => {
            secondsLeft--;
            this.updateStatusBar(secondsLeft);
            
            if (secondsLeft <= 0) {
                clearInterval(countdownInterval);
                this.attemptWhitelistRefresh();
            }
        }, 1000);
    }
    
    /**
     * Update status bar text with countdown
     */
    private updateStatusBar(secondsLeft: number): void {
        if (this.statusBarItem) {
            this.statusBarItem.text = `$(sync~spin) SAP Whitelist: Retrying in ${secondsLeft}s (${this.retryCount + 1}/${this.MAX_RETRIES})`;
            this.statusBarItem.tooltip = 'Click to retry whitelist fetch immediately';
        }
    }
    
    /**
     * Attempt to refresh whitelist (called after countdown)
     */
    private async attemptWhitelistRefresh(): Promise<void> {
        this.retryCount++;
        
        try {
            // Reset last fetch to force refresh
            this.lastFetch = 0;
            await this.fetchWhitelist();
            
            // If fetchWhitelist() completes without throwing, it succeeded
            // (whitelistRefreshed is set to true internally)
            this.handleWhitelistSuccess();
            
        } catch (error) {
            // Failed again - schedule next retry or show final error
            this.scheduleNextRetry();
        }
    }
    
    /**
     * Handle successful whitelist fetch (consolidated success logic)
     */
    private handleWhitelistSuccess(): void {
        this.clearRetryTimer();
        
        if (this.statusBarItem) {
            this.statusBarItem.text = '$(check) SAP Whitelist: Connected';
            this.statusBarItem.tooltip = 'SAP system whitelist loaded successfully';
            
            // Hide success message after 5 seconds
            setTimeout(() => {
                if (this.statusBarItem) {
                    this.statusBarItem.hide();
                }
            }, 5000);
        }
        
        // Only show notification if we were retrying (not on initial success)
        if (this.retryCount > 0) {
            window.showInformationMessage('✅ SAP system whitelist loaded successfully!');
        }
    }
    
    /**
     * Handle case when max retries reached
     */
    private handleMaxRetriesReached(): void {
        // Show persistent status bar warning
        if (this.statusBarItem) {
            this.statusBarItem.text = '$(warning) SAP Whitelist: Corporate Network Required';
            this.statusBarItem.tooltip = 'Connect to corporate network and restart VSCode to load updated SAP system whitelist. Click for help.';
            this.statusBarItem.command = 'abapfs.showVpnHelp';
            // Keep status bar visible permanently - no popup needed
        }
    }
    
    /**
     * Clear retry timer and reset state
     */
    private clearRetryTimer(): void {
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
    }
    
    /**
     * Force immediate retry (called by command or user action)
     */
    public async forceRetryWhitelist(): Promise<void> {
        this.clearRetryTimer();
        this.retryCount = 0;
        this.whitelistRefreshed = false;
        this.lastFetch = 0;
        
        if (this.statusBarItem) {
            this.statusBarItem.text = '$(sync~spin) SAP Whitelist: Retrying...';
        }
        
        try {
            await this.fetchWhitelist();
            
            // If fetchWhitelist() completes without throwing, it succeeded
            // (whitelistRefreshed is set to true internally)
            this.handleWhitelistSuccess();
        } catch (error) {
            this.startVpnRetryProcess();
        }
    }
    
    /**
     * Show corporate network help information
     */
    public showVpnHelp(): void {
        window.showInformationMessage(
            '🔗 SAP System Whitelist Help\n\n' +
            'The extension needs to fetch an updated list of allowed SAP systems and users from the corporate network.\n\n' +
            '📋 Steps to resolve:\n' +
            '1. Connect to corporate network\n' +
            '2. Restart VSCode (Ctrl+Shift+P → "Developer: Reload Window")\n\n' +
            '⚠️ Currently using backup whitelist with limited systems and users.',
            'Retry Now'
        ).then(selection => {
            if (selection === 'Retry Now') {
                this.forceRetryWhitelist();
            }
        });
    }
    
    /**
     * Parse whitelist data and create user mapping
     */
    private parseWhitelistData(data: any): void {
        // Store minimum version for later checks
        this.minimumExtensionVersion = data.version?.minimumExtensionVersion || null;
        
        // Check version compatibility first
        if (this.minimumExtensionVersion) {
            const currentVersion = this.getCurrentExtensionVersion();
            
            if (!this.isVersionCompatible(currentVersion, this.minimumExtensionVersion)) {
                throw new Error(`Extension version ${currentVersion} is below minimum required version ${this.minimumExtensionVersion}. Please update the extension.`);
            }
        }
        
        // Clear existing mappings
        this.userMapping.clear();
        this.allowedUsers = [];
        
        // Handle new format with developers
        if (data.developers && Array.isArray(data.developers)) {
            data.developers.forEach((developer: any, devIndex: number) => {
                if (developer.manager && developer.userIds && Array.isArray(developer.userIds)) {
                    // Generate stable unique identifier for this developer
                    const devHash = crypto.createHash('sha256')
                        .update(`${developer.manager}_${devIndex}`)
                        .digest('hex')
                        .substring(0, 16);
                    const uniqueId = `dev-${devHash}`;
                    
                    // Map all user IDs of this developer to the same unique identifier
                    developer.userIds.forEach((userId: string) => {
                        this.allowedUsers.push(userId);
                        this.userMapping.set(userId.toLowerCase(), {
                            uniqueId: uniqueId,
                            manager: developer.manager
                        });
                    });
                }
            });
        }
    }

    /**
     * Get user mapping for telemetry (unique ID and manager)
     */
    public getUserMapping(userId: string): DeveloperMapping | null {
        return this.userMapping.get(userId.toLowerCase()) || null;
    }

    /**
     * Fetch whitelist with TTL caching
     */
    private async fetchWhitelist(): Promise<void> {
        const now = Date.now();
        
        // Check if cache is still valid 
        // If using backup list, don't keep retrying on every isSystemAllowed call
        if (this.lastFetch > 0 && (now - this.lastFetch) < this.TTL_MS) {
            return;
        }
        
        
        try {
            // Enhanced security: Add timeout and validate response
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
            
            const response = await fetch(this.WHITELIST_URL, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'ABAP-Copilot-Extension'
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Validate content type
            const contentType = response.headers.get('content-type');
            if (!contentType?.includes('application/json')) {
                throw new Error(`Invalid content type: ${contentType}. Expected application/json`);
            }
            
            const data = await response.json() as any;
            
            if (!data.allowedDomains || !Array.isArray(data.allowedDomains)) {
                throw new Error('Invalid whitelist format: missing allowedDomains array');
            }
            
            this.allowedDomains = data.allowedDomains;
            
            // Parse new whitelist format with developers
            this.parseWhitelistData(data);
            
            this.lastFetch = now;
            this.whitelistRefreshed = true; // Only set to true on successful fetch
            
        } catch (error) {
           // console.error('❌ SAP System Validator: Failed to fetch whitelist:', error);
            
            // Use backup whitelist if no domains are loaded yet
            if (this.allowedDomains.length === 0) {
                this.allowedDomains = [...this.BACKUP_WHITELIST];
                this.allowedUsers = [...this.BACKUP_USERS];
                this.lastFetch = now;
            }
            
            // Don't show immediate warning - let retry logic handle it
            throw error;
        }
    }
    
    /**
     * Check if a system URL and user are allowed (with wildcard matching)
     * Returns detailed validation result
     */
    public async checkSystemAccess(url: string, server?: string, username?: string): Promise<{allowed: boolean, failureReason?: 'system' | 'user' | 'version'}> {
        try {
            // If both allow_all flags are true, skip all validation
            if (this.ALLOW_ALL_SYSTEMS && this.ALLOW_ALL_USERS) {
                return { allowed: true };
            }
            
            // Fetch whitelist if not loaded yet (needed for validation or telemetry grouping)
            if (this.allowedDomains.length === 0) {
                await this.fetchWhitelist();
            }
            
            // Check version using stored minimum version
            if (this.minimumExtensionVersion) {
                const currentVersion = this.getCurrentExtensionVersion();
                if (!this.isVersionCompatible(currentVersion, this.minimumExtensionVersion)) {
                    return { allowed: false, failureReason: 'version' };
                }
            }
            
            // Check system validation (skip if ALLOW_ALL_SYSTEMS = true)
            if (!this.ALLOW_ALL_SYSTEMS) {
                // Extract hostname from URL
                const urlHostname = this.extractHostname(url);
                
                // Check URL first - if blocked, no need to check server or user
                const urlAllowed = this.matchesWhitelist(urlHostname);
                
                if (!urlAllowed) {
                    return { allowed: false, failureReason: 'system' };
                }
                
                // URL is allowed, now check server if provided
                if (server) {
                    const serverHostname = this.extractHostname(server);
                    const serverAllowed = this.matchesWhitelist(serverHostname);
                    
                    if (!serverAllowed) {
                        return { allowed: false, failureReason: 'system' };
                    }
                }
            }
            
            // Check user validation (skip if ALLOW_ALL_USERS = true)
            if (!this.ALLOW_ALL_USERS && username) {
                const userAllowed = this.matchesUserWhitelist(username);
                
                if (!userAllowed) {
                    return { allowed: false, failureReason: 'user' };
                }
            }
            
            return { allowed: true };
            
        } catch (error) {
           // console.error('❌ SAP System Validator: Error during validation:', error);
            // Fail-safe: deny access on errors
            return { allowed: false, failureReason: 'system' };
        }
    }
    
    /**
     * Check if a system URL and user are allowed (backward compatibility)
     */
    // public async isSystemAllowed(url: string, server?: string, username?: string): Promise<boolean> {
    //     const result = await this.checkSystemAccess(url, server, username);
    //     return result.allowed;
    // }
    
    /**
     * Extract hostname from URL
     */
    private extractHostname(url: string): string {
        try {
            // Handle URLs with or without protocol
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            return urlObj.hostname.toLowerCase();
        } catch {
            // If URL parsing fails, treat as plain hostname
            return url.toLowerCase();
        }
    }
    
    /**
     * Check if hostname matches any wildcard pattern in whitelist
     * Case insensitive matching for convenience
     */
    private matchesWhitelist(hostname: string): boolean {
        const lowerHostname = hostname.toLowerCase();
        
        return this.allowedDomains.some(pattern => {
            // Convert wildcard pattern to regex (case insensitive)
            const regexPattern = pattern
                .toLowerCase()           // Make pattern lowercase
                .replace(/\./g, '\\.')   // Escape dots
                .replace(/\*/g, '.*');   // Convert * to .*
            
            const regex = new RegExp(`^${regexPattern}$`);
            const matches = regex.test(lowerHostname);
            
            if (matches) {
            }
            
            return matches;
        });
    }
    
    /**
     * Check if username matches any wildcard pattern in user whitelist
     * Case insensitive matching for convenience
     */
    private matchesUserWhitelist(username: string): boolean {
        // If no users are configured, allow all users (backward compatibility)
        if (this.allowedUsers.length === 0) {
            console.log(`✅ No user whitelist configured, allowing all users`);
            return true;
        }
        
        const lowerUsername = username.toLowerCase();
        
        const matches = this.allowedUsers.some(pattern => {
            // Convert wildcard pattern to regex (case insensitive)
            const regexPattern = pattern
                .toLowerCase()           // Make pattern lowercase
                .replace(/\./g, '\\.')   // Escape dots
                .replace(/\*/g, '.*');   // Convert * to .*
            
            const regex = new RegExp(`^${regexPattern}$`);
            const matches = regex.test(lowerUsername);
            
            if (matches) {
            }
            
            return matches;
        });
        
        if (!matches) {
            console.log(`❌ Username '${username}' does not match any allowed user patterns`);
        }
        
        return matches;
    }
    
    /**
     * Show user-friendly error when system or user is blocked
     */
    public async validateSystemAccess(url: string, server?: string, username?: string): Promise<void> {
        const result = await this.checkSystemAccess(url, server, username);
        
        if (!result.allowed) {
            const hostname = this.extractHostname(url);
            
            let errorMessage: string;
            let errorDetail: string;
            
            if (result.failureReason === 'version') {
                const currentVersion = this.getCurrentExtensionVersion();
                errorMessage = `🚫 Extension Version Outdated

Your extension version (${currentVersion}) is below the minimum required version (${this.minimumExtensionVersion}).

Please update ABAP FS to the latest version.`;
                errorDetail = `Extension version ${currentVersion} is below minimum required version ${this.minimumExtensionVersion}`;
            } else if (result.failureReason === 'user') {
                errorMessage = `🚫 SAP User Access Denied
            
User '${username}' is not authorized to access this system.

Contact your administrator to request user access.`;
                errorDetail = `User '${username}' is not in the approved users whitelist`;
            } else {
                // System failure (or unknown failure defaults to system)
                errorMessage = `🚫 SAP System Access Denied
            
System '${hostname}' is not in the approved systems list.

Contact your administrator to request access to this system.`;
                errorDetail = `SAP system '${hostname}' is not in the approved systems whitelist`;
            }
            
           // console.error('🚫 SAP System Validator: Access denied');
            window.showErrorMessage(errorMessage);
            throw new Error(errorDetail);
        }
    }
    
    /**
     * Get current whitelist for debugging
     */
    
    /**
     * Force refresh whitelist (for testing/debugging)
     */
    public async refreshWhitelist(): Promise<void> {
        this.lastFetch = 0; // Reset TTL
        await this.fetchWhitelist();
    }

    /**
     * Get current extension version
     */
    private getCurrentExtensionVersion(): string {
        try {
            // Use VS Code API to get extension version (same as other services)
            return vscode.extensions.getExtension('murbani.vscode-abap-remote-fs')?.packageJSON?.version || '0.0.0';
        } catch (error) {
            // Fallback to a default version if extension is not accessible
            return '0.0.0';
        }
    }

    /**
     * Check if current version is compatible with minimum required version
     */
    private isVersionCompatible(currentVersion: string, minimumVersion: string): boolean {
        try {
            const current = this.parseVersion(currentVersion);
            const minimum = this.parseVersion(minimumVersion);
            
            // Compare major, minor, patch versions
            if (current.major !== minimum.major) {
                return current.major > minimum.major;
            }
            if (current.minor !== minimum.minor) {
                return current.minor > minimum.minor;
            }
            return current.patch >= minimum.patch;
        } catch (error) {
            // If version parsing fails, assume incompatible
            return false;
        }
    }

    /**
     * Parse version string into major.minor.patch components
     */
    private parseVersion(version: string): { major: number; minor: number; patch: number } {
        const parts = version.split('.').map(Number);
        return {
            major: parts[0] || 0,
            minor: parts[1] || 0,
            patch: parts[2] || 0
        };
    }
}
