import { ProgressLocation, workspace } from 'vscode';
import { funWindow as window } from '../services/funMessenger';
import { getOrCreateClient } from '../adt/conections';
import { pickAdtRoot } from '../config';

export async function listAdtFeedsCommand() {
  try {
    // Let user pick a connection
    const fsRoot = await pickAdtRoot();
    if (!fsRoot) {
      return; // User cancelled
    }
    const connId = fsRoot.uri.authority;

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: `Discovering ADT feeds on ${connId}...`,
        cancellable: true
      },
      async (progress) => {
        const client = await getOrCreateClient(connId);
        const feeds = await client.feeds();

        if (!feeds || feeds.length === 0) {
          window.showInformationMessage(`No ADT feeds found on ${connId}`);
          return;
        }

        // Format the feeds information
        let output = `📡 **ADT Feeds Available on ${connId}**\n\n`;
        output += `Found ${feeds.length} feed(s)\n`;
        output += `${'='.repeat(80)}\n\n`;

        feeds.forEach((feed, index) => {
          output += `**Feed ${index + 1}: ${feed.title}**\n`;
          output += `  Path: ${feed.href}\n`;
          output += `  Summary: ${feed.summary}\n`;
          output += `  Author: ${feed.author}\n`;
          output += `  Last Updated: ${feed.updated.toLocaleString()}\n`;
          
          if (feed.refresh) {
            output += `  Refresh Interval: ${feed.refresh.value} ${feed.refresh.unit}\n`;
          }
          
          if (feed.paging) {
            output += `  Page Size: ${feed.paging} entries\n`;
          }
          
          if (feed.queryIsObligatory) {
            output += `  ⚠️  Query Required: Yes\n`;
          }
          
          if (feed.queryVariants && feed.queryVariants.length > 0) {
            output += `  Query Variants:\n`;
            feed.queryVariants.forEach(qv => {
              output += `    - ${qv.title}${qv.isDefault ? ' (default)' : ''}\n`;
              if (qv.queryString) {
                output += `      Query: ${qv.queryString}\n`;
              }
            });
          }
          
          if (feed.attributes && feed.attributes.length > 0) {
            output += `  Filterable Attributes: ${feed.attributes.map(a => a.label).join(', ')}\n`;
          }
          
          output += `\n`;
        });

        // Show in a new document
        const doc = await window.showTextDocument(
          await workspace.openTextDocument({
            content: output,
            language: 'markdown'
          }),
          { preview: false }
        );

        window.showInformationMessage(
          `✅ Found ${feeds.length} ADT feed(s) on ${connId}`,
          'OK'
        );
      }
    );
  } catch (error) {
    window.showErrorMessage(`Failed to list ADT feeds: ${error}`);
  }
}

