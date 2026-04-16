/**
 * Agent Registry - Agent registration and lookup
 *
 * Maintains agent definitions and capabilities:
 * - Register agents
 * - Get agents by name
 * - Find agents by capability
 * - Get dependencies/outputs for each agent
 */

import {
  AgentDefinition,
  PhaseName,
  EventType,
  WorkflowMode,
} from '../events/EventTypes.js';
import { AgentBase } from './AgentBase.js';

// Default agent definitions from existing agents/*.md
const DEFAULT_AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    name: 'PLANNER',
    description: 'Chapter intent definition',
    inputs: [],
    outputs: [EventType.INTENT_COMPLETED],
    capabilities: ['planning', 'intent', 'chapter-outline'],
    model: 'sonnet',
    tools: ['Read', 'Write', 'Glob'],
  },
  {
    name: 'ARCHITECT',
    description: 'Chapter structure design',
    inputs: [EventType.INTENT_COMPLETED],
    outputs: [EventType.ARCHITECTURE_COMPLETED],
    capabilities: ['structure', 'pacing', 'scene-design'],
    model: 'sonnet',
    tools: ['Read', 'Write'],
  },
  {
    name: 'COMPOSER',
    description: 'Context compilation from truth files',
    inputs: [EventType.INTENT_COMPLETED],
    outputs: [EventType.CONTEXT_COMPLETED],
    capabilities: ['context', 'rule-compilation', 'token-budget'],
    model: 'sonnet',
    tools: ['Read', 'Write'],
  },
  {
    name: 'WRITER',
    description: 'Raw chapter prose generation',
    inputs: [
      EventType.INTENT_COMPLETED,
      EventType.ARCHITECTURE_COMPLETED,
      EventType.CONTEXT_COMPLETED,
    ],
    outputs: [EventType.DRAFT_COMPLETED],
    capabilities: ['writing', 'prose', 'anti-ai-taste'],
    model: 'opus',
    tools: ['Read', 'Write'],
  },
  {
    name: 'OBSERVER',
    description: 'Fact extraction from draft',
    inputs: [EventType.DRAFT_COMPLETED],
    outputs: [EventType.FACTS_EXTRACTED],
    capabilities: ['fact-extraction', 'entity-tracking'],
    model: 'sonnet',
    tools: ['Read', 'Write'],
  },
  {
    name: 'AUDITOR',
    description: '3-layer continuity and AI-taste audit',
    inputs: [EventType.DRAFT_COMPLETED, EventType.FACTS_EXTRACTED],
    outputs: [EventType.AUDIT_COMPLETED, EventType.AUDIT_PASSED, EventType.AUDIT_FAILED],
    capabilities: ['audit', 'continuity', 'ai-taste-detection', 'style'],
    model: 'sonnet',
    tools: ['Read', 'Write', 'Glob'],
  },
  {
    name: 'REVISER',
    description: 'Auto-fix audit issues',
    inputs: [EventType.AUDIT_COMPLETED, EventType.DRAFT_COMPLETED],
    outputs: [EventType.REVISION_COMPLETED],
    capabilities: ['revision', 'fix', 'auto-repair'],
    model: 'sonnet',
    tools: ['Read', 'Write'],
  },
  {
    name: 'NORMALIZER',
    description: 'Word count adjustment',
    inputs: [EventType.REVISION_COMPLETED],
    outputs: [EventType.NORMALIZATION_COMPLETED],
    capabilities: ['normalization', 'word-count', 'expansion', 'compression'],
    model: 'sonnet',
    tools: ['Read', 'Write'],
  },
  {
    name: 'EDITOR',
    description: 'Platform format adapter',
    inputs: [EventType.NORMALIZATION_COMPLETED],
    outputs: [EventType.EDIT_COMPLETED],
    capabilities: ['formatting', 'platform-adaptation', 'export'],
    model: 'sonnet',
    tools: ['Read', 'Write'],
  },
  {
    name: 'FACTS-KEEPER',
    description: 'Truth file management',
    inputs: [EventType.FACTS_EXTRACTED, EventType.EDIT_COMPLETED],
    outputs: [EventType.TRUTH_UPDATED],
    capabilities: ['truth-update', 'state-management', 'validation'],
    model: 'sonnet',
    tools: ['Read', 'Write', 'Bash'],
  },
  {
    name: 'RADAR',
    description: 'Market trend scanner',
    inputs: [],
    outputs: [],
    capabilities: ['market-analysis', 'trend-detection'],
    model: 'sonnet',
    tools: ['Read', 'Write'],
  },
];

export class AgentRegistry {
  private agents: Map<PhaseName, AgentDefinition>;
  private agentInstances: Map<PhaseName, AgentBase>;
  private capabilitiesIndex: Map<string, PhaseName[]>;

  constructor() {
    this.agents = new Map();
    this.agentInstances = new Map();
    this.capabilitiesIndex = new Map();

    // Register default agents
    DEFAULT_AGENT_DEFINITIONS.forEach((def) => this.register(def));
  }

  /**
   * Register an agent definition
   */
  register(definition: AgentDefinition): void {
    this.agents.set(definition.name, definition);

    // Update capabilities index
    definition.capabilities.forEach((capability) => {
      const agents = this.capabilitiesIndex.get(capability) || [];
      agents.push(definition.name);
      this.capabilitiesIndex.set(capability, agents);
    });
  }

  /**
   * Register an agent instance
   */
  registerInstance(instance: AgentBase): void {
    this.agentInstances.set(instance.getName(), instance);
    this.register(instance.getDefinition());
  }

  /**
   * Get agent definition by name
   */
  getAgent(name: PhaseName): AgentDefinition | undefined {
    return this.agents.get(name);
  }

  /**
   * Get agent instance by name
   */
  getAgentInstance(name: PhaseName): AgentBase | undefined {
    return this.agentInstances.get(name);
  }

  /**
   * Get all registered agents
   */
  getAllAgents(): AgentDefinition[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by capability
   */
  getAgentsByCapability(capability: string): AgentDefinition[] {
    const names = this.capabilitiesIndex.get(capability) || [];
    return names.map((name) => this.agents.get(name)!).filter(Boolean);
  }

  /**
   * Get agents that can run in a given mode
   */
  getAgentsForMode(mode: WorkflowMode): AgentDefinition[] {
    // For now, all agents support all modes
    // Could be refined based on agent capabilities
    return this.getAllAgents();
  }

  /**
   * Get input dependencies for an agent
   */
  getDependencies(name: PhaseName): EventType[] {
    const agent = this.agents.get(name);
    return agent?.inputs || [];
  }

  /**
   * Get outputs for an agent
   */
  getOutputs(name: PhaseName): EventType[] {
    const agent = this.agents.get(name);
    return agent?.outputs || [];
  }

  /**
   * Check if an agent can start given completed outputs
   */
  canStart(
    name: PhaseName,
    completedOutputs: Set<EventType>
  ): { canStart: boolean; missing: EventType[] } {
    const dependencies = this.getDependencies(name);
    const missing = dependencies.filter((dep) => !completedOutputs.has(dep));

    return {
      canStart: missing.length === 0,
      missing,
    };
  }

  /**
   * Get the next phases that can run given completed outputs
   */
  getRunnableAgents(completedOutputs: Set<EventType>): PhaseName[] {
    const runnable: PhaseName[] = [];

    this.agents.forEach((agent, name) => {
      const { canStart } = this.canStart(name, completedOutputs);
      if (canStart) {
        runnable.push(name);
      }
    });

    return runnable;
  }

  /**
   * Check if agent supports a specific capability
   */
  hasCapability(name: PhaseName, capability: string): boolean {
    const agent = this.agents.get(name);
    return agent?.capabilities.includes(capability) || false;
  }

  /**
   * Get agent count
   */
  getAgentCount(): number {
    return this.agents.size;
  }

  /**
   * Validate all registered agents
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    this.agents.forEach((agent) => {
      // Check all input references exist as outputs
      agent.inputs.forEach((input) => {
        const exists = Array.from(this.agents.values()).some((a) =>
          a.outputs.includes(input)
        );
        if (!exists && input !== EventType.PHASE_COMPLETED) {
          errors.push(
            `Agent ${agent.name} requires ${input} but no agent produces it`
          );
        }
      });
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get all capabilities
   */
  getAllCapabilities(): string[] {
    return Array.from(this.capabilitiesIndex.keys());
  }

  /**
   * Get capability to agents mapping
   */
  getCapabilityMap(): Map<string, PhaseName[]> {
    return new Map(this.capabilitiesIndex);
  }
}

// ============================================================
// Singleton instance
// ============================================================

let globalRegistry: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!globalRegistry) {
    globalRegistry = new AgentRegistry();
  }
  return globalRegistry;
}

export function resetAgentRegistry(): void {
  globalRegistry = new AgentRegistry();
}
