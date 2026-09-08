export type UpgradeNotificationButton = {
  text: string
  url: string
}

export type UpgradeNotificationFeature = {
  id: string
  message: string
  buttons?: UpgradeNotificationButton[]
}

const DOCS_URL = "https://marcellourbani.github.io/vscode_abap_remote_fs"

function docsButton(text: string, path: string): UpgradeNotificationButton[] {
  return [{ text, url: `${DOCS_URL}/${path}/` }]
}

export const UPGRADE_NOTIFICATION_FEATURES: UpgradeNotificationFeature[] = [
  {
    id: "testing",
    message: "ABAP FS can now help you test ABAP reports and transactions!",
    buttons: docsButton("Learn about SAP UI Testing", "sap-testing")
  },
  {
    id: "data-workbooks",
    message:
      "ABAP FS: Analyze and compare SAP data with reusable ABAP SQL and JavaScript workbooks.",
    buttons: docsButton("Explore SAP Data Workbooks", "data-query/data-workbooks")
  },
  {
    id: "repl",
    message: "ABAP FS: Run ABAP snippets on development and test systems directly from VS Code.",
    buttons: docsButton("Learn about ABAP REPL", "developer-tools/abap-repl")
  },
  {
    id: "debug-recording",
    message: "ABAP FS: Record ABAP debug sessions and replay them forward or backward",
    buttons: docsButton("Explore Debug Replay", "debugging/debug-recording")
  },
  {
    id: "compare-systems",
    message: "ABAP FS: Compare the same ABAP object across two SAP systems",
    buttons: docsButton("How?", "object-management/compare-systems")
  },
  {
    id: "heartbeat",
    message: "ABAP FS: Let AI monitor SAP systems and notify you when something needs attention.",
    buttons: docsButton("Explore Heartbeat", "ai/heartbeat")
  },
  {
    id: "subagents",
    message:
      "ABAP FS: Use specialized ABAP agents for focused work and more efficient model usage.",
    buttons: docsButton("Explore Subagents", "ai/subagents")
  },
  {
    id: "abap-cleaner",
    message: "ABAP FS: Format and modernize ABAP code in VS Code with ABAP Cleaner.",
    buttons: docsButton("ABAP Cleaner Guide", "code-quality/abap-cleaner")
  },
  {
    id: "atc",
    message: "ABAP FS: Run SAP ATC checks and work with findings directly in VS Code.",
    buttons: docsButton("Explore ATC", "code-quality/atc-analysis")
  },
  {
    id: "dependency-graph",
    message: "ABAP FS: Explore where ABAP objects are used with an interactive dependency graph.",
    buttons: docsButton("Learn about Dependency Graphs", "developer-tools/dependency-graph")
  },
  {
    id: "feed-reader",
    message: "ABAP FS: Monitor SAP dumps, ATC findings, and system messages in one feed inbox.",
    buttons: docsButton("Explore Feed Reader", "developer-tools/feed-reader")
  },
  {
    id: "rap-generator",
    message: "ABAP FS: Generate a complete RAP service from a database table in one workflow.",
    buttons: docsButton("Explore RAP Generator", "developer-tools/rap-generator")
  },
  {
    id: "s4hana-readiness",
    message:
      "ABAP FS: Review custom code affected by an S/4HANA migration from a dedicated dashboard.",
    buttons: docsButton("Explore S/4HANA Readiness", "developer-tools/s4hana-readiness")
  },
  {
    id: "run-transaction",
    message: "ABAP FS: Open SAP transactions directly in VS Code",
    buttons: docsButton("How?", "sap-gui/run-transaction")
  },
  {
    id: "blame-gutter",
    message: "ABAP FS: See who last changed each ABAP line, including its date and transport.",
    buttons: docsButton("Explore Blame Gutter", "version-control/blame-gutter")
  }
]
