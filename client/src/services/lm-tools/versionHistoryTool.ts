/**
 * ABAP Object Version History Tool
 * Get revision history, retrieve code at specific versions, compare versions
 */

import * as vscode from 'vscode';
import { getSearchService } from '../abapSearchService';
import { logTelemetry } from '../telemetry';
import { Revision } from 'abap-adt-api';

// ============================================================================
// INTERFACES
// ============================================================================

export interface IVersionHistoryParameters {
  objectName: string;
  objectType?: string;
  connectionId: string;
  /** Action to perform: list_versions (default), get_version_source, compare_versions */
  action?: 'list_versions' | 'get_version_source' | 'compare_versions';
  /** For get_version_source: version number (1 = most recent, 2 = second most recent, etc.) */
  versionNumber?: number;
  /** For compare_versions: first version to compare (1 = most recent) */
  version1?: number;
  /** For compare_versions: second version to compare */
  version2?: number;
  /** Max versions to show in list_versions (default 20) */
  maxVersions?: number;
}

// ============================================================================
// TOOL CLASS
// ============================================================================

/**
 * 📜 VERSION HISTORY TOOL
 */
export class VersionHistoryTool implements vscode.LanguageModelTool<IVersionHistoryParameters> {
  
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IVersionHistoryParameters>,
    _token: vscode.CancellationToken
  ) {
    const { objectName, action = 'list_versions', versionNumber, version1, version2, connectionId } = options.input;
    
    if (!objectName || objectName.trim().length < 2) {
      throw new Error('objectName is required and must be at least 2 characters');
    }
    
    if (!connectionId) {
      throw new Error('connectionId is required');
    }
    
    if (action === 'get_version_source' && !versionNumber) {
      throw new Error('versionNumber is required for get_version_source action');
    }
    
    if (action === 'compare_versions' && (!version1 || !version2)) {
      throw new Error('version1 and version2 are required for compare_versions action');
    }

    let message = '';
    switch (action) {
      case 'get_version_source':
        message = `Getting source code at version #${versionNumber} for ${objectName}`;
        break;
      case 'compare_versions':
        message = `Comparing version #${version1} vs #${version2} of ${objectName}`;
        break;
      default:
        message = `Getting version history for ${objectName}`;
    }

    return {
      invocationMessage: message,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IVersionHistoryParameters>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    const { 
      objectName, 
      objectType, 
      connectionId, 
      action = 'list_versions',
      versionNumber,
      version1,
      version2,
      maxVersions = 20 
    } = options.input;
    
    logTelemetry("tool_version_history_called", { connectionId });

    try {
      // Find the object and get revisions
      const { revisions, objectInfo, client } = await this.getRevisions(objectName, objectType, connectionId);
      
      switch (action) {
        case 'get_version_source':
          return await this.getVersionSource(revisions, versionNumber!, objectName, objectInfo.type, client);
        
        case 'compare_versions':
          return await this.compareVersions(revisions, version1!, version2!, objectName, objectInfo.type, client);
        
        default:
          const limitedRevisions = revisions.slice(0, maxVersions);
          const resultText = this.formatVersionHistory(objectName, objectInfo.type, limitedRevisions, revisions.length);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(resultText)
          ]);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`❌ Failed to get version history: ${errorMessage}`)
      ]);
    }
  }

  /**
   * Get revisions for an object
   */
  private async getRevisions(objectName: string, objectType: string | undefined, connectionId: string) {
    const searcher = getSearchService(connectionId.toLowerCase());
    const types = objectType ? [objectType] : undefined;
    const searchResults = await searcher.searchObjects(objectName, types, 1);
    
    if (!searchResults || searchResults.length === 0) {
      throw new Error(`Could not find ABAP object: ${objectName}. Please check the object name and ensure it exists.`);
    }
    
    const objectInfo = searchResults[0];
    if (!objectInfo.uri) {
      throw new Error(`Could not get URI for ABAP object: ${objectName}.`);
    }

    const { getOrCreateRoot, getClient } = await import('../../adt/conections');
    const root = await getOrCreateRoot(connectionId.toLowerCase());
    const result = await root.findByAdtUri(objectInfo.uri, true);
    
    if (!result || !result.file) {
      throw new Error(`Could not resolve object: ${objectName}`);
    }

    const { isAbapFile } = await import('abapfs');
    if (!isAbapFile(result.file)) {
      throw new Error(`Not an ABAP file: ${objectName}`);
    }

    const obj = result.file.object;
    
    if (!obj.structure) {
      await obj.loadStructure();
    }

    if (!obj.structure) {
      throw new Error(`Could not load structure for: ${objectName}`);
    }

    const client = getClient(connectionId.toLowerCase());
    const { isAbapClassInclude } = await import('abapobject');
    
    let include: string | undefined;
    let structure = obj.structure;
    
    if (isAbapClassInclude(obj)) {
      include = obj.techName;
      structure = obj.parent?.structure || obj.structure;
    }

    const revisions = await client.revisions(structure, include as any);
    
    return { revisions, objectInfo, client };
  }

  /**
   * Get source code at a specific version
   */
  private async getVersionSource(
    revisions: Revision[], 
    versionNumber: number, 
    objectName: string, 
    objectType: string,
    client: any
  ): Promise<vscode.LanguageModelToolResult> {
    if (versionNumber < 1 || versionNumber > revisions.length) {
      throw new Error(`Version ${versionNumber} not found. Available versions: 1 to ${revisions.length}`);
    }
    
    const revision = revisions[versionNumber - 1]; // 1-based to 0-based
    
    if (!revision.uri) {
      throw new Error(`No source URI available for version ${versionNumber}`);
    }
    
    const source = await client.getObjectSource(revision.uri);
    
    const output = `📜 **Source at Version #${versionNumber}** of **${objectName}** (${objectType})\n\n` +
      `**Version Info:**\n` +
      `• **Date:** ${this.formatDate(revision.date)}\n` +
      `• **Author:** ${revision.author || 'Unknown'}\n` +
      `• **Transport:** ${revision.version || '-'}\n` +
      `• **Title:** ${revision.versionTitle || '-'}\n\n` +
      `**Source Code:**\n\`\`\`abap\n${source}\n\`\`\`\n\n` +
      `• **Lines:** ${source.split('\n').length}`;
    
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(output)
    ]);
  }

  /**
   * Compare two versions and show differences
   */
  private async compareVersions(
    revisions: Revision[],
    version1: number,
    version2: number,
    objectName: string,
    objectType: string,
    client: any
  ): Promise<vscode.LanguageModelToolResult> {
    if (version1 < 1 || version1 > revisions.length) {
      throw new Error(`Version ${version1} not found. Available versions: 1 to ${revisions.length}`);
    }
    if (version2 < 1 || version2 > revisions.length) {
      throw new Error(`Version ${version2} not found. Available versions: 1 to ${revisions.length}`);
    }
    if (version1 === version2) {
      throw new Error(`Cannot compare version ${version1} with itself`);
    }
    
    const rev1 = revisions[version1 - 1];
    const rev2 = revisions[version2 - 1];
    
    if (!rev1.uri || !rev2.uri) {
      throw new Error(`Source URIs not available for comparison`);
    }
    
    // Fetch both versions
    const [source1, source2] = await Promise.all([
      client.getObjectSource(rev1.uri),
      client.getObjectSource(rev2.uri)
    ]);
    
    const lines1 = source1.split('\n');
    const lines2 = source2.split('\n');
    
    // Simple diff - find added, removed, changed lines
    const diff = this.computeSimpleDiff(lines1, lines2);
    
    let output = `🔀 **Version Comparison for ${objectName}** (${objectType})\n\n`;
    output += `**Version #${version1}** (newer) vs **Version #${version2}** (older)\n\n`;
    
    output += `| | Version #${version1} | Version #${version2} |\n`;
    output += `|---|---|---|\n`;
    output += `| **Date** | ${this.formatDate(rev1.date)} | ${this.formatDate(rev2.date)} |\n`;
    output += `| **Author** | ${rev1.author || 'Unknown'} | ${rev2.author || 'Unknown'} |\n`;
    output += `| **Transport** | ${rev1.version || '-'} | ${rev2.version || '-'} |\n`;
    output += `| **Lines** | ${lines1.length} | ${lines2.length} |\n\n`;
    
    output += `**📊 Change Summary:**\n`;
    output += `• **Lines Added:** ${diff.added.length}\n`;
    output += `• **Lines Removed:** ${diff.removed.length}\n`;
    output += `• **Net Change:** ${lines1.length - lines2.length} lines\n\n`;
    
    if (diff.added.length > 0 || diff.removed.length > 0) {
      output += `**Changes:**\n`;
      
      if (diff.removed.length > 0) {
        output += `\n**➖ Removed (in version #${version2} but not in #${version1}):**\n`;
        output += `\`\`\`diff\n`;
        for (const line of diff.removed.slice(0, 20)) {
          output += `- ${line}\n`;
        }
        if (diff.removed.length > 20) {
          output += `... and ${diff.removed.length - 20} more removed lines\n`;
        }
        output += `\`\`\`\n`;
      }
      
      if (diff.added.length > 0) {
        output += `\n**➕ Added (in version #${version1} but not in #${version2}):**\n`;
        output += `\`\`\`diff\n`;
        for (const line of diff.added.slice(0, 20)) {
          output += `+ ${line}\n`;
        }
        if (diff.added.length > 20) {
          output += `... and ${diff.added.length - 20} more added lines\n`;
        }
        output += `\`\`\`\n`;
      }
    } else {
      output += `\n✅ **No differences found** - the versions are identical.\n`;
    }
    
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(output)
    ]);
  }

  /**
   * Simple line-based diff
   */
  private computeSimpleDiff(lines1: string[], lines2: string[]): { added: string[]; removed: string[] } {
    const set1 = new Set(lines1.map(l => l.trim()).filter(l => l.length > 0));
    const set2 = new Set(lines2.map(l => l.trim()).filter(l => l.length > 0));
    
    const added: string[] = [];
    const removed: string[] = [];
    
    // Lines in version1 but not in version2 = added
    for (const line of set1) {
      if (!set2.has(line)) {
        added.push(line);
      }
    }
    
    // Lines in version2 but not in version1 = removed
    for (const line of set2) {
      if (!set1.has(line)) {
        removed.push(line);
      }
    }
    
    return { added, removed };
  }

  private formatVersionHistory(
    objectName: string, 
    objectType: string,
    revisions: Array<{ uri: string; date: string; author: string; version: string; versionTitle: string }>,
    totalCount: number
  ): string {
    if (revisions.length === 0) {
      return `📜 **Version History for ${objectName}** (${objectType})\n\n⚠️ No version history available for this object.`;
    }

    let output = `📜 **Version History for ${objectName}** (${objectType})\n\n`;
    output += `**Total Versions:** ${totalCount}${revisions.length < totalCount ? ` (showing ${revisions.length})` : ''}\n\n`;
    
    output += `| # | Date | Author | Transport | Title |\n`;
    output += `|---|------|--------|-----------|-------|\n`;
    
    for (let i = 0; i < revisions.length; i++) {
      const rev = revisions[i];
      const date = this.formatDate(rev.date);
      const version = rev.version || '-';
      const versionTitle = rev.versionTitle || '-';
      const author = rev.author || 'Unknown';
      
      output += `| ${i + 1} | ${date} | ${author} | ${version} | ${versionTitle} |\n`;
    }
    
    output += `\n**Summary:**\n`;
    
    const authors = [...new Set(revisions.map(r => r.author).filter(Boolean))];
    output += `• **Contributors:** ${authors.length > 0 ? authors.join(', ') : 'Unknown'}\n`;
    
    if (revisions.length > 0) {
      const oldestDate = this.formatDate(revisions[revisions.length - 1].date);
      const newestDate = this.formatDate(revisions[0].date);
      output += `• **Date Range:** ${oldestDate} → ${newestDate}\n`;
    }
    
    const recentRevisions = revisions.filter(r => {
      const revDate = new Date(r.date);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return revDate > thirtyDaysAgo;
    });
    
    if (recentRevisions.length > 0) {
      output += `• **Recent Changes (30 days):** ${recentRevisions.length} version(s)\n`;
    }
    
    output += `\n💡 **Tip:** Use \`action: 'get_version_source'\` with \`versionNumber\` to get code at a specific version, or \`action: 'compare_versions'\` with \`version1\` and \`version2\` to compare.`;

    return output;
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return 'Unknown';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  }
}

// ============================================================================
// REGISTRATION
// ============================================================================

export function registerVersionHistoryTool(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.lm.registerTool('get_version_history', new VersionHistoryTool())
  );
}
