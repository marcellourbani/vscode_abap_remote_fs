import type { ClientApp } from '@agentclientprotocol/sdk';

import { FileSystemHandler } from '../handlers/FileSystemHandler';
import { TerminalHandler } from '../handlers/TerminalHandler';
import { PermissionHandler } from '../handlers/PermissionHandler';
import { ElicitationHandler } from '../handlers/ElicitationHandler';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { log } from '../utils/Logger';

/**
 * Registers ACP request and notification handlers for VS Code.
 */
export class AcpClientImpl {
  constructor(
    private readonly fsHandler: FileSystemHandler,
    private readonly terminalHandler: TerminalHandler,
    private readonly permissionHandler: PermissionHandler,
    private readonly elicitationHandler: ElicitationHandler,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
  ) {}

  register(app: ClientApp): void {
    app
      .onRequest('session/request_permission', ({ params }) =>
        this.permissionHandler.requestPermission(params),
      )
      .onRequest('fs/write_text_file', ({ params }) => {
        log(`Client.writeTextFile: ${params.path}`);
        return this.fsHandler.writeTextFile(params);
      })
      .onRequest('fs/read_text_file', ({ params }) => {
        log(`Client.readTextFile: ${params.path}`);
        return this.fsHandler.readTextFile(params);
      })
      .onRequest('terminal/create', ({ params }) =>
        this.terminalHandler.createTerminal(params),
      )
      .onRequest('terminal/output', ({ params }) =>
        this.terminalHandler.terminalOutput(params),
      )
      .onRequest('terminal/wait_for_exit', ({ params }) =>
        this.terminalHandler.waitForTerminalExit(params),
      )
      .onRequest('terminal/kill', ({ params }) =>
        this.terminalHandler.killTerminal(params),
      )
      .onRequest('terminal/release', ({ params }) =>
        this.terminalHandler.releaseTerminal(params),
      )
      .onRequest('elicitation/create', ({ params }) =>
        this.elicitationHandler.createElicitation(params),
      )
      .onNotification('session/update', ({ params }) =>
        this.sessionUpdateHandler.handleUpdate(params),
      );
  }
}
