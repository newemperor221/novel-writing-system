/**
 * Phase Scheduler - Parallel execution of phases with dependency tracking
 *
 * Schedules phase execution based on:
 * - Dependency graph (phases can run when dependencies are met)
 * - Available concurrency slots
 * - Event bus for phase completion notifications
 */

import { EventBus } from '../events/EventBus.js';
import { DependencyGraph } from './DependencyGraph.js';
import {
  PhaseName,
  EventType,
  WorkflowEvent,
  ExecutionContext,
  WorkflowMode,
} from '../events/EventTypes.js';
import { AgentRegistry } from '../agents/AgentRegistry.js';
import { LegacyAgentWrapper, createLegacyAgentWrapper } from '../agents/legacy/LegacyAgentWrapper.js';

interface ScheduledPhase {
  phase: PhaseName;
  context: ExecutionContext;
  startedAt: number;
  promise: Promise<void>;
}

interface PhaseResult {
  phase: PhaseName;
  success: boolean;
  duration: number;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
}

interface PhaseSchedulerConfig {
  maxConcurrency?: number;
  maxRevisionIterations?: number;  // Default 3
}

export class PhaseScheduler {
  private eventBus: EventBus;
  private dependencyGraph: DependencyGraph;
  private agentRegistry: AgentRegistry;
  private activePhases: Map<PhaseName, ScheduledPhase>;
  private completedPhases: Set<PhaseName>;
  private pendingPhases: Set<PhaseName>;
  private phaseResults: Map<PhaseName, PhaseResult>;
  private maxConcurrency: number;
  private maxRevisionIterations: number;
  private revisionIterations: number;
  private isRunning: boolean;
  private abortController: AbortController | null;
  private currentContext: ExecutionContext | null = null;

  constructor(
    eventBus: EventBus,
    dependencyGraph: DependencyGraph,
    agentRegistry: AgentRegistry,
    config: PhaseSchedulerConfig = {}
  ) {
    this.eventBus = eventBus;
    this.dependencyGraph = dependencyGraph;
    this.agentRegistry = agentRegistry;
    this.activePhases = new Map();
    this.completedPhases = new Set();
    this.pendingPhases = new Set();
    this.phaseResults = new Map();
    this.maxConcurrency = config.maxConcurrency ?? 2;
    this.maxRevisionIterations = config.maxRevisionIterations ?? 3;
    this.revisionIterations = 0;
    this.isRunning = false;
    this.abortController = null;
  }

  /**
   * Execute phases based on mode
   */
  async executePhases(
    context: ExecutionContext,
    mode: WorkflowMode
  ): Promise<Map<PhaseName, PhaseResult>> {
    this.isRunning = true;
    this.abortController = new AbortController();
    this.currentContext = context;
    this.completedPhases.clear();
    this.activePhases.clear();
    this.pendingPhases.clear();
    this.phaseResults.clear();
    this.revisionIterations = 0;

    const phases = this.getPhasesForMode(mode);
    phases.forEach((p) => this.pendingPhases.add(p));

    // Subscribe to phase completion events
    const subscription = this.eventBus.subscribe(
      EventType.PHASE_COMPLETED,
      (event) => this.handlePhaseCompleted(event)
    );

    try {
      // Start initial phases (those with no dependencies)
      await this.startReadyPhases(context);

      // Wait for all phases to complete
      await this.waitForCompletion();

      return this.phaseResults;
    } finally {
      this.eventBus.unsubscribe(subscription);
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Handle phase completion event
   */
  private handlePhaseCompleted(event: WorkflowEvent): void {
    const phase = (event as any).phase as PhaseName;
    if (!phase) return;

    this.activePhases.delete(phase);
    this.completedPhases.add(phase);

    // Continue starting ready phases
    if (this.currentContext) {
      this.startReadyPhases(this.currentContext);
    }
  }

  /**
   * Start all phases that are ready to run
   */
  private async startReadyPhases(context: ExecutionContext): Promise<void> {
    while (this.pendingPhases.size > 0 && this.activePhases.size < this.maxConcurrency) {
      const readyPhase = this.findReadyPhase();
      if (!readyPhase) break;

      this.pendingPhases.delete(readyPhase);
      this.startPhase(readyPhase, context);
    }
  }

  /**
   * Find a phase whose dependencies are all satisfied
   */
  private findReadyPhase(): PhaseName | null {
    for (const phase of this.pendingPhases) {
      const deps = this.dependencyGraph.getDependencies(phase);
      const allSatisfied = deps.every(
        (dep) => this.completedPhases.has(dep)
      );
      if (allSatisfied) {
        return phase;
      }
    }
    return null;
  }

  /**
   * Start a specific phase
   */
  private startPhase(phase: PhaseName, context: ExecutionContext): void {
    // Check revision iteration cap before starting AUDITOR
    if (phase === 'AUDITOR') {
      if (this.revisionIterations >= this.maxRevisionIterations) {
        this.phaseResults.set(phase, {
          phase,
          success: false,
          duration: 0,
          error: `PIPELINE PAUSE: max revision iterations (${this.maxRevisionIterations}) reached. Chapter requires human review.`,
        });
        this.eventBus.publish({
          type: EventType.CHAPTER_PAUSED,
          bookId: context.bookId,
          chapterNumber: context.chapterNumber,
          reason: 'max_iterations_reached',
          timestamp: new Date().toISOString(),
        });
        return;
      }
      this.revisionIterations++;
    }

    const phaseContext: ExecutionContext = {
      ...context,
      phase,
    };

    const startedAt = Date.now();

    // Create the agent wrapper
    const agent = createLegacyAgentWrapper(this.eventBus, phase);
    if (!agent) {
      this.phaseResults.set(phase, {
        phase,
        success: false,
        duration: 0,
        error: `No agent found for phase ${phase}`,
      });
      return;
    }

    const promise = agent.execute(phaseContext).then(async (result) => {
      const duration = Date.now() - startedAt;
      this.phaseResults.set(phase, {
        phase,
        success: result.success,
        duration,
        error: result.error,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });

      this.completedPhases.add(phase);
      this.activePhases.delete(phase);

      // Trigger next phases
      if (this.currentContext) {
        await this.startReadyPhases(this.currentContext);
      }
    }).catch((error) => {
      const duration = Date.now() - startedAt;
      this.phaseResults.set(phase, {
        phase,
        success: false,
        duration,
        error: error.message,
      });
      this.completedPhases.add(phase);
      this.activePhases.delete(phase);
    });

    this.activePhases.set(phase, {
      phase,
      context: phaseContext,
      startedAt,
      promise,
    });
  }

  /**
   * Wait for all phases to complete
   */
  private async waitForCompletion(): Promise<void> {
    while (this.pendingPhases.size > 0 || this.activePhases.size > 0) {
      if (this.abortController?.signal.aborted) {
        throw new Error('Phase execution aborted');
      }

      if (this.activePhases.size > 0) {
        // Wait for any active phase to complete
        await Promise.race(
          Array.from(this.activePhases.values()).map((p) => p.promise)
        );
      } else if (this.pendingPhases.size > 0) {
        // No active phases but pending phases remain - check for deadlock
        const ready = this.findReadyPhase();
        if (!ready) {
          throw new Error('Dependency deadlock: no phases can start');
        }
        await this.startReadyPhases(this.currentContext!);
      }
    }
  }

  /**
   * Get phases for a given mode
   */
  private getPhasesForMode(mode: WorkflowMode): PhaseName[] {
    switch (mode) {
      case WorkflowMode.FULL:
        return [
          'PLANNER', 'ARCHITECT', 'COMPOSER', 'WRITER', 'OBSERVER',
          'AUDITOR', 'REVISER', 'NORMALIZER', 'EDITOR', 'FACTS-KEEPER',
        ];
      case WorkflowMode.FAST:
        return [
          'PLANNER', 'ARCHITECT', 'COMPOSER', 'WRITER', 'NORMALIZER', 'EDITOR',
        ];
      case WorkflowMode.AUDIT_ONLY:
        return ['OBSERVER', 'AUDITOR'];
      case WorkflowMode.REVISE_ONLY:
        return ['REVISER'];
      case WorkflowMode.EXPORT_ONLY:
        return ['EDITOR'];
      case WorkflowMode.PLAN_ONLY:
        return ['PLANNER', 'ARCHITECT', 'COMPOSER'];
      default:
        throw new Error(`Unknown mode: ${mode}`);
    }
  }

  /**
   * Get current status
   */
  getStatus(): {
    isRunning: boolean;
    activeCount: number;
    completedCount: number;
    pendingCount: number;
    activePhases: PhaseName[];
    completedPhases: PhaseName[];
  } {
    return {
      isRunning: this.isRunning,
      activeCount: this.activePhases.size,
      completedCount: this.completedPhases.size,
      pendingCount: this.pendingPhases.size,
      activePhases: Array.from(this.activePhases.keys()),
      completedPhases: Array.from(this.completedPhases),
    };
  }

  /**
   * Cancel all running phases
   */
  cancel(): void {
    this.abortController?.abort();
  }
}
