/**
 * Event Types for the Novel Writing Workflow Event-Driven System
 */

// ============================================================
// Phase Names
// ============================================================

export type PhaseName =
  | 'PLANNER'
  | 'ARCHITECT'
  | 'COMPOSER'
  | 'WRITER'
  | 'OBSERVER'
  | 'AUDITOR'
  | 'REVISER'
  | 'NORMALIZER'
  | 'EDITOR'
  | 'FACTS-KEEPER'
  | 'RADAR';

// ============================================================
// Workflow Modes
// ============================================================

export enum WorkflowMode {
  FULL = 'FULL',                   // Complete pipeline with audit
  FAST = 'FAST',                   // Skip audit (write-next --no-audit equivalent)
  AUDIT_ONLY = 'AUDIT_ONLY',       // Only run AUDITOR on existing draft
  REVISE_ONLY = 'REVISE_ONLY',     // Only run REVISER on existing audit
  EXPORT_ONLY = 'EXPORT_ONLY',     // Only run EDITOR for export
  PLAN_ONLY = 'PLAN_ONLY',         // Only run PLANNER + ARCHITECT
}

// ============================================================
// Chapter States
// ============================================================

export enum ChapterState {
  CREATED = 'CREATED',
  PLANNING = 'PLANNING',
  ARCHITECTING = 'ARCHITECTING',
  COMPOSING = 'COMPOSING',
  WRITING = 'WRITING',
  OBSERVING = 'OBSERVING',
  AUDITING = 'AUDITING',
  REVISING = 'REVISING',
  NORMALIZING = 'NORMALIZING',
  EDITING = 'EDITING',
  TRUTH_UPDATING = 'TRUTH_UPDATING',
  COMPLETED = 'COMPLETED',
  PAUSED = 'PAUSED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

// ============================================================
// Event Type Enum
// ============================================================

export enum EventType {
  // Phase lifecycle
  PHASE_STARTED = 'PHASE_STARTED',
  PHASE_COMPLETED = 'PHASE_COMPLETED',
  PHASE_FAILED = 'PHASE_FAILED',

  // Chapter lifecycle
  CHAPTER_STARTED = 'CHAPTER_STARTED',
  CHAPTER_COMPLETED = 'CHAPTER_COMPLETED',
  CHAPTER_PAUSED = 'CHAPTER_PAUSED',
  CHAPTER_RESUMED = 'CHAPTER_RESUMED',
  CHAPTER_CANCELLED = 'CHAPTER_CANCELLED',

  // Specific phase outputs
  INTENT_COMPLETED = 'INTENT_COMPLETED',
  ARCHITECTURE_COMPLETED = 'ARCHITECTURE_COMPLETED',
  CONTEXT_COMPLETED = 'CONTEXT_COMPLETED',
  DRAFT_COMPLETED = 'DRAFT_COMPLETED',
  FACTS_EXTRACTED = 'FACTS_EXTRACTED',
  AUDIT_COMPLETED = 'AUDIT_COMPLETED',
  REVISION_COMPLETED = 'REVISION_COMPLETED',
  NORMALIZATION_COMPLETED = 'NORMALIZATION_COMPLETED',
  EDIT_COMPLETED = 'EDIT_COMPLETED',
  TRUTH_UPDATED = 'TRUTH_UPDATED',

  // Audit events
  AUDIT_PASSED = 'AUDIT_PASSED',
  AUDIT_FAILED = 'AUDIT_FAILED',

  // System events
  WORKFLOW_MODE_CHANGED = 'WORKFLOW_MODE_CHANGED',
  BACKPRESSURE_DETECTED = 'BACKPRESSURE_DETECTED',
  ERROR_RECOVERED = 'ERROR_RECOVERED',
}

// ============================================================
// Base Event Interface
// ============================================================

export interface BaseEvent {
  type: EventType;
  timestamp: string;
  chapterId?: string;
  bookId?: string;
  chapterNumber?: number;
}

// ============================================================
// Phase Lifecycle Events
// ============================================================

export interface PhaseStartedEvent extends BaseEvent {
  type: EventType.PHASE_STARTED;
  phase: PhaseName;
  metadata?: Record<string, unknown>;
}

export interface PhaseCompletedEvent extends BaseEvent {
  type: EventType.PHASE_COMPLETED;
  phase: PhaseName;
  outputFiles: string[];
  duration: number; // ms
}

export interface PhaseFailedEvent extends BaseEvent {
  type: EventType.PHASE_FAILED;
  phase: PhaseName;
  error: string;
  retryable: boolean;
}

// ============================================================
// Chapter Lifecycle Events
// ============================================================

export interface ChapterStartedEvent extends BaseEvent {
  type: EventType.CHAPTER_STARTED;
  bookId: string;
  chapterNumber: number;
  mode: WorkflowMode;
}

export interface ChapterCompletedEvent extends BaseEvent {
  type: EventType.CHAPTER_COMPLETED;
  bookId: string;
  chapterNumber: number;
  outputFile: string;
  wordCount: number;
  auditResult: 'PASS' | 'FAIL';
  duration: number;
}

export interface ChapterPausedEvent extends BaseEvent {
  type: EventType.CHAPTER_PAUSED;
  bookId: string;
  chapterNumber: number;
  reason: string;
  blockerIssue?: unknown;
}

export interface ChapterResumedEvent extends BaseEvent {
  type: EventType.CHAPTER_RESUMED;
  bookId: string;
  chapterNumber: number;
  resumeReason?: string;
}

export interface ChapterCancelledEvent extends BaseEvent {
  type: EventType.CHAPTER_CANCELLED;
  bookId: string;
  chapterNumber: number;
  reason: string;
}

// ============================================================
// Audit Events
// ============================================================

export interface AuditPassedEvent extends BaseEvent {
  type: EventType.AUDIT_PASSED;
  chapterId: string;
  issues: AuditIssue[];
}

export interface AuditFailedEvent extends BaseEvent {
  type: EventType.AUDIT_FAILED;
  chapterId: string;
  criticalIssues: AuditIssue[];
  highIssues: AuditIssue[];
  mediumIssues: AuditIssue[];
}

export interface AuditIssue {
  dimension: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  location?: string;
  quote?: string;
  recommendation?: string;
}

// ============================================================
// Phase-Specific Output Events
// ============================================================

export interface IntentCompletedEvent extends BaseEvent {
  type: EventType.INTENT_COMPLETED;
  chapterId: string;
  outputFile: string;
  intent: {
    title?: string;
    targetWordCount: number;
    mustKeep: string[];
    mustAvoid: string[];
  };
}

export interface ArchitectureCompletedEvent extends BaseEvent {
  type: EventType.ARCHITECTURE_COMPLETED;
  chapterId: string;
  outputFile: string;
  sceneCount: number;
  pacingArc: string;
}

export interface ContextCompletedEvent extends BaseEvent {
  type: EventType.CONTEXT_COMPLETED;
  chapterId: string;
  outputFile: string;
  tokenBudgetUsed: number;
}

export interface DraftCompletedEvent extends BaseEvent {
  type: EventType.DRAFT_COMPLETED;
  chapterId: string;
  outputFile: string;
  wordCount: number;
}

export interface FactsExtractedEvent extends BaseEvent {
  type: EventType.FACTS_EXTRACTED;
  chapterId: string;
  outputFile: string;
  factCount: number;
  categories: string[];
}

export interface AuditCompletedEvent extends BaseEvent {
  type: EventType.AUDIT_COMPLETED;
  chapterId: string;
  outputFile: string;
  overallResult: 'PASS' | 'FAIL';
  issueCount: number;
}

export interface RevisionCompletedEvent extends BaseEvent {
  type: EventType.REVISION_COMPLETED;
  chapterId: string;
  outputFile: string;
  issuesFixed: number;
  issuesRemaining: number;
}

export interface NormalizationCompletedEvent extends BaseEvent {
  type: EventType.NORMALIZATION_COMPLETED;
  chapterId: string;
  outputFile: string;
  originalWordCount: number;
  normalizedWordCount: number;
}

export interface EditCompletedEvent extends BaseEvent {
  type: EventType.EDIT_COMPLETED;
  chapterId: string;
  outputFile: string;
  platform: string;
}

export interface TruthUpdatedEvent extends BaseEvent {
  type: EventType.TRUTH_UPDATED;
  bookId: string;
  chapterNumber: number;
  filesUpdated: string[];
  hooksOpened: number;
  hooksResolved: number;
}

// ============================================================
// System Events
// ============================================================

export interface WorkflowModeChangeEvent extends BaseEvent {
  type: EventType.WORKFLOW_MODE_CHANGED;
  chapterId: string;
  fromMode: WorkflowMode;
  toMode: WorkflowMode;
  reason: string;
}

export interface BackpressureEvent extends BaseEvent {
  type: EventType.BACKPRESSURE_DETECTED;
  phase: PhaseName;
  queueDepth: number;
  concurrencyLimit: number;
}

export interface ErrorRecoveredEvent extends BaseEvent {
  type: EventType.ERROR_RECOVERED;
  chapterId: string;
  phase: PhaseName;
  error: string;
  recoveryAction: string;
}

// ============================================================
// Union Type for All Events
// ============================================================

export type WorkflowEvent =
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | PhaseFailedEvent
  | ChapterStartedEvent
  | ChapterCompletedEvent
  | ChapterPausedEvent
  | ChapterResumedEvent
  | ChapterCancelledEvent
  | AuditPassedEvent
  | AuditFailedEvent
  | IntentCompletedEvent
  | ArchitectureCompletedEvent
  | ContextCompletedEvent
  | DraftCompletedEvent
  | FactsExtractedEvent
  | AuditCompletedEvent
  | RevisionCompletedEvent
  | NormalizationCompletedEvent
  | EditCompletedEvent
  | TruthUpdatedEvent
  | WorkflowModeChangeEvent
  | BackpressureEvent
  | ErrorRecoveredEvent;

// ============================================================
// Agent Definition
// ============================================================

export interface AgentDefinition {
  name: PhaseName;
  description: string;
  inputs: EventType[];
  outputs: EventType[];
  capabilities: string[];
  model: 'sonnet' | 'opus';
  tools: string[];
}

// ============================================================
// Execution Context
// ============================================================

export interface ExecutionContext {
  bookId: string;
  chapterNumber: number;
  chapterId: string;
  mode: WorkflowMode;
  phase: PhaseName;
  workDir: string;
  runtimeDir: string;
  stateDir: string;
  booksDir: string;
  platform: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// Execution Result
// ============================================================

export interface ExecutionResult {
  success: boolean;
  outputs: string[];
  duration: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// Workflow Result
// ============================================================

export interface WorkflowResult {
  success: boolean;
  bookId: string;
  chapterNumber: number;
  outputFile?: string;
  wordCount?: number;
  auditResult?: 'PASS' | 'FAIL';
  duration: number;
  error?: string;
  phasesCompleted: PhaseName[];
}

// ============================================================
// Dependency Graph Types
// ============================================================

export interface DependencyEdge {
  from: PhaseName;
  to: PhaseName;
  type: 'sequential' | 'parallel';
}

export interface PhaseDependencies {
  phase: PhaseName;
  requires: PhaseName[];
  requiredOutputs: string[];
  produces: string[];
  canRunParallelWith: PhaseName[];
}
