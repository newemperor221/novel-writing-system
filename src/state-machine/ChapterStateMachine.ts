/**
 * Chapter State Machine - State transitions for chapter lifecycle
 */

import { EventBus } from '../events/EventBus.js';
import {
  ChapterState,
  EventType,
  PhaseName,
  ChapterStartedEvent,
} from '../events/EventTypes.js';

export class ChapterStateMachine {
  private eventBus: EventBus;
  private chapterStates: Map<string, ChapterState>;
  private chapterPhases: Map<string, Set<PhaseName>>;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.chapterStates = new Map();
    this.chapterPhases = new Map();
    this.setupEventHandlers();
  }

  initialize(chapterId: string): void {
    this.chapterStates.set(chapterId, ChapterState.CREATED);
    this.chapterPhases.set(chapterId, new Set());
  }

  getState(chapterId: string): ChapterState {
    return this.chapterStates.get(chapterId) || ChapterState.CREATED;
  }

  async transition(
    chapterId: string,
    phase: PhaseName,
    result: 'COMPLETED' | 'FAILED' | 'PAUSED'
  ): Promise<boolean> {
    const currentState = this.getState(chapterId);

    if (result === 'FAILED') {
      this.chapterStates.set(chapterId, ChapterState.FAILED);
      return true;
    }

    if (result === 'PAUSED') {
      this.chapterStates.set(chapterId, ChapterState.PAUSED);
      return true;
    }

    // Mark phase as completed
    const phases = this.chapterPhases.get(chapterId) || new Set();
    phases.add(phase);
    this.chapterPhases.set(chapterId, phases);

    // Compute next state
    const nextState = this.getNextState(chapterId, phase, currentState, phases);
    if (nextState) {
      this.chapterStates.set(chapterId, nextState);
    }

    return true;
  }

  private getNextState(
    chapterId: string,
    phase: PhaseName,
    currentState: ChapterState,
    completedPhases: Set<PhaseName>
  ): ChapterState | null {
    // Sequential pipeline transitions
    switch (currentState) {
      case ChapterState.CREATED:
        if (phase === 'PLANNER') return ChapterState.PLANNING;
        return null;

      case ChapterState.PLANNING:
        // After PLANNER, both ARCHITECT and COMPOSER become available
        if (phase === 'ARCHITECT') return ChapterState.ARCHITECTING;
        if (phase === 'COMPOSER') return ChapterState.COMPOSING;
        return null;

      case ChapterState.ARCHITECTING:
        // ARCHITECT completes, wait for COMPOSER
        if (phase === 'COMPOSER') return ChapterState.WRITING;
        return null;

      case ChapterState.COMPOSING:
        // COMPOSER completes, wait for ARCHITECT
        if (phase === 'ARCHITECT') return ChapterState.WRITING;
        return null;

      case ChapterState.WRITING:
        if (phase === 'WRITER') return ChapterState.OBSERVING;
        return null;

      case ChapterState.OBSERVING:
        if (phase === 'OBSERVER') return ChapterState.AUDITING;
        return null;

      case ChapterState.AUDITING:
        // AUDITOR runs and produces audit result
        // Next phase is NORMALIZER (after AUDIT_PASS) or REVISER (after AUDIT_FAIL)
        if (phase === 'AUDITOR') return ChapterState.NORMALIZING;
        if (phase === 'REVISER') return ChapterState.AUDITING; // Re-audit
        return null;

      case ChapterState.REVISING:
        // REVISER fixes issues, then re-audit
        if (phase === 'REVISER') return ChapterState.AUDITING;
        return null;

      case ChapterState.NORMALIZING:
        if (phase === 'NORMALIZER') return ChapterState.EDITING;
        return null;

      case ChapterState.EDITING:
        if (phase === 'EDITOR') return ChapterState.TRUTH_UPDATING;
        return null;

      case ChapterState.TRUTH_UPDATING:
        if (phase === 'FACTS-KEEPER') return ChapterState.COMPLETED;
        return null;

      default:
        return null;
    }
  }

  isTerminalState(chapterId: string): boolean {
    const state = this.getState(chapterId);
    return (
      state === ChapterState.COMPLETED ||
      state === ChapterState.CANCELLED ||
      state === ChapterState.FAILED
    );
  }

  needsIntervention(chapterId: string): boolean {
    return this.getState(chapterId) === ChapterState.PAUSED;
  }

  reset(chapterId: string): void {
    this.chapterStates.delete(chapterId);
    this.chapterPhases.delete(chapterId);
  }

  getAllStates(): Map<string, ChapterState> {
    return new Map(this.chapterStates);
  }

  private setupEventHandlers(): void {
    this.eventBus.subscribe(EventType.CHAPTER_STARTED, (event) => {
      const e = event as ChapterStartedEvent;
      this.initialize(e.chapterId || `${e.bookId}-${e.chapterNumber}`);
    });

    this.eventBus.subscribe(EventType.PHASE_COMPLETED, (event) => {
      const e = event as any;
      const chapterId = e.chapterId as string;
      const phase = e.phase as PhaseName;
      if (chapterId) {
        this.transition(chapterId, phase, 'COMPLETED');
      }
    });

    this.eventBus.subscribe(EventType.PHASE_FAILED, (event) => {
      const e = event as any;
      const chapterId = e.chapterId as string;
      if (chapterId) {
        this.chapterStates.set(chapterId, ChapterState.FAILED);
      }
    });
  }
}
