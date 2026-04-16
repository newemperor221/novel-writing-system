/**
 * Workflow Engine - Main orchestrator for event-driven workflow
 *
 * Coordinates all components:
 * - Event Bus for communication
 * - Dependency Graph for phase ordering
 * - Phase Scheduler for parallel execution
 * - State Machine for lifecycle
 * - Agent Registry for agent management
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { EventBus, getEventBus } from '../events/EventBus.js';
import { DependencyGraph, getDependencyGraph } from './DependencyGraph.js';
import { PhaseScheduler } from './PhaseScheduler.js';
import { TokenBudgetController } from './TokenBudgetController.js';
import { ChapterStateMachine } from '../state-machine/ChapterStateMachine.js';
import { AgentRegistry, getAgentRegistry } from '../agents/AgentRegistry.js';
import {
  PhaseName,
  WorkflowMode,
  ExecutionContext,
  WorkflowResult,
  EventType,
  ChapterStartedEvent,
  ChapterCompletedEvent,
  ChapterPausedEvent,
} from '../events/EventTypes.js';

export interface WorkflowEngineConfig {
  workDir: string;
  maxConcurrency?: number;
  maxRevisionIterations?: number;
  eventBus?: EventBus;
  dependencyGraph?: DependencyGraph;
  agentRegistry?: AgentRegistry;
}

export class WorkflowEngine {
  private workDir: string;
  private eventBus: EventBus;
  private dependencyGraph: DependencyGraph;
  private phaseScheduler: PhaseScheduler;
  private stateMachine: ChapterStateMachine;
  private agentRegistry: AgentRegistry;
  private isRunning: boolean;

  constructor(config: WorkflowEngineConfig) {
    this.workDir = config.workDir;
    this.eventBus = config.eventBus || getEventBus();
    this.dependencyGraph = config.dependencyGraph || getDependencyGraph();
    this.agentRegistry = config.agentRegistry || getAgentRegistry();
    this.stateMachine = new ChapterStateMachine(this.eventBus);
    this.phaseScheduler = new PhaseScheduler(
      this.eventBus,
      this.dependencyGraph,
      this.agentRegistry,
      { maxConcurrency: config.maxConcurrency || 2, maxRevisionIterations: config.maxRevisionIterations }
    );
    this.isRunning = false;
  }

  /**
   * Start a workflow for a chapter
   */
  async startWorkflow(
    bookId: string,
    chapterNumber: number,
    mode: WorkflowMode = WorkflowMode.FULL,
    options?: {
      platform?: string;
      userContext?: string;
      force?: boolean;
    }
  ): Promise<WorkflowResult> {
    const startTime = Date.now();
    this.isRunning = true;

    const chapterId = `${bookId}-chapter-${String(chapterNumber).padStart(3, '0')}`;
    const platform = options?.platform || (await this.getPlatform(bookId));

    // Create execution context
    const context: ExecutionContext = {
      bookId,
      chapterNumber,
      chapterId,
      mode,
      phase: 'PLANNER',
      workDir: this.workDir,
      runtimeDir: path.join(this.workDir, 'runtime', bookId, `chapter-${String(chapterNumber).padStart(3, '0')}`),
      stateDir: path.join(this.workDir, 'state', bookId),
      booksDir: path.join(this.workDir, 'books', bookId, 'chapters'),
      platform,
      metadata: {
        userContext: options?.userContext || '继续故事，保持连贯性',
      },
    };

    // Ensure directories exist
    await fs.mkdir(context.runtimeDir, { recursive: true });
    await fs.mkdir(context.booksDir, { recursive: true });

    // Truncate context files before execution (prevents context explosion)
    const tokenBudget = new TokenBudgetController(this.workDir);
    const truncated = await tokenBudget.buildContext(bookId);
    // buildContext already writes truncated files in-place, no further action needed

    // Emit chapter started event
    const startedEvent: ChapterStartedEvent = {
      type: EventType.CHAPTER_STARTED,
      chapterId,
      bookId,
      chapterNumber,
      mode,
      timestamp: new Date().toISOString(),
    };
    await this.eventBus.publish(startedEvent);

    try {
      // Execute phases
      const phaseResults = await this.phaseScheduler.executePhases(context, mode);

      // Check for failures
      const failedPhases = Array.from(phaseResults.values()).filter((r) => !r.success);
      const success = failedPhases.length === 0;

      // Calculate token totals from all phases
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      for (const result of phaseResults.values()) {
        totalInputTokens += result.inputTokens || 0;
        totalOutputTokens += result.outputTokens || 0;
      }

      // Calculate cost (Sonnet pricing: $3/1M input, $15/1M output)
      const inputCost = (totalInputTokens / 1_000_000) * 3;
      const outputCost = (totalOutputTokens / 1_000_000) * 15;
      const totalCost = inputCost + outputCost;

      // Write to cost log
      await this.writeCostLog(bookId, chapterNumber, totalInputTokens, totalOutputTokens, totalCost);

      // Calculate totals
      const phasesCompleted = Array.from(phaseResults.entries())
        .filter(([_, result]) => result.success)
        .map(([phase]) => phase);

      const totalDuration = Date.now() - startTime;

      // Emit completion event
      if (success) {
        const completedEvent: ChapterCompletedEvent = {
          type: EventType.CHAPTER_COMPLETED,
          chapterId,
          bookId,
          chapterNumber,
          outputFile: `${context.booksDir}/ch-${String(chapterNumber).padStart(3, '0')}.md`,
          wordCount: 0,
          auditResult: 'PASS',
          duration: totalDuration,
          timestamp: new Date().toISOString(),
        };
        await this.eventBus.publish(completedEvent);
      }

      return {
        success,
        bookId,
        chapterNumber,
        outputFile: success ? `${context.booksDir}/ch-${String(chapterNumber).padStart(3, '0')}.md` : undefined,
        wordCount: success ? 0 : undefined,
        auditResult: success ? 'PASS' : 'FAIL',
        duration: totalDuration,
        phasesCompleted,
        error: failedPhases.length > 0 ? failedPhases[0].error : undefined,
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: totalCost,
      };
    } catch (error) {
      const totalDuration = Date.now() - startTime;
      return {
        success: false,
        bookId,
        chapterNumber,
        duration: totalDuration,
        phasesCompleted: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get platform for a book
   */
  private async getPlatform(bookId: string): Promise<string> {
    try {
      const intentPath = path.join(this.workDir, 'state', bookId, 'author_intent.json');
      const content = await fs.readFile(intentPath, 'utf-8');
      const intent = JSON.parse(content);
      return intent.targetPlatform || 'tangfan';
    } catch {
      return 'tangfan';
    }
  }

  /**
   * Get the next chapter number for a book
   */
  async getNextChapter(bookId: string): Promise<number> {
    try {
      const statePath = path.join(this.workDir, 'state', bookId, 'current_state.json');
      const content = await fs.readFile(statePath, 'utf-8');
      const state = JSON.parse(content);
      return (state.chapter || 0) + 1;
    } catch {
      return 1;
    }
  }

  /**
   * Get current workflow status
   */
  getStatus(): {
    isRunning: boolean;
    phaseStatus: ReturnType<PhaseScheduler['getStatus']>;
  } {
    return {
      isRunning: this.isRunning,
      phaseStatus: this.phaseScheduler.getStatus(),
    };
  }

  /**
   * Cancel the current workflow
   */
  cancel(): void {
    this.phaseScheduler.cancel();
    this.isRunning = false;
  }

  /**
   * Check if a book exists
   */
  async bookExists(bookId: string): Promise<boolean> {
    try {
      const statePath = path.join(this.workDir, 'state', bookId);
      await fs.access(statePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get chapter state
   */
  getChapterState(chapterId: string) {
    return this.stateMachine.getState(chapterId);
  }

  /**
   * Check if chapter needs intervention
   */
  needsIntervention(chapterId: string): boolean {
    return this.stateMachine.needsIntervention(chapterId);
  }

  /**
   * Write cost data to cost log
   */
  private async writeCostLog(
    bookId: string,
    chapterNumber: number,
    inputTokens: number,
    outputTokens: number,
    costUsd: number
  ): Promise<void> {
    const costLogPath = path.join(this.workDir, '.cost_log.json');
    let entries: Array<Record<string, unknown>> = [];

    try {
      const content = await fs.readFile(costLogPath, 'utf-8');
      entries = JSON.parse(content);
    } catch {
      entries = [];
    }

    entries.push({
      timestamp: new Date().toISOString(),
      bookId,
      chapter: chapterNumber,
      inputTokens,
      outputTokens,
      costUsd: parseFloat(costUsd.toFixed(6)),
    });

    // Keep last 500 entries
    entries = entries.slice(-500);

    await fs.writeFile(costLogPath, JSON.stringify(entries, null, 2), 'utf-8');
  }
}

// ============================================================
// Factory function
// ============================================================

let globalEngine: WorkflowEngine | null = null;

export function createWorkflowEngine(config?: WorkflowEngineConfig): WorkflowEngine {
  const workDir = config?.workDir || process.cwd();
  return new WorkflowEngine({ workDir, ...config });
}

export function getWorkflowEngine(): WorkflowEngine | null {
  return globalEngine;
}

export function setWorkflowEngine(engine: WorkflowEngine): void {
  globalEngine = engine;
}
