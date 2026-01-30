import { TransportsProvider } from "./views/transports"
import { FavouritesProvider } from "./views/favourites"
import { atcProvider, registerSCIDecorator } from "./views/abaptestcockpit"
import { FsProvider } from "./fs/FsProvider"
import {
  window,
  workspace,
  ExtensionContext,
  languages,
  commands,
} from "vscode"
import {
  activeTextEditorChangedListener,
  documentChangedListener,
  documentClosedListener,
  documentWillSave,
  restoreLocks
} from "./listeners"
import { PasswordVault, log } from "./lib"
import { LanguageCommands } from "./langClient"
import { registerRevisionModel, AbapRevisionLens } from "./scm/abaprevisions"
import { ClassHierarchyLensProvider } from "./adt/classhierarchy"
import { abapGitProvider } from "./views/abapgit"
import { loadTokens, clearTokens } from "./oauth"
import { registerAbapGit } from "./scm/abapGit"
import { AbapFsApi, api } from "./api"
import { ADTSCHEME, disconnect, hasLocks } from "./adt/conections"
import { MessagesProvider } from "./editors/messages"
import { IncludeProvider } from "./adt/includes"
import { registerCommands } from "./commands/register"
import { HttpProvider } from "./editors/httpprovider"
import { dumpProvider } from "./views/dumps/dumps"
import { registerAbapDebugger } from "./adt/debugger"
import { ATCDocumentation } from "./views/abaptestcockpit/documentation"
import { tracesProvider } from "./views/traces"
import { FeedStateManager } from "./services/feeds/feedStateManager"
import { FeedPollingService } from "./services/feeds/feedPollingService"
import { initializeFeedInboxProvider } from "./views/feeds/feedInboxView"
import { setContext } from "./context"
import { AbapHoverProviderV2 } from "./providers/hoverProvider"
import { registerAllTools } from "./services/lm-tools"
import { registerCleanerCommands, setupCleanerContextMonitoring } from "./services/cleanerCommands"
import { TelemetryService } from "./services/telemetry"
import { AppInsightsService } from "./services/appInsightsService"
import { MermaidWebviewManager } from './services/MermaidWebviewManager'
import { DiagramWebviewManager } from './services/DiagramWebviewManager'
import { SapSystemValidator } from "./services/sapSystemValidator"
// Import commands to ensure @command decorators are executed
import "./commands"
export let context: ExtensionContext

// Feed polling service instance (module-level for deactivation)
let feedPollingServiceInstance: FeedPollingService | undefined;


export async function activate(ctx: ExtensionContext): Promise<AbapFsApi> {
  context = ctx
  const startTime = new Date().getTime()
  log("🚀 Buckle up buttercup, ABAP FS is waking up from its slumber...")
  
  // 📊 Initialize Telemetry Services FIRST
  try {
    TelemetryService.initialize(ctx)
    log("📊 Local Telemetry Service initialized - We promise we're not spying... much 👀")
    
    // Initialize App Insights
    AppInsightsService.getInstance(ctx)
    log("📊 App Insights ready to count your clicks (for science!)")
  } catch (error) {
    log(`❌ Telemetry Services said 'nope': ${error} (honestly, probably for the best 🤷)`)
  }
  
  // 🔐 Initialize SAP System Validator FIRST (before any client connections)
  try {
    log("🔐 SAP System Validator entering the chat... *cracks knuckles*");
    const validator = SapSystemValidator.getInstance();
    await validator.initialize();
    log("✅ SAP System Validator ready to judge your systems mercilessly");
  } catch (error) {
    log(`❌ SAP System Validator threw a tantrum: ${error} (it's fine, everything is fine 🔥)`);
    // Continue activation even if validator fails - will block all connections except backup whitelist if configured
  }
  
  new PasswordVault(ctx)
  loadTokens()
  clearTokens()
  const sub = context.subscriptions
  
  // ABAP Intelligence Integration - Start
  try {
    log('🧠 ABAP Intelligence features booting up... *elevator music plays*');
      
      // Initialize hover provider
      const hoverProvider = new AbapHoverProviderV2(log);

      // Register language providers for ABAP
      const abapSelector = { language: 'abap', scheme: 'file' };
      const adtSelector = { language: 'abap', scheme: ADTSCHEME };
      
      sub.push(
        languages.registerHoverProvider([abapSelector, adtSelector], hoverProvider)
      );

      log('✅ ABAP Hover Provider ready to whisper sweet nothings about your code');

    // Register List ADT Feeds command
    const { listAdtFeedsCommand } = await import('./commands/listAdtFeeds');
    context.subscriptions.push(
      commands.registerCommand('abapfs.listAdtFeeds', listAdtFeedsCommand)
    );
          
      const { copilotLogger } = require('./services/abapCopilotLogger');
      copilotLogger.info('Extension', 'ABAP FS logging initialized - Ready to document your debugging adventures 🗺️');
           
      // Initialize the MermaidWebviewManager singleton
      MermaidWebviewManager.initialize(context.extensionUri);
      
      // Initialize the DiagramWebviewManager singleton
      DiagramWebviewManager.initialize(context.extensionUri);
      log('🧜‍♀️ Mermaid Webview Manager ready to make your diagrams prettier than your code');
      
      // Register Language Model Tools for proper AI integration (includes Mermaid tools)
      await registerAllTools(context);
           
      // Register ABAP Cleaner feature
      registerCleanerCommands(context);
      setupCleanerContextMonitoring(context);
      
      // Initialize MCP Server for external AI clients (Cursor, etc.)
      const { initializeMcpServer } = await import('./services/mcpServer');
      await initializeMcpServer(context);
      
      log('🚀 ABAP FS services are GO! Houston, we have liftoff! 🌙');
      // ABAP FS Integration - End
  } catch (error) {
    log(`❌ ABAP Intelligence features had an existential crisis: ${error}`);
    console.error('❌ Failed to activate ABAP Intelligence features:', error);
    window.showErrorMessage(`Failed to activate ABAP Intelligence features: ${error}`);
  }
  // ABAP Intelligence Integration - End
  
  // register the filesystem type
  sub.push(
    workspace.registerFileSystemProvider(ADTSCHEME, FsProvider.get(ctx), {
      isCaseSensitive: true
    })
  )

  // change document listener, for locking
  sub.push(workspace.onDidChangeTextDocument(documentChangedListener))
  sub.push(workspace.onWillSaveTextDocument(documentWillSave))
  // closed document listener, for locking
  sub.push(workspace.onDidCloseTextDocument(documentClosedListener))
  // Editor changed listener, updates context and icons
  sub.push(window.onDidChangeActiveTextEditor(activeTextEditorChangedListener))


  registerRevisionModel(context)

  const fav = FavouritesProvider.get()
  fav.storagePath = context.globalStoragePath
  sub.push(window.registerTreeDataProvider("abapfs.favorites", fav))
  sub.push(
    window.registerTreeDataProvider(
      "abapfs.transports",
      TransportsProvider.get()
    )
  )
  sub.push(window.registerTreeDataProvider("abapfs.abapgit", abapGitProvider))
  sub.push(window.registerTreeDataProvider("abapfs.dumps", dumpProvider))
  sub.push(window.registerTreeDataProvider("abapfs.atcFinds", atcProvider))
  sub.push(window.registerTreeDataProvider("abapfs.traces", tracesProvider))
  
  // Initialize Feed State Manager and Polling Service
  const feedStateManager = new FeedStateManager(context)
  feedPollingServiceInstance = new FeedPollingService(context, feedStateManager)
  const feedInboxProvider = initializeFeedInboxProvider(feedStateManager)
  sub.push(window.registerTreeDataProvider("abapfs.feedInbox", feedInboxProvider))
  
  // Connect polling service to tree view for refresh
  feedPollingServiceInstance.setOnEntriesChanged(() => {
    feedInboxProvider.refresh()
  })
  
  // Start feed polling service
  await feedPollingServiceInstance.start()
  
  // Register feed inbox commands
  sub.push(commands.registerCommand('abapfs.refreshFeedInbox', () => {
    feedInboxProvider.refresh()
  }))
  
  sub.push(commands.registerCommand('abapfs.showFeedInbox', (options?: { systemId?: string; feedTitle?: string }) => {
    feedInboxProvider.showFeedInbox(options)
  }))
  
  sub.push(commands.registerCommand('abapfs.markAllFeedsRead', () => {
    feedInboxProvider.markAllAsRead()
  }))
  
  sub.push(commands.registerCommand('abapfs.markFeedFolderRead', (node: any) => {
    feedInboxProvider.markFeedFolderAsRead(node)
  }))
  
  sub.push(commands.registerCommand('abapfs.deleteFeedEntry', (node: any) => {
    feedInboxProvider.deleteFeedEntry(node)
  }))
  
  sub.push(commands.registerCommand('abapfs.clearFeedFolder', (node: any) => {
    feedInboxProvider.clearFeedFolder(node)
  }))
  
  sub.push(commands.registerCommand('abapfs.viewFeedEntry', (node: any) => {
    feedInboxProvider.viewFeedEntry(node)
  }))
  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      ClassHierarchyLensProvider.get()
    )
  )
  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      AbapRevisionLens.get()
    )
  )

  sub.push(
    languages.registerCodeLensProvider(
      { language: "abap", scheme: ADTSCHEME },
      IncludeProvider.get()
    )
  )

  sub.push(window.registerWebviewViewProvider(ATCDocumentation.viewType, ATCDocumentation.get()))

  sub.push(MessagesProvider.register(context))
  sub.push(HttpProvider.register(context))
  registerAbapDebugger(context)

  LanguageCommands.start(context)

  setContext("abapfs:extensionActive", true)
  restoreLocks()
  registerAbapGit(context)

  registerCommands(context)

  // 📊 Register Dependency Graph Command
  try {
    const { visualizeDependencyGraph } = await import('./services/dependencyGraph');
    context.subscriptions.push(
      commands.registerCommand('abapfs.visualizeDependencyGraph', visualizeDependencyGraph)
    );
    log('📊 Dependency graph ready to expose your spaghetti architecture 🍝');
  } catch (error) {
    log(`⚠️ Dependency graph said 'I can\'t even': ${error}`);
  }

  registerSCIDecorator(context)
  
  // 🎯 Initialize Enhancement Decorations
  try {
    const { initializeEnhancementDecorations } = await import('./views/enhancementDecorations');
    initializeEnhancementDecorations(context);
    log('🎯 Enhancement decorations initialized - Making your code look fancy since 2024');
  } catch (error) {
    log(`⚠️ Enhancement decorations refused to cooperate: ${error} (they're artists, they're temperamental)`);
  }
  
  return api
}

// this method is called when your extension is deactivated
// it's important to kill these sessions as there might be an open process on the abap side
// most commonly because of locked sources.
// Locks will not be released until either explicitly closed or the session is terminates
// an open session can leave sources locked without any UI able to release them (except SM12 and the like)
export async function deactivate() {
  if (hasLocks())
    window.showInformationMessage(
      "Locks will be dropped now. If the relevant editors are still open they will be restored later"
    )
  setContext("abapfs:extensionActive", false)
  
  // Stop feed polling service
  if (feedPollingServiceInstance) {
    feedPollingServiceInstance.stop()
    log("📰 Feed polling service stopped - No more news is good news, right?")
  }
  
  // Clear SAP system info cache
  try {
    const { clearSystemInfoCache } = await import('./services/sapSystemInfo')
    clearSystemInfoCache()
    log("🧹 SAP system info cache cleared - It's like it never happened *whistles innocently*")
  } catch (e) {
    // Ignore - service may not be loaded
  }
  
  return disconnect()
}
