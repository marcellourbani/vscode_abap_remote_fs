import { AgentDefinition, TESTING_AGENT_REGISTRY } from "../../subagentRegistry"

export type SubagentDefinition = AgentDefinition
export const SUBAGENT_REGISTRY: readonly SubagentDefinition[] = TESTING_AGENT_REGISTRY
export const SUBAGENT_IDS = new Set(SUBAGENT_REGISTRY.map(agent => agent.id))
