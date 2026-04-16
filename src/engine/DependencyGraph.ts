/**
 * Dependency Graph - DAG for agent phase dependencies
 *
 * Manages the dependency relationships between phases and supports:
 * - Topological sorting for sequential execution
 * - Parallel execution detection (phases with satisfied dependencies)
 * - Cycle detection
 */

import { PhaseName, PhaseDependencies, DependencyEdge } from '../events/EventTypes.js';

// Default phase dependencies based on the novel writing workflow
const DEFAULT_PHASE_DEPENDENCIES: Record<PhaseName, PhaseDependencies> = {
  PLANNER: {
    phase: 'PLANNER',
    requires: [],
    requiredOutputs: [],
    produces: ['runtime/{book}/chapter-{n}/01-intent.md'],
    canRunParallelWith: [],
  },
  ARCHITECT: {
    phase: 'ARCHITECT',
    requires: ['PLANNER'],
    requiredOutputs: ['01-intent.md'],
    produces: ['runtime/{book}/chapter-{n}/02-architecture.md'],
    canRunParallelWith: ['COMPOSER'],
  },
  COMPOSER: {
    phase: 'COMPOSER',
    requires: ['PLANNER'],
    requiredOutputs: ['01-intent.md'],
    produces: [
      'runtime/{book}/chapter-{n}/03-context.json',
      'runtime/{book}/chapter-{n}/04-rule-stack.yaml',
    ],
    canRunParallelWith: ['ARCHITECT'],
  },
  WRITER: {
    phase: 'WRITER',
    requires: ['ARCHITECT', 'COMPOSER'],
    requiredOutputs: ['02-architecture.md', '03-context.json', '04-rule-stack.yaml'],
    produces: ['runtime/{book}/chapter-{n}/05-draft.md'],
    canRunParallelWith: [],
  },
  OBSERVER: {
    phase: 'OBSERVER',
    requires: ['WRITER'],
    requiredOutputs: ['05-draft.md'],
    produces: ['runtime/{book}/chapter-{n}/06-facts.json'],
    canRunParallelWith: [],
  },
  AUDITOR: {
    phase: 'AUDITOR',
    requires: ['OBSERVER'],
    requiredOutputs: ['05-draft.md', '06-facts.json'],
    produces: ['runtime/{book}/chapter-{n}/07-audit.json'],
    canRunParallelWith: [],
  },
  REVISER: {
    phase: 'REVISER',
    requires: ['AUDITOR'], // Special: only runs if AUDIT_FAILED
    requiredOutputs: ['05-draft.md', '07-audit.json', '01-intent.md'],
    produces: ['runtime/{book}/chapter-{n}/08-revised.md'],
    canRunParallelWith: [],
  },
  NORMALIZER: {
    phase: 'NORMALIZER',
    requires: ['REVISER', 'AUDITOR'], // Depends on AUDIT result
    requiredOutputs: ['08-revised.md'],
    produces: ['runtime/{book}/chapter-{n}/09-normalized.md'],
    canRunParallelWith: ['EDITOR'],
  },
  EDITOR: {
    phase: 'EDITOR',
    requires: ['NORMALIZER'],
    requiredOutputs: ['09-normalized.md'],
    produces: [
      'runtime/{book}/chapter-{n}/10-final.md',
      'books/{book}/chapters/ch-{n}.md',
    ],
    canRunParallelWith: ['NORMALIZER'],
  },
  'FACTS-KEEPER': {
    phase: 'FACTS-KEEPER',
    requires: ['EDITOR', 'OBSERVER'],
    requiredOutputs: ['06-facts.json', '10-final.md'],
    produces: [
      'state/{book}/current_state.json',
      'state/{book}/particle_ledger.json',
      'state/{book}/pending_hooks.json',
      'state/{book}/chapter_summaries.json',
      'state/{book}/subplot_board.json',
      'state/{book}/emotional_arcs.json',
      'state/{book}/character_matrix.json',
    ],
    canRunParallelWith: [],
  },
  RADAR: {
    phase: 'RADAR',
    requires: [],
    requiredOutputs: [],
    produces: ['runtime/{book}/radar-report.md'],
    canRunParallelWith: [],
  },
};

export class DependencyGraph {
  private dependencies: Map<PhaseName, PhaseDependencies>;
  private adjacencyList: Map<PhaseName, Set<PhaseName>>;
  private reverseAdjacencyList: Map<PhaseName, Set<PhaseName>>;

  constructor(dependencies?: Record<PhaseName, PhaseDependencies>) {
    this.dependencies = new Map();
    this.adjacencyList = new Map();
    this.reverseAdjacencyList = new Map();

    const deps = dependencies || DEFAULT_PHASE_DEPENDENCIES;

    // Initialize all phases
    Object.values(deps).forEach((dep) => {
      this.dependencies.set(dep.phase, dep);
      this.adjacencyList.set(dep.phase, new Set());
      this.reverseAdjacencyList.set(dep.phase, new Set());
    });

    // Build adjacency lists from requires
    Object.values(deps).forEach((dep) => {
      dep.requires.forEach((requiredPhase) => {
        this.addEdge(requiredPhase, dep.phase);
      });
    });
  }

  /**
   * Add an edge to the graph
   */
  addEdge(from: PhaseName, to: PhaseName): void {
    this.adjacencyList.get(from)?.add(to);
    this.reverseAdjacencyList.get(to)?.add(from);
  }

  /**
   * Remove an edge from the graph
   */
  removeEdge(from: PhaseName, to: PhaseName): void {
    this.adjacencyList.get(from)?.delete(to);
    this.reverseAdjacencyList.get(to)?.delete(from);
  }

  /**
   * Get dependencies (phases that must complete before this one)
   */
  getDependencies(phase: PhaseName): PhaseName[] {
    return Array.from(this.reverseAdjacencyList.get(phase) || []);
  }

  /**
   * Get dependents (phases that depend on this one)
   */
  getDependents(phase: PhaseName): PhaseName[] {
    return Array.from(this.adjacencyList.get(phase) || []);
  }

  /**
   * Get phase definition
   */
  getPhaseDefinition(phase: PhaseName): PhaseDependencies | undefined {
    return this.dependencies.get(phase);
  }

  /**
   * Check if a phase's dependencies are satisfied
   */
  areDependenciesSatisfied(
    phase: PhaseName,
    completedPhases: Set<PhaseName>
  ): boolean {
    const deps = this.getDependencies(phase);
    return deps.every((dep) => completedPhases.has(dep));
  }

  /**
   * Get phases that can run in parallel at the current state
   */
  getRunnablePhases(completedPhases: Set<PhaseName>): PhaseName[] {
    const runnable: PhaseName[] = [];

    this.dependencies.forEach((_, phase) => {
      if (!completedPhases.has(phase)) {
        // Check if all non-conditional dependencies are met
        const phaseDef = this.dependencies.get(phase)!;
        const unconditionalDeps = phaseDef.requires.filter((req) => {
          // REVISER only runs if AUDITOR found issues - handled at runtime
          if (phase === 'REVISER') return false;
          return true;
        });

        const allDepsMet = unconditionalDeps.every((dep) =>
          completedPhases.has(dep)
        );

        if (allDepsMet) {
          runnable.push(phase);
        }
      }
    });

    return runnable;
  }

  /**
   * Get phases that can run in parallel (ignoring sequential dependencies)
   */
  getParallelGroups(): PhaseName[][] {
    const groups: PhaseName[][] = [];
    const visited = new Set<PhaseName>();

    // Find phases with no dependencies (roots)
    const roots = Array.from(this.dependencies.keys()).filter(
      (phase) => this.getDependencies(phase).length === 0
    );

    // BFS to group by level
    const levels = new Map<PhaseName, number>();

    const traverse = (phase: PhaseName, level: number) => {
      if (visited.has(phase)) {
        // Update if we found a deeper path
        const existing = levels.get(phase);
        if (existing !== undefined && level > existing) {
          levels.set(phase, level);
        }
        return;
      }

      visited.add(phase);
      levels.set(phase, level);

      const dependents = this.getDependents(phase);
      dependents.forEach((dep) => traverse(dep, level + 1));
    };

    roots.forEach((root) => traverse(root, 0));

    // Group by level
    const maxLevel = Math.max(...Array.from(levels.values()));
    for (let i = 0; i <= maxLevel; i++) {
      const levelPhases = Array.from(levels.entries())
        .filter(([_, level]) => level === i)
        .map(([phase]) => phase);

      if (levelPhases.length > 0) {
        groups.push(levelPhases);
      }
    }

    return groups;
  }

  /**
   * Topological sort using Kahn's algorithm
   */
  topologicalSort(): PhaseName[] {
    const result: PhaseName[] = [];
    const inDegree = new Map<PhaseName, number>();
    const queue: PhaseName[] = [];

    // Initialize in-degrees
    this.dependencies.forEach((_, phase) => {
      const deps = this.getDependencies(phase);
      inDegree.set(phase, deps.length);
    });

    // Find all nodes with no dependencies
    this.dependencies.forEach((_, phase) => {
      if (inDegree.get(phase) === 0) {
        queue.push(phase);
      }
    });

    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      this.getDependents(current).forEach((dependent) => {
        const newDegree = (inDegree.get(dependent) || 0) - 1;
        inDegree.set(dependent, newDegree);

        if (newDegree === 0) {
          queue.push(dependent);
        }
      });
    }

    // Check for cycles
    if (result.length !== this.dependencies.size) {
      throw new Error('Cycle detected in dependency graph');
    }

    return result;
  }

  /**
   * Check for cycles using DFS
   */
  hasCycle(): boolean {
    const visited = new Set<PhaseName>();
    const recStack = new Set<PhaseName>();

    const dfs = (phase: PhaseName): boolean => {
      visited.add(phase);
      recStack.add(phase);

      const dependents = this.getDependents(phase);
      for (const dependent of dependents) {
        if (!visited.has(dependent)) {
          if (dfs(dependent)) return true;
        } else if (recStack.has(dependent)) {
          return true;
        }
      }

      recStack.delete(phase);
      return false;
    };

    for (const phase of this.dependencies.keys()) {
      if (!visited.has(phase)) {
        if (dfs(phase)) return true;
      }
    }

    return false;
  }

  /**
   * Get the execution path for a specific set of phases
   */
  getExecutionPath(targetPhases: PhaseName[]): PhaseName[] {
    const targetSet = new Set(targetPhases);
    const path: PhaseName[] = [];
    const visited = new Set<PhaseName>();

    const sorted = this.topologicalSort();

    for (const phase of sorted) {
      if (targetSet.has(phase) && !visited.has(phase)) {
        path.push(phase);
        visited.add(phase);
      }
    }

    return path;
  }

  /**
   * Get phases that should run after a given phase (transitive closure)
   */
  getSubsequentPhases(phase: PhaseName): PhaseName[] {
    const result: PhaseName[] = [];
    const visited = new Set<PhaseName>();

    const traverse = (p: PhaseName) => {
      const dependents = this.getDependents(p);
      for (const dep of dependents) {
        if (!visited.has(dep)) {
          visited.add(dep);
          result.push(dep);
          traverse(dep);
        }
      }
    };

    traverse(phase);
    return result;
  }

  /**
   * Validate the graph structure
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for cycles
    if (this.hasCycle()) {
      errors.push('Cycle detected in dependency graph');
    }

    // Check all dependency references exist
    this.dependencies.forEach((dep) => {
      dep.requires.forEach((req) => {
        if (!this.dependencies.has(req)) {
          errors.push(
            `Phase ${dep.phase} depends on non-existent phase ${req}`
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
   * Get all phases
   */
  getAllPhases(): PhaseName[] {
    return Array.from(this.dependencies.keys());
  }

  /**
   * Get phases that can run in parallel with a given phase
   */
  getParallelPartners(phase: PhaseName): PhaseName[] {
    const phaseDef = this.dependencies.get(phase);
    if (!phaseDef) return [];

    return phaseDef.canRunParallelWith.filter((partner) => {
      // Only if partner is not yet completed
      return true; // This is determined at runtime via completedPhases
    });
  }

  /**
   * Serialize graph to DOT format for visualization
   */
  toDot(): string {
    let dot = 'digraph Workflow {\n';
    dot += '  rankdir=TB;\n';
    dot += '  node [shape=box];\n\n';

    // Add nodes
    this.dependencies.forEach((dep, phase) => {
      const label = dep.phase.replace(/-/g, '\n');
      dot += `  "${dep.phase}" [label="${label}"];\n`;
    });

    dot += '\n';

    // Add edges
    this.dependencies.forEach((dep, phase) => {
      dep.requires.forEach((req) => {
        dot += `  "${req}" -> "${dep.phase}";\n`;
      });
    });

    dot += '}\n';
    return dot;
  }
}

// ============================================================
// Singleton instance
// ============================================================

let globalGraph: DependencyGraph | null = null;

export function getDependencyGraph(): DependencyGraph {
  if (!globalGraph) {
    globalGraph = new DependencyGraph();
  }
  return globalGraph;
}

export function resetDependencyGraph(): void {
  globalGraph = new DependencyGraph();
}
