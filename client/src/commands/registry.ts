export const AbapFsCommands = {
  connect: "abapfs.connect",
  activate: "abapfs.activate",
  search: "abapfs.search",
  create: "abapfs.create",
  execute: "abapfs.execute",
  runInGui: "abapfs.runInGui",
  unittest: "abapfs.unittest",
  createtestinclude: "abapfs.createtestinclude",
  quickfix: "abapfs.quickfix",
  changeInclude: "abapfs:changeInclude",
  showDocumentation: "abapfs.showdocu",
  selectDB: "abapfs.selectDB",
  showObject: "abapfs.showObject",
  clearPassword: "abapfs.clearPassword",
  addfavourite: "abapfs.addfavourite",
  deletefavourite: "abapfs.deletefavourite",
  createConnection: "abapfs.createConnection",
  showDump: "abapfs.showDump",
  refreshDumps: "abapfs.refreshDumps",
  tableContents: "abapfs.tableContents",
  exportToJson: "abapfs.exportToJson",
  // atc
  atcChecks: "abapfs.atcChecks",
  atcIgnore: "abapfs.atcIgnore",
  atcRefresh: "abapfs.atcRefresh",
  atcRequestExemption: "abapfs.atcRequestExemption",
  atcRequestExemptionAll: "abapfs.atcRequestExemptionAll",
  atcShowDocumentation: "abapfs.atcShowDocumentation",
  atcAutoRefreshOn: "abapfs.atcAutoRefreshOn",
  atcAutoRefreshOff: "abapfs.atcAutoRefreshOff",
  atcDocHistoryForward: "abapfs.atcDocHistoryForward",
  atcDocHistoryBack: "abapfs.atcDocHistoryBack",
  atcFilterExemptOn: "abapfs.atcFilterExemptOn",
  atcFilterExemptOff: "abapfs.atcFilterExemptOff",
  // classes
  refreshHierarchy: "abapfs.refreshHierarchy",
  pickObject: "abapfs.pickObject",
  pickAdtRootConn: "abapfs.pickAdtRootConn",
  runClass: "abapfs.runClass",
  // revisions
  clearScmGroup: "abapfs.clearScmGroup",
  filterScmGroup: "abapfs.filterScmGroup",
  openrevstate: "abapfs.openrevstate",
  opendiff: "abapfs.opendiff",
  opendiffNormalized: "abapfs.opendiffNormalized",
  changequickdiff: "abapfs.changequickdiff",
  remotediff: "abapfs.remotediff",
  comparediff: "abapfs.comparediff",
  mergeEditor: "abapfs.openMergeEditor",
  // transports
  transportObjectDiff: "abapfs.transportObjectDiff",
  openTransportObject: "abapfs.openTransportObject",
  openLocation: "abapfs.openLocation",
  deleteTransport: "abapfs.deleteTransport",
  refreshtransports: "abapfs.refreshtransports",
  releaseTransport: "abapfs.releaseTransport",
  transportOwner: "abapfs.transportOwner",
  transportAddUser: "abapfs.transportAddUser",
  transportRevision: "abapfs.transportRevision",
  transportUser: "abapfs.transportUser",
  transportCopyNumber: "abapfs.transportCopyNumber",
  transportRunAtc: "abapfs.transportRunAtc",
  transportOpenGui: "abapfs.transportOpenGui",
  // abapgit
  agitRefreshRepos: "abapfs.refreshrepos",
  agitReveal: "abapfs.revealPackage",
  agitOpenRepo: "abapfs.openRepo",
  agitPull: "abapfs.pullRepo",
  agitCreate: "abapfs.createRepo",
  agitUnlink: "abapfs.unlinkRepo",
  agitAddScm: "abapfs.registerSCM",
  agitRefresh: "abapfs.refreshAbapGit",
  agitPullScm: "abapfs.pullAbapGit",
  agitPush: "abapfs.pushAbapGit",
  agitAdd: "abapfs.addAbapGit",
  agitRemove: "abapfs.removeAbapGit",
  agitresetPwd: "abapfs.resetAbapGitPwd",
  agitBranch: "abapfs.switchBranch"
}

export const abapcmds: {
  name: string
  func: (...x: any[]) => any
  target: any
}[] = []

export const command = (name: string) => (target: any, propertyKey: string) => {
  const func = target[propertyKey]
  abapcmds.push({ name, target, func })
}
