/**
 * Zod schemas for all 7 truth files + supporting types.
 * These schemas validate the structure and invariants of truth file data.
 */

import { z } from 'zod';

// ============================================================
// ENUMS
// ============================================================

export const HookStatus = z.enum(['open', 'progressing', 'deferred', 'resolved']);
export type HookStatus = z.infer<typeof HookStatus>;

export const RelationshipType = z.enum([
  'ally', 'enemy', 'neutral', 'family',
  'romantic', 'master_disciple', 'rival',
]);
export type RelationshipType = z.infer<typeof RelationshipType>;

export const ArcDirection = z.enum(['rising', 'falling', 'stable', 'complex']);
export type ArcDirection = z.infer<typeof ArcDirection>;

export const ParticleType = z.enum([
  'spiritual_energy', 'money', 'reputation',
  'strength', 'intelligence', 'charisma', 'custom',
]);
export type ParticleType = z.infer<typeof ParticleType>;

export const HealthStatus = z.enum(['active', 'injured', 'captured', 'missing', 'deceased']);
export type HealthStatus = z.infer<typeof HealthStatus>;

export const ThreatLevel = z.enum(['low', 'medium', 'high', 'critical']);
export type ThreatLevel = z.infer<typeof ThreatLevel>;

export const EventSignificance = z.enum(['minor', 'major', 'critical']);
export type EventSignificance = z.infer<typeof EventSignificance>;

export const HookPriority = z.enum(['critical', 'high', 'medium', 'low']);
export type HookPriority = z.infer<typeof HookPriority>;

export const SubplotStatus = z.enum(['setup', 'developing', 'near_resolution', 'resolved', 'abandoned']);
export type SubplotStatus = z.infer<typeof SubplotStatus>;

export const SubplotPriority = z.enum(['main', 'secondary', 'filler']);
export type SubplotPriority = z.infer<typeof SubplotPriority>;

export const Platform = z.enum(['tangfan', 'qidian', 'both']);
export type Platform = z.infer<typeof Platform>;

export const Tone = z.enum(['serious', 'humorous', 'dark', 'romantic', 'adventure', 'mixed']);
export type Tone = z.infer<typeof Tone>;

export const UpdateFrequency = z.enum(['daily', 'biweekly', 'weekly', 'flexible']);
export type UpdateFrequency = z.infer<typeof UpdateFrequency>;

export const PlanStatus = z.enum(['planned', 'in_progress', 'completed', 'cancelled']);
export type PlanStatus = z.infer<typeof PlanStatus>;

// ============================================================
// PENDING_HOOKS
// ============================================================

export const HookSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1).max(500),
  originChapter: z.number().int().min(1),
  status: HookStatus,
  expectedResolution: z.string().optional(),
  resolutionChapter: z.number().int().min(1).nullable().optional(),
  deferredReason: z.string().optional(),
  lastAdvancedChapter: z.number().int().min(1),
  priority: HookPriority.default('medium'),
});

export const PendingHooksSchema = z.object({
  hooks: z.array(HookSchema),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// PARTICLE_LEDGER
// ============================================================

export const ParticleEntrySchema = z.object({
  id: z.string().uuid(),
  particleType: ParticleType,
  delta: z.number(), // can be positive or negative
  reason: z.string(),
  chapter: z.number().int().min(1),
  timestamp: z.string().datetime(),
  runningTotal: z.number().int().min(0),
});

export const ParticleCategorySchema = z.object({
  hardCap: z.number().int().min(0).nullable().optional(),
  currentTotal: z.number().int().min(0),
  entries: z.array(ParticleEntrySchema).default([]),
});

export const ParticleLedgerSchema = z.object({
  particles: z.record(ParticleType, ParticleCategorySchema),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// CHARACTER_MATRIX
// ============================================================

export const InteractionSchema = z.object({
  chapter: z.number().int().min(1),
  summary: z.string().max(200),
  interactionType: z.enum(['dialogue', 'battle', 'cooperation', 'conflict', 'observation', 'mentioned']),
  emotionalTone: z.enum(['positive', 'negative', 'neutral', 'ambiguous']).optional(),
});

export const CharacterRelationshipSchema = z.object({
  characterA: z.string(),
  characterB: z.string(),
  relationshipType: RelationshipType,
  status: z.enum(['active', 'strained', 'ended', 'unknown']).default('active'),
  firstInteractionChapter: z.number().int().min(1).optional(),
  interactions: z.array(InteractionSchema).default([]),
  notes: z.string().optional(),
});

export const CharacterMatrixSchema = z.object({
  characters: z.array(z.string()),
  relationships: z.array(CharacterRelationshipSchema),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// EMOTIONAL_ARCS
// ============================================================

export const EmotionalStateSchema = z.object({
  chapter: z.number().int().min(1),
  primary: z.string(),
  secondary: z.array(z.string()).default([]),
  trigger: z.string().optional(),
  intensity: z.number().int().min(1).max(10).default(5),
});

export const CharacterEmotionalArcSchema = z.object({
  character: z.string(),
  arc: ArcDirection,
  states: z.array(EmotionalStateSchema),
  currentState: EmotionalStateSchema,
  trajectory: z.string().optional(),
});

export const EmotionalArcsSchema = z.object({
  characters: z.array(CharacterEmotionalArcSchema),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// SUBPLOT_BOARD
// ============================================================

export const SubplotSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().max(500),
  status: SubplotStatus,
  mainCharacter: z.string(),
  relatedHooks: z.array(z.string().uuid()).default([]),
  lastAdvancedChapter: z.number().int().min(1),
  resolutionChapter: z.number().int().min(1).nullable().optional(),
  priority: SubplotPriority.default('secondary'),
});

export const SubplotBoardSchema = z.object({
  subplots: z.array(SubplotSchema),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// CHAPTER_SUMMARIES
// ============================================================

export const StateChangeSchema = z.object({
  subject: z.string(),
  changeType: z.string(),
  from: z.string().optional(),
  to: z.string(),
  chapter: z.number().int().min(1),
});

export const ChapterSummaryEntrySchema = z.object({
  chapter: z.number().int().min(1),
  title: z.string().optional(),
  pov: z.string().optional(),
  location: z.string().optional(),
  characters: z.array(z.string()),
  events: z.array(z.string()).max(10),
  stateChanges: z.array(StateChangeSchema).default([]),
  wordCount: z.number().int().min(0),
  summary: z.string().max(500),
  keyHooksOpened: z.array(z.string().uuid()).default([]),
  keyHooksResolved: z.array(z.string().uuid()).default([]),
  emotionalBeat: z.string().optional(),
  createdAt: z.string().datetime(),
});

export const ChapterSummariesSchema = z.object({
  chapters: z.array(ChapterSummaryEntrySchema),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// CURRENT_STATE
// ============================================================

export const HealthSchema = z.object({
  physical: z.number().int().min(0).max(100).default(100),
  spiritual: z.number().int().min(0).max(100).default(100),
  mental: z.number().int().min(0).max(100).default(100),
}).optional();

export const ProtagonistStateSchema = z.object({
  name: z.string(),
  level: z.string().optional(),
  coreStats: z.record(z.string(), z.number()).optional(),
  status: HealthStatus.default('active'),
  location: z.string().optional(),
  health: HealthSchema,
});

export const EnemyStateSchema = z.object({
  name: z.string(),
  threatLevel: ThreatLevel,
  status: z.enum(['active', 'defeated', 'fled', 'unknown']).default('active'),
});

export const KnownTruthSchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  revealedChapter: z.number().int().min(1),
  source: z.string().optional(),
});

export const RecentEventSchema = z.object({
  chapter: z.number().int().min(1),
  description: z.string(),
  significance: EventSignificance,
});

export const CurrentStateSchema = z.object({
  bookId: z.string(),
  chapter: z.number().int().min(1),
  location: z.string(),
  timeDescription: z.string().optional(),
  presentCharacters: z.array(z.string()),
  protagonist: ProtagonistStateSchema,
  activeEnemies: z.array(EnemyStateSchema).default([]),
  knownTruths: z.array(KnownTruthSchema).default([]),
  recentEvents: z.array(RecentEventSchema).max(10).default([]),
  worldFlags: z.record(z.string(), z.boolean()).default({}),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// AUTHOR_INTENT
// ============================================================

export const MustKeepElementSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  reason: z.string().optional(),
});

export const MustAvoidElementSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  reason: z.string().optional(),
});

export const PlannedArcSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().max(500),
  plannedChapters: z.tuple([z.number().int(), z.number().int()]).optional(),
  status: PlanStatus.default('planned'),
});

export const AuthorIntentSchema = z.object({
  bookId: z.string(),
  title: z.string(),
  genre: z.string(),
  targetPlatform: Platform.default('both'),
  targetAudience: z.string().optional(),
  coreTheme: z.string().max(200),
  tone: Tone.default('mixed'),
  targetWordCountPerChapter: z.object({
    ideal: z.number().int(),
    min: z.number().int(),
    max: z.number().int(),
  }),
  updateFrequency: UpdateFrequency.default('daily'),
  mustKeepElements: z.array(MustKeepElementSchema).default([]),
  mustAvoidElements: z.array(MustAvoidElementSchema).default([]),
  plannedArcs: z.array(PlannedArcSchema).default([]),
  createdAt: z.string().datetime(),
  lastUpdated: z.string().datetime(),
});

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Hook = z.infer<typeof HookSchema>;
export type PendingHooks = z.infer<typeof PendingHooksSchema>;
export type ParticleEntry = z.infer<typeof ParticleEntrySchema>;
export type ParticleLedger = z.infer<typeof ParticleLedgerSchema>;
export type CharacterMatrix = z.infer<typeof CharacterMatrixSchema>;
export type EmotionalArcs = z.infer<typeof EmotionalArcsSchema>;
export type SubplotBoard = z.infer<typeof SubplotBoardSchema>;
export type ChapterSummaries = z.infer<typeof ChapterSummariesSchema>;
export type CurrentState = z.infer<typeof CurrentStateSchema>;
export type AuthorIntent = z.infer<typeof AuthorIntentSchema>;

// ============================================================
// SCHEMA VERSION TRACKING
// ============================================================

export const SCHEMA_VERSION = '1.0.0';

export const SchemaVersionSchema = z.object({
  version: z.string(),
  createdAt: z.string().datetime(),
  lastMigratedAt: z.string().datetime().optional(),
});
