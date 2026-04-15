# Novel Writing Multi-Agent Workflow

Multi-agent orchestration system for Chinese web novel writing (番茄/起点 platforms).

## Architecture

**Native Claude Code multi-agent system** using `claude --print --agent` for each phase:

- **11 specialized agents** defined in `agents/*.md` (YAML frontmatter + markdown prompts)
- **Node.js orchestrator** (`src/orchestrator.ts`) spawns each agent via `claude --print --agent --dangerously-skip-permissions`
- **7 truth files** per book as the single source of truth
- **33-dimension continuity audit** for every chapter
- **Anti-AI-taste** at 3 layers: vocabulary, sentence patterns, style fingerprint
- **Daemon mode** for background autonomous writing with webhook notifications

## Quick Start

```bash
# Initialize a new book
./scripts/init-book.sh "我的小说" --genre xuanhuan --platform tangfan

# Write next chapter (full pipeline - native Claude Code agents)
./scripts/write-next-native.sh <book-id>

# Audit existing chapter
./scripts/audit.sh <book-id> 5

# Export for platform
./scripts/export.sh <book-id> --platform tangfan

# Start daemon (background writing)
./scripts/daemon.sh <book-id> --count 10 --notify
```

## Agent Roles

Each agent is a **native Claude Code agent** defined in `agents/*.md` with YAML frontmatter:
```yaml
---
name: PLANNER
description: Chapter intent definition
tools: ["Read", "Write", "Glob"]
model: sonnet
---
```

The **Node.js orchestrator** (`src/orchestrator.ts`) spawns each agent via `claude --print --agent`.

### RADAR
Market trend scanner. Scans 番茄/起点 for hot tropes and reader preferences.
**Command**: `./scripts/radar.sh <book-id>`

### PLANNER
Reads author intent + truth files → produces chapter intent (must-keep/must-avoid).
**Output**: `runtime/{book-id}/chapter-{n}/01-intent.md`

### COMPOSER
Compiles relevant context from 7 truth files, builds rule priority stack.
**Input**: All truth files + PLANNER output
**Output**: `runtime/{book-id}/chapter-{n}/03-context.json`, `04-rule-stack.yaml`

### ARCHITECT
Designs chapter structure: scenes, beats, pacing arc.
**Input**: PLANNER intent
**Output**: `runtime/{book-id}/chapter-{n}/02-architecture.md`

### WRITER
Generates raw chapter prose with anti-AI-taste rules active.
**Input**: ARCHITECT blueprint + COMPOSER context
**Output**: `runtime/{book-id}/chapter-{n}/05-draft.md`

### OBSERVER
Extracts 9 categories of facts from draft: character states, locations, resources, relationships, emotions, information, hooks, time, physical state.
**Output**: `runtime/{book-id}/chapter-{n}/06-facts.json`

### AUDITOR
33-dimension continuity audit against 7 truth files.
**Output**: `runtime/{book-id}/chapter-{n}/07-audit.json`

### REVISER
Auto-fixes CRITICAL/HIGH issues identified by AUDITOR. Flags MEDIUM/LOW for human.
**Output**: `runtime/{book-id}/chapter-{n}/08-revised.md`

### NORMALIZER
Adjusts word count to target range (±10%) without cutting plot.
**Output**: `runtime/{book-id}/chapter-{n}/09-normalized.md`

### EDITOR
Applies platform format (番茄 or 起点). Injects chapter title, paragraph separators, hooks.
**Output**: `books/{book-id}/chapters/ch-{n}.md`

### FACTS-KEEPER
Updates all 7 truth files with extracted facts. Zod schema validation on every update.
**Input**: OBSERVER output
**Output**: Updated `state/{book-id}/*.json`

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

## Directory Structure

```
novel-writing-workflow/
├── CLAUDE.md                    # This file
├── WORKFLOW.md                  # Detailed technical documentation
├── agents/                      # Native Claude Code agent definitions (YAML frontmatter)
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
│   └── ORCHESTRATOR.md          # Pipeline orchestrator agent (prompt-based)
├── scripts/                     # Executable workflow scripts
│   ├── init-book.sh
│   ├── write-next-native.sh     # Primary entry point (Node.js orchestrator)
│   ├── audit.sh
│   ├── export.sh
│   └── daemon.sh
├── state/                       # Truth files (per book)
│   └── {book-id}/
│       ├── current_state.json
│       ├── particle_ledger.json
│       ├── pending_hooks.json
│       ├── chapter_summaries.json
│       ├── subplot_board.json
│       ├── emotional_arcs.json
│       ├── character_matrix.json
│       └── author_intent.json
├── runtime/                     # Per-chapter working files
│   └── {book-id}/
│       └── chapter-{n}/
│           ├── 01-intent.md
│           ├── 02-architecture.md
│           ├── 03-context.json
│           ├── 04-rule-stack.yaml
│           ├── 05-draft.md
│           ├── 06-facts.json
│           ├── 07-audit.json
│           ├── 08-revised.md
│           ├── 09-normalized.md
│           └── 10-final.md
├── books/                       # Published content
│   └── {book-id}/
│       ├── book_rules.md
│       ├── story_bible.md
│       └── chapters/
├── config/                      # Configuration
│   ├── platforms/               # Platform-specific settings
│   ├── genres/                  # Genre templates
│   ├── fatigue_lexicon/         # AI fatigue word lists
│   └── banned_patterns/         # Banned sentence patterns
├── world/                       # Multi-book world/series management
│   └── {world-id}/
├── src/                         # TypeScript source
│   ├── orchestrator.ts          # Node.js pipeline orchestrator (spawns agents)
│   ├── types/
│   └── lib/
└── logs/                        # Execution logs
```

## Anti-AI-Taste Layers

1. **Vocabulary fatigue**: Banned words (因此、然而、但是...) in `config/fatigue_lexicon/`
2. **Sentence patterns**: Banned patterns (LLM causal chains, "只见" overuse) in `config/banned_patterns/`
3. **Style fingerprint**: Analyze reference text → inject style into subsequent chapters

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
