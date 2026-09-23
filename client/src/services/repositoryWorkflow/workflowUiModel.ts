import { RepositoryWorkflow, WorkflowStepId } from "./types"

export const REPOSITORY_OBJECT_TYPES = [
  ["PROG", "Programs and includes"],
  ["CLAS", "Classes"],
  ["INTF", "Interfaces"],
  ["FUGR", "Function groups"],
  ["TABL", "Tables and structures"],
  ["DTEL", "Data elements"],
  ["DOMA", "Domains"],
  ["TTYP", "Table types"],
  ["VIEW", "Dictionary views"],
  ["SHLP", "Search helps"],
  ["ENQU", "Lock objects"],
  ["DDLS", "CDS data definitions"],
  ["DCLS", "CDS access controls"],
  ["DDLX", "CDS metadata extensions"],
  ["BDEF", "Behavior definitions"],
  ["SRVD", "Service definitions"],
  ["SRVB", "Service bindings"],
  ["MSAG", "Message classes"],
  ["TRAN", "Transactions"],
  ["ENHO", "Enhancement implementations"],
  ["ENHS", "Enhancement spots"],
  ["SXSD", "BAdI definitions"],
  ["SXCI", "BAdI implementations"],
  ["XSLT", "Transformations"],
  ["NROB", "Number ranges"],
  ["SUSO", "Authorization objects"],
  ["SUSC", "Authorization object classes"],
  ["PINF", "Package interfaces"],
  ["SICF", "ICF services"],
  ["WDYN", "Web Dynpro components"],
  ["SPRX", "Proxies"],
  ["JOBD", "Job definitions"]
].map(([value, label]) => ({ value, label }))

const PREREQUISITES: Partial<Record<WorkflowStepId, WorkflowStepId>> = {
  discovery: "criteria",
  existenceComparison: "discovery",
  sourceSelection: "existenceComparison",
  sourceDownload: "sourceSelection",
  sourceComparison: "sourceDownload",
  assistedApplyPlan: "sourceComparison"
}

export function assertWorkflowStepReady(workflow: RepositoryWorkflow, step: WorkflowStepId): void {
  const prerequisite = PREREQUISITES[step]
  if (prerequisite && workflow.steps[prerequisite].status !== "complete") {
    throw new Error(`Complete ${displayStep(prerequisite)} before ${displayStep(step)}.`)
  }
}

export function commandSection(command: string): string {
  if (["saveCriteria", "runDiscovery", "resumeDiscovery"].includes(command)) return "discovery"
  if (command === "compareExistence") return "existenceComparison"
  if (
    ["selectSources", "downloadSources", "compareSourceCode", "resumeSourceComparison"].includes(
      command
    )
  )
    return "sourceComparison"
  if (["compareSources", "openDiff"].includes(command)) return "sourceComparison"
  if (
    [
      "prepareAssistedApply",
      "openAssistedSource",
      "openAssistedTarget",
      "openAssistedDiff",
      "stageAssistedSource",
      "openAutoSaveSettings",
      "openChatSaveSettings"
    ].includes(command)
  )
    return "assistedApply"
  return "home"
}

function displayStep(step: WorkflowStepId): string {
  return {
    criteria: "scope criteria",
    discovery: "repository discovery",
    existenceComparison: "existence comparison",
    sourceSelection: "source selection",
    sourceDownload: "source download",
    sourceComparison: "local source comparison",
    assistedApplyPlan: "assisted-apply plan"
  }[step]
}
