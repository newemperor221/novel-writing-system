/**
 * Agent Base Class - Base for event-driven agents
 *
 * Provides common functionality for agents:
 * - Event emission helpers
 * - Execution context management
 * - Standardized execute interface
 */

import { EventBus } from '../events/EventBus.js';
import {
  AgentDefinition,
  ExecutionContext,
  ExecutionResult,
  PhaseName,
  EventType,
  PhaseStartedEvent,
  PhaseCompletedEvent,
  PhaseFailedEvent,
  WorkflowMode,
} from '../events/EventTypes.js';

export abstract class AgentBase {
  protected eventBus: EventBus;
  protected definition: AgentDefinition;

  constructor(eventBus: EventBus, definition: AgentDefinition) {
    this.eventBus = eventBus;
    this.definition = definition;
  }

  /**
   * Execute the agent's main logic
   */
  abstract execute(context: ExecutionContext): Promise<ExecutionResult>;

  /**
   * Get the agent's definition
   */
  getDefinition(): AgentDefinition {
    return this.definition;
  }

  /**
   * Get the agent's name
   */
  getName(): PhaseName {
    return this.definition.name;
  }

  /**
   * Check if agent can handle the given mode
   */
  supportsMode(mode: WorkflowMode): boolean {
    return true; // Override in subclasses if needed
  }

  // ============================================================
  // Event emission helpers
  // ============================================================

  protected async emitStarted(
    chapterId: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const event: PhaseStartedEvent = {
      type: EventType.PHASE_STARTED,
      chapterId,
      phase: this.definition.name,
      timestamp: new Date().toISOString(),
      metadata,
    };
    await this.eventBus.publish(event);
  }

  protected async emitCompleted(
    chapterId: string,
    outputFiles: string[],
    duration: number
  ): Promise<void> {
    const event: PhaseCompletedEvent = {
      type: EventType.PHASE_COMPLETED,
      chapterId,
      phase: this.definition.name,
      outputFiles,
      duration,
      timestamp: new Date().toISOString(),
    };
    await this.eventBus.publish(event);
  }

  protected async emitFailed(
    chapterId: string,
    error: string,
    retryable: boolean
  ): Promise<void> {
    const event: PhaseFailedEvent = {
      type: EventType.PHASE_FAILED,
      chapterId,
      phase: this.definition.name,
      error,
      retryable,
      timestamp: new Date().toISOString(),
    };
    await this.eventBus.publish(event);
  }

  // ============================================================
  // Standard execution wrapper
  // ============================================================

  protected async run(
    context: ExecutionContext,
    executeFn: () => Promise<{ outputs: string[] }>
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    await this.emitStarted(context.chapterId, { mode: context.mode });

    try {
      const result = await executeFn();
      const duration = Date.now() - startTime;
      await this.emitCompleted(context.chapterId, result.outputs, duration);

      return {
        success: true,
        outputs: result.outputs,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      await this.emitFailed(context.chapterId, errorMessage, this.isRetryable(error));

      return {
        success: false,
        outputs: [],
        duration,
        error: errorMessage,
      };
    }
  }

  /**
   * Determine if an error is retryable
   */
  protected isRetryable(error: unknown): boolean {
    if (error instanceof Error) {
      // Don't retry on obvious fatal errors
      const nonRetryablePatterns = [
        'does not exist',
        'not found',
        'permission denied',
        'invalid',
      ];

      for (const pattern of nonRetryablePatterns) {
        if (error.message.toLowerCase().includes(pattern)) {
          return false;
        }
      }
    }
    return true;
  }
}

// ============================================================
// Execution Context Builder
// ============================================================

export interface ExecutionContextOptions {
  bookId: string;
  chapterNumber: number;
  mode: WorkflowMode;
  workDir: string;
  platform: string;
  metadata?: Record<string, unknown>;
}

export function buildExecutionContext(
  options: ExecutionContextOptions
): ExecutionContext {
  const { bookId, chapterNumber, mode, workDir, platform, metadata } = options;

  const chapterId = `${bookId}-chapter-${String(chapterNumber).padStart(3, '0')}`;
  const runtimeDir = `${workDir}/runtime/${bookId}/chapter-${String(chapterNumber).padStart(3, '0')}`;
  const stateDir = `${workDir}/state/${bookId}`;
  const booksDir = `${workDir}/books/${bookId}/chapters`;

  return {
    bookId,
    chapterNumber,
    chapterId,
    mode,
    phase: 'PLANNER', // Will be updated by each agent
    workDir,
    runtimeDir,
    stateDir,
    booksDir,
    platform,
    metadata,
  };
}
