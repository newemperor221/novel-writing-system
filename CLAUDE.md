# Novel Writing Multi-Agent System

Event-driven multi-agent orchestration system for Chinese web novel writing (番茄/起点 platforms).

## Architecture

**Event-driven architecture** with parallel execution support:

- **11 specialized agents** defined in `agents/*.md` (YAML frontmatter + markdown prompts)
- **Event Bus** (`src/events/EventBus.ts`) for agent communication via pub/sub
- **Workflow Engine** (`src/engine/WorkflowEngine.ts`) coordinates the pipeline
- **Phase Scheduler** (`src/engine/PhaseScheduler.ts`) enables parallel execution
- **7 truth files** per book as the single source of truth
- **3-layer AI-taste + fatigue + continuity audit** for every chapter
- **Anti-AI-taste** at 3 layers: vocabulary, sentence patterns, style fingerprint

### Key Components

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

### Parallel Execution

```
PLANNER
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
                                         NORMALIZER ◄──────────► EDITOR (并行)
                                                              │
                                                              ▼
                                                    FACTS-KEEPER
```

## Quick Start

```bash
# Initialize a new book
./scripts/init-book.sh "我的小说" --genre xuanhuan --platform tangfan

# Write next chapter (full pipeline with audit)
./scripts/write-next.sh <book-id>

# Write next chapter (fast mode, skip audit)
./scripts/write-next.sh <book-id> --skip-audit

# Audit existing chapter
./scripts/audit.sh <book-id> 5

# Export for platform
./scripts/export.sh <book-id> --platform tangfan

# Start daemon (background writing)
./scripts/daemon.sh <book-id> --count 10 --notify
```

## Workflow Modes

| Mode | Description |
|------|-------------|
| `FULL` | Complete pipeline with audit (default) |
| `FAST` | Skip audit (same as `--skip-audit`) |
| `AUDIT_ONLY` | Only run AUDITOR on existing draft |
| `REVISE_ONLY` | Only run REVISER on existing audit |
| `EXPORT_ONLY` | Only run EDITOR for export |

## Source Structure

```
src/
├── orchestrator.ts              # CLI entry point
├── events/
│   ├── EventBus.ts             # Pub/sub for agent communication
│   └── EventTypes.ts           # Event type definitions
├── engine/
│   ├── WorkflowEngine.ts        # Main workflow coordinator
│   ├── PhaseScheduler.ts       # Parallel phase execution
│   └── DependencyGraph.ts      # DAG for phase dependencies
├── agents/
│   ├── AgentBase.ts            # Base class for agents
│   ├── AgentRegistry.ts        # Agent registration
│   └── legacy/
│       └── LegacyAgentWrapper.ts  # Wrap existing agents/*.md
└── state-machine/
    └── ChapterStateMachine.ts   # Chapter lifecycle states
```

## Agent Roles

Each agent is a **native Claude Code agent** defined in `agents/*.md` with YAML frontmatter. The `LegacyAgentWrapper` spawns them via `claude --print --agent`.

### RADAR
Market trend scanner. Scans 番茄/起点 for hot tropes and reader preferences.

### PLANNER
Reads author intent + truth files → produces chapter intent (must-keep/must-avoid).

### ARCHITECT
Designs chapter structure: scenes, beats, pacing arc. **Runs in parallel with COMPOSER.**

### COMPOSER
Compiles relevant context from truth files, builds rule priority stack. **Runs in parallel with ARCHITECT.**

### WRITER
Generates raw chapter prose with anti-AI-taste rules active.

### OBSERVER
Extracts 9 categories of facts from draft for truth file updates.

### AUDITOR
3-layer audit: (1) Structural AI-Tell, (2) Long-Span Fatigue, (3) Continuity + Poison Points.

### REVISER
Auto-fixes CRITICAL/HIGH issues. Runs in loop until AUDITOR passes.

### NORMALIZER
Adjusts word count to target range without cutting plot. **Runs in parallel with EDITOR.**

### EDITOR
Applies platform format (番茄 or 起点). **Runs in parallel with NORMALIZER.**

### FACTS-KEEPER
Updates all 7 truth files atomically with Zod schema validation.

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
```

## Directory Structure

```
novel-writing-workflow/
├── CLAUDE.md                    # This file
├── WORKFLOW.md                  # Detailed technical documentation
├── agents/                      # Native Claude Code agent definitions
│   ├── RADAR.md
│   ├── PLANNER.md
│   ├── COMPOSER.md
│   ├── ARCHITECT.md
│   ├── WRITER.md
│   ├── OBSERVER.md
│   ├── AUDITOR.md
│   ├── REVISER.md
│   ├── NORMALIZER.md
│   ├── EDITOR.md
│   ├── FACTS-KEEPER.md
│   └── ORCHESTRATOR.md
├── scripts/                     # Executable workflow scripts
│   ├── init-book.sh
│   ├── write-next.sh           # Primary entry point
│   ├── audit.sh
│   ├── export.sh
│   └── daemon.sh
├── src/                        # TypeScript source
│   ├── orchestrator.ts         # CLI entry point
│   ├── events/                 # Event-driven infrastructure
│   ├── engine/                 # Workflow engine
│   ├── agents/                 # Agent framework
│   └── state-machine/          # State machine
├── state/                      # Truth files (per book)
│   └── {book-id}/
├── runtime/                     # Per-chapter working files
│   └── {book-id}/
│       └── chapter-{n}/
├── books/                      # Published content
│   └── {book-id}/
│       └── chapters/
├── config/                     # Configuration
│   ├── platforms/
│   ├── genres/
│   ├── fatigue_lexicon/
│   └── banned_patterns/
└── world/                      # Multi-book world/series management
```

## Anti-AI-Taste Layers

1. **Layer 1 — Vocabulary Fatigue**: banned words (因此、然而、但是...)
2. **Layer 2 — Structural AI-Tells**: paragraph uniformity, hedge density, transition repetition
3. **Layer 3 — Long-Span Fatigue**: cross-chapter monotony in type/mood/title/opening/ending

## Platform Support

| Platform | Format | Max Words/Chapter |
|----------|--------|-------------------|
| 番茄小说 | TXT, EPUB | 3,000 |
| 起点中文网 | HTML | 5,000 |

## Key Constraints

- **Immutability**: Never modify truth files in-place. Always create new objects.
- **Zod validation**: All truth file updates must pass Zod schema validation.
- **No hard truncation**: Word count normalization uses expand/compress, not cut.
- **Human gate**: CRITICAL issues pause the pipeline for human review.
