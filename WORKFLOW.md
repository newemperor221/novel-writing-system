# Novel Writing Workflow — Technical Documentation

## Overview

The novel-writing-workflow is an **event-driven multi-agent orchestration system** for Chinese web novel writing (番茄/起点 platforms). It replaces the legacy sequential phase executor with an event-driven architecture where agents communicate via a pub/sub event bus and execute in parallel when dependencies are satisfied.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      EVENT BUS                               │
│         (发布/订阅，Agent 之间通信)                            │
└─────────────────────────────────────────────────────────────┘
              │           │           │
              ▼           ▼           ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  WORKFLOW   │  │    AGENT    │  │    STATE    │
│   ENGINE    │  │   REGISTRY  │  │   MACHINE   │
│ (调度器)     │  │  (Agent定义) │  │ (生命周期)   │
└─────────────┘  └─────────────┘  └─────────────┘
```

### Core Components

| Component | File | Responsibility |
|-----------|------|----------------|
| **EventBus** | `src/events/EventBus.ts` | Pub/sub communication between agents |
| **WorkflowEngine** | `src/engine/WorkflowEngine.ts` | Main orchestrator, coordinates pipeline |
| **PhaseScheduler** | `src/engine/PhaseScheduler.ts` | Parallel phase execution |
| **DependencyGraph** | `src/engine/DependencyGraph.ts` | DAG for phase ordering |
| **ChapterStateMachine** | `src/state-machine/ChapterStateMachine.ts` | Chapter lifecycle states |
| **AgentRegistry** | `src/agents/AgentRegistry.ts` | Agent registration and lookup |
| **LegacyAgentWrapper** | `src/agents/legacy/LegacyAgentWrapper.ts` | Wraps agents/*.md for event system |

---

## Event System

### Event Types

| Event | Source | Meaning |
|-------|--------|---------|
| `CHAPTER_STARTED` | Engine | Chapter writing begins |
| `CHAPTER_COMPLETED` | Engine | Chapter writing finished successfully |
| `CHAPTER_PAUSED` | Engine | Waiting for human intervention |
| `PHASE_STARTED` | Agent | A phase (PLANNER, WRITER, etc.) began |
| `PHASE_COMPLETED` | Agent | A phase finished successfully |
| `PHASE_FAILED` | Agent | A phase encountered an error |
| `AUDIT_PASSED` | AUDITOR | Chapter passed 3-layer audit |
| `AUDIT_FAILED` | AUDITOR | Chapter failed audit, needs revision |
| `PLANNER_COMPLETED` | PLANNER | Intent document ready |

### Event Bus API

```typescript
// Subscribe to an event
const sub = eventBus.subscribe(EventType.PHASE_COMPLETED, (event) => {
  console.log('Phase completed:', event.phase);
});

// Wait for an event (one-time)
const event = await eventBus.waitFor(EventType.CHAPTER_COMPLETED, 60000);

// Publish an event
await eventBus.publish({
  type: EventType.PHASE_COMPLETED,
  phase: 'WRITER',
  chapterId: 'mybook-chapter-001',
  timestamp: new Date().toISOString(),
});
```

---

## Phase Dependencies (DAG)

```
PLANNER
   │
   ├──► ARCHITECT ──┐
   │                │
   └──► COMPOSER  ──┴────► WRITER ──► OBSERVER ──► AUDITOR
                                                             │
                                           ┌─────────────────┴─────────────────┐
                                      PASS                          FAIL
                                           │                              │
                                       (skip)                    REVISER ──► (re-audit)
                                           │                              │
                                           └──────────────────────────────┘
                                                              │
                                           ┌─────────────────┴─────────────────┐
                                    NORMALIZING ◄──────────► EDITING (并行)
                                                              │
                                                              ▼
                                                    TRUTH_UPDATING → COMPLETED
```

### Parallel Execution

- **ARCHITECT** and **COMPOSER** run in parallel (both depend only on PLANNER output)
- **NORMALIZER** and **EDITOR** run in parallel (both depend on REVISER output)
- **REVISER** loops until AUDITOR passes

---

## Workflow Modes

| Mode | Description |
|------|-------------|
| `FULL` | Complete pipeline with audit (default) |
| `FAST` | Skip audit (same as `--skip-audit`) |
| `AUDIT_ONLY` | Only run AUDITOR on existing draft |
| `REVISE_ONLY` | Only run REVISER on existing audit |
| `EXPORT_ONLY` | Only run EDITOR for export |

---

## Chapter State Machine

```
CREATED → PLANNING → ARCHITECTING/COMPOSING → WRITING → OBSERVING → AUDITING
                                                                      │
                                          ┌─────────────────┴─────────────────┐
                                     PASS                          FAIL
                                           │                              │
                                       (skip)                    REVISING
                                           │                              │
                                           └──────────────────────────────┘
                                                              │
                                          ┌─────────────────┴─────────────────┐
                                    NORMALIZING ◄──────────► EDITING (并行)
                                                              │
                                                              ▼
                                                    TRUTH_UPDATING → COMPLETED
                                                             │
                                                             ▼
                                                         PAUSED (if CRITICAL issues)
```

### State Definitions

| State | Meaning |
|-------|---------|
| `CREATED` | Chapter initialized, not yet started |
| `PLANNING` | PLANNER is producing intent document |
| `ARCHITECTING` | ARCHITECT is designing chapter structure |
| `COMPOSING` | COMPOSER is building context and rules |
| `WRITING` | WRITER is generating prose |
| `OBSERVING` | OBSERVER is extracting facts |
| `AUDITING` | AUDITOR is running 3-layer audit |
| `REVISING` | REVISER is fixing issues |
| `NORMALIZING` | NORMALIZER is adjusting word count |
| `EDITING` | EDITOR is applying platform format |
| `TRUTH_UPDATING` | FACTS-KEEPER is updating truth files |
| `COMPLETED` | Chapter finished successfully |
| `PAUSED` | Awaiting human intervention |

---

## Agent Roles

| Agent | Input | Output | Parallel With |
|-------|-------|--------|---------------|
| **PLANNER** | author_intent, current_state | 01-intent.md | - |
| **ARCHITECT** | 01-intent.md | 02-architecture.md | COMPOSER |
| **COMPOSER** | truth files | 03-context.json, 04-rule-stack.yaml | ARCHITECT |
| **WRITER** | intent, architecture, context | 05-draft.md | - |
| **OBSERVER** | 05-draft.md | 06-facts.json | - |
| **AUDITOR** | draft, facts, truth files | 07-audit.json | - |
| **REVISER** | draft, audit, intent | 08-revised.md | - |
| **NORMALIZER** | 08-revised.md | 09-normalized.md | EDITOR |
| **EDITOR** | 09-normalized.md | 10-final.md, books/*.md | NORMALIZER |
| **FACTS-KEEPER** | 06-facts.json, truth files | Updated truth files | - |

---

## Truth Files (7 per book)

| File | Purpose |
|------|---------|
| `current_state.json` | World state: location, protagonist, enemies, known truths |
| `particle_ledger.json` | Resource tracking: spiritual energy, money, reputation |
| `pending_hooks.json` | Plot hooks: status (open/progressing/deferred/resolved) |
| `chapter_summaries.json` | Per-chapter summaries: characters, events, state changes |
| `subplot_board.json` | Subplot progress tracking |
| `emotional_arcs.json` | Character emotional arcs |
| `character_matrix.json` | Character relationships and interaction history |

**Immutability rule**: Never modify truth files in-place. Always create new objects.

---

## Anti-AI-Taste System

### 3-Layer Detection

1. **Layer 1 — Vocabulary Fatigue**: Banned words (因此、然而、但是、于是...)
2. **Layer 2 — Structural AI-Tells**: Paragraph uniformity, hedge density, transition repetition
3. **Layer 3 — Long-Span Fatigue**: Cross-chapter monotony in type/mood/title/opening/ending

### Banned Words (WRITER prompt)

```
禁止词: 因此、然而、但是、于是、总之、可见、众所周知
       此时、此刻、就在这时、不由得、情不自禁
       猛然、骤然、陡然、猝然、霍然、缓缓、渐渐、逐步
```

---

## Platform Support

| Platform | Format | Max Words/Chapter |
|----------|--------|-------------------|
| 番茄小说 | TXT, EPUB | 3,000 |
| 起点中文网 | HTML | 5,000 |

### Platform Word Count Targets

**番茄小说**:
- Ideal: 2,800
- Acceptable: 2,520 - 3,080

**起点中文网**:
- Ideal: 4,000
- Acceptable: 3,600 - 4,400

---

## Directory Structure

```
novel-writing-workflow/
├── src/
│   ├── orchestrator.ts           # CLI entry point
│   ├── events/
│   │   ├── EventBus.ts           # Pub/sub for agent communication
│   │   └── EventTypes.ts         # Event type definitions
│   ├── engine/
│   │   ├── WorkflowEngine.ts     # Main workflow coordinator
│   │   ├── PhaseScheduler.ts      # Parallel phase execution
│   │   └── DependencyGraph.ts    # DAG for phase dependencies
│   ├── agents/
│   │   ├── AgentBase.ts          # Base class for agents
│   │   ├── AgentRegistry.ts      # Agent registration
│   │   └── legacy/
│   │       └── LegacyAgentWrapper.ts  # Wrap existing agents/*.md
│   └── state-machine/
│       └── ChapterStateMachine.ts     # Chapter lifecycle states
├── agents/                       # Native Claude Code agent definitions
│   ├── PLANNER.md
│   ├── ARCHITECT.md
│   ├── COMPOSER.md
│   ├── WRITER.md
│   ├── OBSERVER.md
│   ├── AUDITOR.md
│   ├── REVISER.md
│   ├── NORMALIZER.md
│   ├── EDITOR.md
│   └── FACTS-KEEPER.md
├── state/                        # Truth files (per book)
│   └── {book-id}/
├── runtime/                      # Per-chapter working files
│   └── {book-id}/
│       └── chapter-{n}/
└── books/                        # Published content
    └── {book-id}/
        └── chapters/
```

---

## Runtime Files (per chapter)

| File | Phase | Purpose |
|------|-------|---------|
| `01-intent.md` | PLANNER | Chapter intent (must-keep/must-avoid) |
| `02-architecture.md` | ARCHITECT | Chapter structure (scenes, beats, pacing) |
| `03-context.json` | COMPOSER | Relevant context from truth files |
| `04-rule-stack.yaml` | COMPOSER | Rule priority stack |
| `05-draft.md` | WRITER | Raw chapter prose |
| `06-facts.json` | OBSERVER | Extracted facts for truth files |
| `07-audit.json` | AUDITOR | Audit results (PASS/FAIL/issues) |
| `08-revised.md` | REVISER | Auto-fixed draft |
| `09-normalized.md` | NORMALIZER | Word-count-adjusted draft |
| `10-final.md` | EDITOR | Platform-formatted final draft |

---

## CLI Usage

```bash
# Full pipeline with audit
./scripts/write-next.sh <book-id>

# Fast mode (skip audit)
./scripts/write-next.sh <book-id> --skip-audit

# Specific chapter
./scripts/write-next.sh <book-id> --chapter 5

# With context hint
./scripts/write-next.sh <book-id> --context "继续剧情，保持节奏"

# Force overwrite
./scripts/write-next.sh <book-id> --chapter 3 --force

# Audit only
./scripts/audit.sh <book-id> 5

# Export for platform
./scripts/export.sh <book-id> --platform tangfan

# Daemon mode (background writing)
./scripts/daemon.sh <book-id> --count 10 --notify
```

---

## Key Constraints

1. **Immutability**: Never modify truth files in-place. Always create new objects.
2. **Zod validation**: All truth file updates must pass Zod schema validation.
3. **No hard truncation**: Word count normalization uses expand/compress, not cut.
4. **Human gate**: CRITICAL issues pause the pipeline for human review.
5. **Parallel safety**: ARCHITECT and COMPOSER outputs must not conflict; both write to different files.
