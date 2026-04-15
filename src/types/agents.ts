// Type definitions for all agents in the novel writing pipeline

export interface ChapterContext {
  bookId: string
  chapterNumber: number
  platform: 'tangfan' | 'qidian'
  genre: string
  targetWordCount: {
    ideal: number
    min: number
    max: number
  }
}

// ============================================================
// PLANNER Agent
// ============================================================

export interface PlannerInput {
  bookId: string
  chapterNumber: number
  targetWordCount: { ideal: number; min: number; max: number }
  genre: string
  platform: 'tangfan' | 'qidian'
  currentState: unknown
  pendingHooks: unknown
  recentChapters: unknown[]
}

export interface PlannerOutput {
  intentFile: string
  title: string
  pov: string
  timeline: string
  location: string
  corePurpose: string[]
  mustKeep: string[]
  mustAvoid: string[]
  hookStrategy: Record<string, string>
  emotionalArcPlan: string
}

// ============================================================
// ARCHITECT Agent
// ============================================================

export interface Scene {
  name: string
  location: string
  pov: string
  purpose: string
  keyBeats: { beat: string; emotionalBeat: string }[]
  wordCountEstimate: { min: number; max: number }
}

export interface TensionBeat {
  position: number
  event: string
  wordCount: number
}

export interface ArchitectInput {
  bookId: string
  chapterNumber: number
  intent: string
  currentState: unknown
  genre: string
  platform: 'tangfan' | 'qidian'
  targetWordCount: number
}

export interface ArchitectOutput {
  architectureFile: string
  sceneBreakdown: Scene[]
  pacingArc: string
  tensionBeats: TensionBeat[]
}

// ============================================================
// COMPOSER Agent
// ============================================================

export interface ComposerInput {
  bookId: string
  chapterNumber: number
  intent: string
  architecture: string
  truthFiles: {
    chapterSummaries: unknown[]
    pendingHooks: unknown[]
    particleLedger: unknown
    characterMatrix: unknown
    emotionalArcs: unknown
  }
}

export interface ComposerOutput {
  contextFile: string
  ruleStackFile: string
  context: unknown
  ruleStack: string
}

// ============================================================
// WRITER Agent
// ============================================================

export interface WriterInput {
  bookId: string
  chapterNumber: number
  platform: 'tangfan' | 'qidian'
  targetWordCount: { ideal: number; min: number; max: number }
  intent: string
  architecture: string
  context: unknown
  ruleStack: string
}

export interface WriterOutput {
  draftFile: string
  wordCount: number
}

// ============================================================
// OBSERVER Agent
// ============================================================

export interface CharacterStateFact {
  name: string
  physical: string
  emotional: string
  statusChange: string
}

export interface LocationFact {
  name: string
  firstSeenChapter: number
  features: string
  significance: string
}

export interface ResourceChange {
  type: string
  delta: number
  reason: string
  newTotal: number
}

export interface RelationshipFact {
  charA: string
  charB: string
  type: string
  change: string
  reason: string
}

export interface InformationFact {
  info: string
  source: string
  recipient: string
  truthFile: string
}

export interface HookUpdate {
  hookId: string
  description: string
  status: 'open' | 'progressing' | 'resolved'
  resolutionChapter: number | null
}

export interface EmotionalArcUpdate {
  character: string
  stateAtEnd: string
  direction: 'up' | 'down' | 'stable'
  trigger: string
}

export interface PhysicalObjectFact {
  object: string
  location: string
  owner: string
  stateChange: string
}

export interface TimeProgression {
  elapsed: string
  storyTime: string
  chapterCount: number
}

export interface ObserverInput {
  bookId: string
  chapterNumber: number
  draft: string
}

export interface ObserverOutput {
  factsFile: string
  factCategories: {
    characterStates: CharacterStateFact[]
    locationUpdates: LocationFact[]
    resourceChanges: ResourceChange[]
    relationshipUpdates: RelationshipFact[]
    informationRevealed: InformationFact[]
    hookUpdates: HookUpdate[]
    emotionalArcUpdates: EmotionalArcUpdate[]
    physicalObjects: PhysicalObjectFact[]
    timeProgression: TimeProgression
  }
  metadata: {
    totalFacts: number
    uncertainCount: number
  }
}

// ============================================================
// AUDITOR Agent
// ============================================================

export type SeverityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

export interface AuditIssue {
  dimension: string
  severity: SeverityLevel
  description: string
  location: string
  quote: string
  recommendation: string
}

export interface AITasteFlag {
  type: 'vocabulary' | 'sentence_pattern' | 'paragraph_length'
  word?: string
  pattern?: string
  location: string
  suggestion: string
}

export interface AuditorInput {
  bookId: string
  chapterNumber: number
  draft: string
  facts: unknown
  truthFiles: {
    currentState: unknown
    pendingHooks: unknown
    characterMatrix: unknown
    emotionalArcs: unknown
  }
}

export interface AuditorOutput {
  auditFile: string
  overallResult: 'PASS' | 'FAIL'
  issues: AuditIssue[]
  aiTasteFlags: AITasteFlag[]
  summary: {
    totalIssues: number
    bySeverity: Record<SeverityLevel, number>
    aiTasteFlagsCount: number
  }
}

// ============================================================
// REVISER Agent
// ============================================================

export interface ReviserInput {
  bookId: string
  chapterNumber: number
  originalDraft: string
  audit: AuditorOutput
  intent: string
}

export interface ReviserOutput {
  revisedFile: string
  fixedIssues: string[]
  remainingIssues: AuditIssue[]
}

// ============================================================
// NORMALIZER Agent
// ============================================================

export interface NormalizerInput {
  bookId: string
  chapterNumber: number
  draft: string
  targetRange: { min: number; max: number }
  platform: 'tangfan' | 'qidian'
}

export interface NormalizerOutput {
  normalizedFile: string
  finalWordCount: number
  adjustments: string[]
}

// ============================================================
// EDITOR Agent
// ============================================================

export interface EditorInput {
  bookId: string
  chapterNumber: number
  draft: string
  platform: 'tangfan' | 'qidian'
}

export interface EditorOutput {
  finalFile: string
  platformFile: string
}

// ============================================================
// FACTS-KEEPER Agent
// ============================================================

export interface TruthFileUpdate {
  currentState?: unknown
  particleLedger?: unknown
  pendingHooks?: unknown
  chapterSummaries?: unknown
  subplotBoard?: unknown
  emotionalArcs?: unknown
  characterMatrix?: unknown
}

export interface FactsKeeperInput {
  bookId: string
  chapterNumber: number
  extractedFacts: ObserverOutput['factCategories']
  currentTruthFiles: {
    current_state: unknown
    particle_ledger: unknown
    pending_hooks: unknown
    chapter_summaries: unknown
    subplot_board: unknown
    emotional_arcs: unknown
    character_matrix: unknown
  }
}

export interface FactsKeeperOutput {
  updatedTruthFiles: string[]
  validationResults: { file: string; valid: boolean; errors?: string[] }[]
}

// ============================================================
// Webhook
// ============================================================

export interface WebhookPayload {
  event: 'chapter_completed' | 'critical_issue' | 'daemon_stopped'
  timestamp: string
  bookId: string
  chapter: number
  chapterTitle?: string
  wordCount?: number
  auditResult?: 'PASS' | 'FAIL'
  executionTimeSeconds?: number
  criticalIssues?: AuditIssue[]
  nextChapterPreview?: string
}

// ============================================================
// Pipeline State
// ============================================================

export type PipelinePhase =
  | 'INIT'
  | 'PLANNER'
  | 'ARCHITECT'
  | 'COMPOSER'
  | 'WRITER'
  | 'OBSERVER'
  | 'AUDITOR'
  | 'REVISER_LOOP'
  | 'NORMALIZER'
  | 'EDITOR'
  | 'FACTS_KEEPER'
  | 'COMPLETE'
  | 'FAILED'

export interface ExecutionLogEntry {
  timestamp: string
  phase: PipelinePhase
  status: 'STARTED' | 'COMPLETED' | 'FAILED'
  details?: string
}

export interface PipelineState {
  bookId: string
  chapterNumber: number
  phase: PipelinePhase
  auditLoopCount: number
  maxAuditLoops: number
  auditPassed?: boolean
  issues: AuditIssue[]
  executionLog: ExecutionLogEntry[]
}

// ============================================================
// RADAR Agent
// ============================================================

export interface RadarOutput {
  hotTropes: string[]
  decliningTropes: string[]
  recommendations: {
    what: string
    why: string
    risk: 'Low' | 'Medium' | 'High'
    priority: number
  }[]
  aiTasteWarnings: string[]
}
