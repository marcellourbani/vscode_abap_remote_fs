import * as vscode from "vscode"

export interface SkillDefinition {
  id: string
  displayName: string
  description: string
  path: string
}

export interface SkillSettings {
  enabledSkills: Record<string, boolean>
}

export const GENERAL_SKILL_REGISTRY: readonly SkillDefinition[] = [
  {
    id: "clean-abap",
    displayName: "Clean ABAP",
    description: "Style and maintainability guidance for Clean ABAP reviews.",
    path: "skills/clean-abap/SKILL.md"
  },
  {
    id: "abap-code-writing",
    displayName: "ABAP Code Writing",
    description: "Structured process for building ABAP solutions.",
    path: "skills/abap-code-writing/SKILL.md"
  },
  {
    id: "abap-performance-ecc",
    displayName: "ABAP Performance for ECC",
    description: "Performance practices for traditional SAP databases.",
    path: "skills/abap-performance-ecc/SKILL.md"
  },
  {
    id: "abap-performance-hana",
    displayName: "ABAP Performance for HANA",
    description: "Performance practices for SAP HANA systems.",
    path: "skills/abap-performance-hana/SKILL.md"
  },
  {
    id: "abap-code-review-helper",
    displayName: "ABAP Code Review Helper",
    description: "Primary correctness and runtime-safety review guidance for ABAP code.",
    path: "skills/abap-code-review-helper/SKILL.md"
  },
  {
    id: "abap-research",
    displayName: "ABAP Research",
    description: "Systematic techniques for finding SAP objects and behavior.",
    path: "skills/abap-research/SKILL.md"
  },
  {
    id: "sap-system-personality-report",
    displayName: "SAP System Personality Report",
    description: "Analyzes a connected SAP system and its custom code landscape.",
    path: "skills/sap-system-personality-report/SKILL.md"
  },
  {
    id: "sap-customizing",
    displayName: "SAP Customizing",
    description: "Traces SPRO and IMG settings to their configuration data.",
    path: "skills/sap-customizing/SKILL.md"
  },
  {
    id: "sap-data-workbook",
    displayName: "SAP Data Workbook",
    description: "Creates workbooks for multi-step SAP data analysis.",
    path: "skills/sap-data-workbook/SKILL.md"
  },
  {
    id: "adt-api-discovery",
    displayName: "ADT API Discovery",
    description: "Investigates SAP ADT REST API endpoints and payloads.",
    path: "skills/adt-api-discovery/SKILL.md"
  },
  {
    id: "sap-background-jobs",
    displayName: "SAP Background Jobs",
    description: "Investigates SAP background jobs, logs, and failures.",
    path: "skills/sap-background-jobs/SKILL.md"
  }
]

export const DEFAULT_ENABLED_SKILLS: Record<string, boolean> = Object.fromEntries(
  GENERAL_SKILL_REGISTRY.map(skill => [skill.id, true])
)

export function getSkillSettings(): SkillSettings {
  const configuredSkills = vscode.workspace
    .getConfiguration("abapfs.skills")
    .get<Record<string, boolean>>("enabledSkills", {})
  return {
    enabledSkills: { ...DEFAULT_ENABLED_SKILLS, ...configuredSkills }
  }
}

export function skillContextKey(skillId: string): `abapfs:skill.${string}.enabled` {
  return `abapfs:skill.${skillId}.enabled`
}

export async function syncSkillContexts(): Promise<void> {
  const { enabledSkills } = getSkillSettings()
  await Promise.all(
    GENERAL_SKILL_REGISTRY.map(skill =>
      vscode.commands.executeCommand(
        "setContext",
        skillContextKey(skill.id),
        enabledSkills[skill.id] !== false
      )
    )
  )
}
