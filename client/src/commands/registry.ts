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
  rename: "abapfs.rename",
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
  // classes
  refreshHierarchy: "abapfs.refreshHierarchy",
  pickObject: "abapfs.pickObject",
  pickAdtRootConn: "abapfs.pickAdtRootConn",
  runClass: "abapfs.runClass",
  // revisions
  clearScmGroup: "abapfs.clearScmGroup",
  openrevstate: "abapfs.openrevstate",
  opendiff: "abapfs.opendiff",
  opendiffNormalized: "abapfs.opendiffNormalized",
  changequickdiff: "abapfs.changequickdiff",
  remotediff: "abapfs.remotediff",
  comparediff: "abapfs.comparediff",
  // transports
  transportObjectDiff: "abapfs.transportObjectDiff",
  openTransportObject: "abapfs.openTransportObject",
  deleteTransport: "abapfs.deleteTransport",
  refreshtransports: "abapfs.refreshtransports",
  releaseTransport: "abapfs.releaseTransport",
  transportOwner: "abapfs.transportOwner",
  transportAddUser: "abapfs.transportAddUser",
  transportRevision: "abapfs.transportRevision",
  transportUser: "abapfs.transportUser",
  transportCopyNumber: "abapfs.transportCopyNumber",
  transportOpenGui: "abapfs.transportOpenGui",
  // debugger
  goToCursor: "abapfs.goToCursor",
  continueToCursor: "abapfs.continueToCursor",
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
