export interface SubagentDefinition {
  id: string
  fileName: string
  displayName: string
  guidance: string
}

export const SUBAGENT_REGISTRY: readonly SubagentDefinition[] = [
  {
    id: "sap-code-grep",
    fileName: "sap-code-grep.agent.md",
    displayName: "Code Grep",
    guidance:
      "Mechanical local-source counting. Prefer the smallest fast model that reliably follows strict output formats."
  },
  {
    id: "sap-source-download",
    fileName: "sap-source-download.agent.md",
    displayName: "Source Download",
    guidance:
      "Tool-driven source discovery and download verification. Prefer a small, inexpensive model with dependable tool use."
  },
  {
    id: "anst-enhancement-analyser",
    fileName: "anst-enhancement-analyser.agent.md",
    displayName: "ANST Enhancement Analyser",
    guidance:
      "Classifies ANST results and researches enhancement behavior. Prefer a capable small or mid-tier model with strong tool use."
  },
  {
    id: "sap-enhancement-research",
    fileName: "sap-enhancement-research.agent.md",
    displayName: "Enhancement Research",
    guidance:
      "Recursive SAP enhancement research needs careful reasoning. Prefer a capable mid-tier model rather than the cheapest option."
  },
  {
    id: "sap-findings-reviewer",
    fileName: "sap-findings-reviewer.agent.md",
    displayName: "Findings Reviewer",
    guidance:
      "Adversarial Phase 1 review that re-reads the source to catch fabricated line numbers, missed statements, and un-analysed logic. Use a strong model from a different family than the main agent."
  },
  {
    id: "sap-screens-reviewer",
    fileName: "sap-screens-reviewer.agent.md",
    displayName: "Screens Reviewer",
    guidance:
      "Static Phase 2 review of _screens.md for web-GUI content vs ABAP-source contamination. A capable mid-tier model with careful reading is sufficient; prefer a different family than the main agent."
  },
  {
    id: "sap-test-plan-reviewer",
    fileName: "sap-test-plan-reviewer.agent.md",
    displayName: "Test Plan Reviewer",
    guidance:
      "Use a strong model from a different family than the main agent for an independent adversarial review."
  },
  {
    id: "sap-data-scout",
    fileName: "sap-data-scout.agent.md",
    displayName: "Data Scout",
    guidance:
      "Focused read-only SAP data discovery. Prefer a small, fast model with reliable SQL and tool use."
  },
  {
    id: "sap-task-helper",
    fileName: "sap-task-helper.agent.md",
    displayName: "Task Helper",
    guidance:
      "Handles varied bounded work. Prefer a balanced general-purpose model; raise capability only when delegated tasks require it."
  }
]

export const SUBAGENT_IDS = new Set(SUBAGENT_REGISTRY.map(agent => agent.id))
