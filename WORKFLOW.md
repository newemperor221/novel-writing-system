# Novel Writing Workflow — Technical Documentation

## Table of Contents

1. [Pipeline Overview](#pipeline-overview)
2. [Agent Detailed Specifications](#agent-detailed-specifications)
3. [Truth File System](#truth-file-system)
4. [Platform Adaptation](#platform-adaptation)
5. [Anti-AI-Taste Mechanisms](#anti-ai-taste-mechanisms)
6. [Daemon Process](#daemon-process)
7. [Multi-Book & World Management](#multi-book--world-management)
8. [Configuration Reference](#configuration-reference)

---

## Pipeline Overview

### Full Write-Next-Chapter Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WRITE-NEXT-CHAPTER PIPELINE                      │
│                                                                      │
│  User: ./scripts/write-next.sh <book-id>                            │
└─────────────────────────────────────────────────────────────────────┘

Phase 1: PLANNING
─────────────────
  PLANNER   → runtime/{book}/chapter-{n}/01-intent.md
     ↓
  ARCHITECT → runtime/{book}/chapter-{n}/02-architecture.md

Phase 2: COMPOSITION
────────────────────
  COMPOSER  → runtime/{book}/chapter-{n}/03-context.json
           → runtime/{book}/chapter-{n}/04-rule-stack.yaml

Phase 3: WRITING
────────────────
  WRITER    → runtime/{book}/chapter-{n}/05-draft.md

Phase 4: OBSERVATION
────────────────────
  OBSERVER   → runtime/{book}/chapter-{n}/06-facts.json

Phase 5: AUDIT
──────────────
  AUDITOR    → runtime/{book}/chapter-{n}/07-audit.json
       │
       ├─ PASS ──────→ Skip Phase 6
       └─ FAIL ─────→ REVISER

Phase 6: REVISION
─────────────────
  REVISER    → runtime/{book}/chapter-{n}/08-revised.md
       │
       └─ Re-audit: AUDITOR again

Phase 7: NORMALIZATION
──────────────────────
  NORMALIZER → runtime/{book}/chapter-{n}/09-normalized.md

Phase 8: EDITING
────────────────
  EDITOR     → runtime/{book}/chapter-{n}/10-final.md
           → books/{book}/chapters/ch-{n}.md

Phase 9: TRUTH UPDATE
─────────────────────
  FACTS-KEEPER → Updates all 7 truth files in state/{book}/
```

### Command Scripts

| Script | Agents Invoked | Purpose |
|--------|---------------|---------|
| `init-book.sh` | FACTS-KEEPER (init) | Create new book with 7 truth files |
| `plan-chapter.sh` | PLANNER + ARCHITECT | Preview chapter structure |
| `compose.sh` | COMPOSER | Compile context from truth files |
| `write-chapter.sh` | WRITER only | Write draft without audit |
| `write-next.sh` | ALL 11 agents | Full pipeline |
| `audit.sh` | AUDITOR | Re-audit existing chapter |
| `revise.sh` | REVISER | Re-revise existing chapter |
| `export.sh` | EDITOR | Export to platform format |
| `daemon.sh` | write-next loop | Background autonomous writing |
| `analyze-style.sh` | STYLE-ANALYZER | Extract style fingerprint |

---

## Agent Detailed Specifications

### 1. RADAR — Market Trend Scanner

**Purpose**: Analyze platform trends to inform story direction.

**Triggers**:
- Book initialization (before first chapter)
- Every 10 chapters
- On-demand: `./scripts/radar.sh <book-id>`

**Output**: `runtime/{book}/radar-report.md`

```json
{
  "hot_tropes": ["系统流", "签到流", "迪化流"],
  "declining_tropes": ["退婚流"],
  "recommendations": [
    {"what": "增加主角心理描写", "why": "读者反馈情感共鸣强", "risk": "Low", "priority": 1}
  ],
  "ai_taste_warnings": ["避免高频'因此'连接"]
}
```

---

### 2. PLANNER — Chapter Intent Definition

**Purpose**: Define what this chapter must accomplish, must keep, and must avoid.

**Reads**:
- `state/{book}/author_intent.json`
- `state/{book}/current_state.json`
- `state/{book}/pending_hooks.json`
- Previous chapter summary

**Output**: `runtime/{book}/chapter-{n}/01-intent.md`

```markdown
# Chapter {n} Intent

## Basic Info
- Title suggestion: "..."
- Target word count: {min}-{max}
- POV: {character}
- Timeline: Day {x}, {time}

## Core Purpose
1. [Primary goal]
2. [Secondary goal]
3. [Optional]

## Must-Keep Elements
- [ ] {specific scene/element}
- [ ] {character moment}
- [ ] {plot point}

## Must-Avoid
- {previous_chapter_event} — avoid repetition
- {overused_trope} — overused, avoid
- {character_moment} — don't do yet

## Conflict Resolution
For each open hook:
- Hook: {description}
- Address: {method}
- If conflicting: {resolution}

## Character Development
- {character}: Internal goal this chapter
- Emotional arc: {start} → {end}
```

---

### 3. COMPOSER — Context Compilation

**Purpose**: Select and compile relevant context from truth files within token budget.

**Context Window Rules**:
- Last 3 chapters of `chapter_summaries` (full)
- Last 5 entries of `particle_ledger` (relevant only)
- `pending_hooks` with status open/progressing
- `character_matrix` entries for characters in this chapter
- `emotional_arcs` for characters (last 3 states)

**Rule Priority Stack** (later overrides earlier):
1. `config/writing_rules.toml` — Global defaults
2. `config/genres/{genre}.toml` — Genre conventions
3. `books/{book}/book_rules.md` — Book rules
4. `state/{book}/author_intent.json` — Author priorities
5. `runtime/{book}/chapter-{n}/01-intent.md` — Chapter overrides

**Max Context**: 8000 tokens

---

### 4. ARCHITECT — Chapter Structure Design

**Purpose**: Blueprint chapter architecture with scene breakdown and pacing.

**Scene Template** (玄幻 xuanhuan):

```
Setup (20%) → Conflict (25%) → Training/Growth (20%) → Climax (20%) → Hook (15%)
```

**Scene Template** (都市 urban):

```
Daily Life (15%) → Inciting Incident (20%) → Social Maneuvering (25%) → Confrontation (25%) → Resolution (15%)
```

**Output**: `runtime/{book}/chapter-{n}/02-architecture.md`

```markdown
# Chapter {n} Architecture

## Scene Breakdown

### Scene 1: {scene_name}
- Location: {where}
- POV: {who}
- Purpose: {what}
- Key beats:
  1. {beat} — {emotional beat}
- Word count estimate: {min}-{max}

## Pacing Arc
```
Low ▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ High
         ▲                              ▲
      Hook intro                    Climax
```

## Tension Beats
| Position | Event | Word Count |
|----------|-------|-----------|
| 10% | Hook | 300 |
| 30% | First conflict | 600 |
| 60% | Mid-climax | 800 |
| 90% | Peak | 600 |
```

---

### 5. WRITER — Prose Generation

**Purpose**: Generate raw chapter prose following architecture and rules.

**Anti-AI-Taste Rules** (MUST follow):

```markdown
## Vocabulary: NEVER use these words
因果类: 因此、然而、但是、于是、总之、可见、众所周知
过渡类: 此时、此刻、就在这时、不由得、情不自禁
副词类: 猛然、骤然、陡然、猝然、霍然、缓缓、渐渐、逐步、日益

## Sentence Structure
- Paragraph first-word must vary (no 3+ consecutive "他" starts)
- Alternate 1-sentence and 3+ sentence paragraphs
- Vary sentence length: 5 words to 25 words

## Dialogue
- Use 「」 or "" per platform
- Dialogue tags: only {角色} said/action
- No "他轻声说道" etc.

## Show Don't Tell
- ❌ "张凡很生气"
- ✅ "张凡一拳砸在墙上，墙面龟裂"

## Sensory
- At least 1 physical sensation per scene
```

**Word Count Strategy**:
- Target: `{platform.ideal}`
- Soft range: ±10%
- Hard range: ±20%
- Never truncate mid-scene

---

### 6. OBSERVER — Fact Extraction

**Purpose**: Extract structured facts from draft for truth file updates.

**9 Fact Categories**:

| Category | Schema |
|----------|--------|
| Character States | `{name, physical, emotional, status_change}` |
| Location Updates | `{name, first_seen_chapter, features, significance}` |
| Resource Changes | `{type, delta, reason, new_total}` |
| Relationship Updates | `{charA, charB, type, change, reason}` |
| Information Revealed | `{info, source, recipient, truth_file}` |
| Hook Updates | `{hook_id, description, status, resolution_chapter}` |
| Emotional Arc | `{character, state_at_end, direction, trigger}` |
| Physical Objects | `{object, location, owner, state_change}` |
| Time Progression | `{elapsed, story_time, chapter_count}` |

**Rules**:
- Extract conservatively; mark uncertain as `UNCERTAIN`
- Include raw text quotes for AUDITOR verification
- Track NEW information only (not already in truth files)

---

### 7. AUDITOR — 33-Dimension Continuity Audit

**Audit Dimensions**:

| Category | Dimensions |
|----------|-----------|
| Character (8) | Name Consistency, Physical Description, Mannerisms, Abilities, Relationship States, Emotional Continuity, Goal/Motivation, Knowledge State |
| Location (5) | Location Name, Geographic Facts, Location Features, Climate/Weather, Location Significance |
| Plot (6) | Timeline Consistency, Causal Logic, Hook Deployment, Foreshadowing, Pacing, Stakes |
| World (6) | Cultivation System, Tech Level, Social Structure, Economic System, Cultural Elements, Physical Laws |
| Resource (4) | Particle Counts, Item Ownership, Item Locations, Consumed Resources |
| Style (4) | POV Consistency, Tense Consistency, Register Consistency, AI Taste |

**Severity Levels**:
- **CRITICAL**: Breaks reader immersion → pipeline halts
- **HIGH**: Notable inconsistency → auto-fix attempted
- **MEDIUM**: Minor inconsistency → flag for human
- **LOW**: Style preference → note only

**Output Format**:

```json
{
  "chapter": 5,
  "overall_result": "PASS | FAIL",
  "issues": [
    {
      "dimension": "character.emotional_continuity",
      "severity": "HIGH",
      "description": "Character shows joy but previous chapter established depression",
      "location": "paragraph 12",
      "quote": "...",
      "recommendation": "Adjust dialogue to reflect depressed state"
    }
  ],
  "ai_taste_flags": [
    {"type": "vocabulary", "word": "因此", "location": "paragraph 3"}
  ],
  "summary": "0 CRITICAL, 2 HIGH, 1 MEDIUM, 0 LOW"
}
```

---

### 8. REVISER — Issue Remediation

**Auto-fix priority**:
- CRITICAL: 100% auto-fix required before proceeding
- HIGH: Auto-fix if clear solution exists
- MEDIUM: Flag for human review
- LOW: Note only

**Fix Guidelines**:

| Issue Type | Fix Method |
|------------|-----------|
| Character name/description | Apply correct established fact |
| Timeline | Add clarification sentence |
| Relationship | Adjust dialogue/action |
| Ability inconsistency | Add limitation clause |
| AI vocabulary | Replace with synonyms |
| Sentence pattern | Break pattern with variation |

**Preservation Rule**: NEVER remove must-keep scenes, established plot points, or chapter-ending hooks.

---

### 9. NORMALIZER — Word Count Adjustment

**Target Ranges**:
- Ideal: `{platform.ideal}` (e.g., 2800 for 番茄)
- Acceptable: ±10%
- Hard limit: ±20%

**If UNDER target**:
1. Expand interiority (1-2 sentences)
2. Expand sensory detail
3. Expand dialogue exchanges
4. Expand transitions

**If OVER target**:
1. Trim redundant phrases
2. Combine short sentences
3. Trim interiority (not eliminate)
4. Trim transitions

**AVOID**:
- Never cut from climax/resolution
- Never cut must-keep scenes
- Never arbitrarily end scenes
- Never add contradictory content

---

### 10. EDITOR — Platform Format Adapter

**番茄小说 format**:
```yaml
chapter_title: "第{n}章 {title}"
paragraph_separator: "\n\n"
chapter_hook: "      "  # 6 spaces to encourage comment
```

**起点中文网 format**:
```yaml
chapter_title: "第{n}章 {title}"
paragraph_separator: "\n"
first_line_indent: "　　"  # Full-width indent
chapter_hook: "——————"
vip_marker: "[VIP]"  # for VIP chapters
```

**Output Flow**:
1. Write `runtime/{book}/chapter-{n}/10-final.md`
2. Copy to `books/{book}/chapters/ch-{n}.md`
3. Update `chapter_summaries.json` with summary

---

### 11. FACTS-KEEPER — Truth File Management

**Update Rules by File**:

| File | Update Logic |
|------|-------------|
| `current_state.json` | chapter++, location, protagonist stats, enemies, knownTruths |
| `particle_ledger.json` | Append entries with delta, validate hardCap |
| `pending_hooks.json` | New→open, progress→progressing, resolve→resolved |
| `chapter_summaries.json` | Append <500 char summary with characters/events/stateChanges |
| `subplot_board.json` | Advance if progress, mark complete if resolved |
| `emotional_arcs.json` | Append new emotional state, update arc direction |
| `character_matrix.json` | Update relationships, append new interactions |

**Atomic Update Process**:
1. Read all current truth files
2. Read extracted facts from `06-facts.json`
3. Validate against Zod schemas
4. Create backup of all 7 files
5. Apply all updates (immutable — new objects only)
6. Validate all 7 updated files
7. If validation fails → restore from backup

**Conflict Resolution**:
- Fact contradicts truth: prefer truth if draft is wrong
- Prefer draft if truth was incomplete
- Flag for human if ambiguous

---

## Truth File System

### current_state.json

```json
{
  "bookId": "xxx",
  "chapter": 5,
  "location": "青云峰后山",
  "timeDescription": "清晨",
  "presentCharacters": ["张凡", "师父"],
  "protagonist": {
    "name": "张凡",
    "level": "炼气三层",
    "status": "active",
    "location": "青云峰后山",
    "health": {"physical": 80, "spiritual": 60, "mental": 70}
  },
  "activeEnemies": [
    {"name": "王浩", "threatLevel": "medium", "status": "active"}
  ],
  "knownTruths": [
    {"id": "uuid", "content": "张凡体内有上古残魂", "revealedChapter": 2}
  ],
  "recentEvents": [
    {"chapter": 4, "description": "张凡突破炼气三层", "significance": "major"}
  ],
  "worldFlags": {"师父知道真相": true},
  "lastUpdated": "2026-04-15T12:00:00Z"
}
```

### particle_ledger.json

```json
{
  "particles": {
    "spiritual_energy": {
      "hardCap": 1000,
      "currentTotal": 650,
      "entries": [
        {"id": "uuid", "particleType": "spiritual_energy", "delta": 100, "reason": "突破炼气三层", "chapter": 4, "timestamp": "...", "runningTotal": 650}
      ]
    },
    "money": {
      "hardCap": null,
      "currentTotal": 5000,
      "entries": []
    }
  },
  "lastUpdated": "2026-04-15T12:00:00Z"
}
```

### pending_hooks.json

```json
{
  "hooks": [
    {
      "id": "uuid",
      "description": "师父隐藏的秘密",
      "originChapter": 2,
      "status": "open",
      "expectedResolution": "第10章揭示",
      "resolutionChapter": null,
      "lastAdvancedChapter": 4,
      "priority": "high"
    }
  ],
  "lastUpdated": "2026-04-15T12:00:00Z"
}
```

---

## Platform Adaptation

### 番茄小说 Configuration

```toml
# config/platforms/tangfan.toml
[platform]
id = "tangfan"
name = "番茄小说"

[chapter_format]
chapter_title_template = "第{n}章 {title}"
paragraph_separator = "\n\n"
first_line_indent = false
chapter_hook = "      "
min_chapter_words = 2000
ideal_chapter_words = 2800
max_chapter_words = 3000
hard_max_words = 3500

[upload]
format = "txt"
encoding = "utf-8"
newline = "unix"
```

### 起点中文网 Configuration

```toml
# config/platforms/qidian.toml
[platform]
id = "qidian"
name = "起点中文网"

[chapter_format]
chapter_title_template = "第{n}章 {title}"
paragraph_separator = "\n"
first_line_indent = true
first_line_indent_chars = "　　"
chapter_hook = "——————"
vip_marker = "[VIP]"
min_chapter_words = 3000
ideal_chapter_words = 4000
max_chapter_words = 5000
hard_max_words = 6000

[upload]
format = "html"
encoding = "utf-8"
newline = "windows"
```

---

## Anti-AI-Taste Mechanisms

### Layer 1: Vocabulary Fatigue

**`config/fatigue_lexicon/high_freq_llm.txt`**:
```
因此、然而、但是、于是、总之、可见、众所周知
不难发现、研究表明、数据显示、值得注意的是
实际上、本质上、简而言之、综上所述
不难看出、由此可见、换言之、也就是说
```

**`config/fatigue_lexicon/transition_fatigue.txt`**:
```
此时、此刻、就在这时、不由得、情不自禁
随即、旋即、突然、猛然、骤然、陡然、猝然、霍然
缓缓、渐渐、逐步、日益、越发、越加、越来越
```

### Layer 2: Banned Sentence Patterns

**`config/banned_patterns/sentence_patterns.txt`**:
```regex
# AI causal chains: "A 感到 B，因为 C，因此 D"
(A 感到 .+，因为 .+，因此 .+)

# "只见" overuse: max 1 per 500 words
^(只见|只见得) .+

# Same-subject paragraph starts: max 2 consecutive
(他.+\n){3,}

# Passive overuse: max 1 per 300 words
(.+)被(.+)所(.+)

# "开始+verb" chains
开始.开始.
```

### Layer 3: Style Fingerprint

**`./scripts/analyze-style.sh`**:
1. Input: Reference text file
2. Extract: Lexical features (avg sentence length, word frequency)
3. Extract: Syntactic features (dialogue ratio, paragraph start distribution)
4. Extract: Content features (sensory detail frequency, interiority frequency)
5. Output: `style_fingerprint.json`
6. Injection: Subsequent chapters read fingerprint and follow its patterns

---

## Daemon Process

### Start Daemon

```bash
./scripts/daemon.sh <book-id> \
  --max-chapters 10 \
  --interval 30 \
  --notify \
  --webhook https://example.com/webhook
```

### Daemon State

```json
{
  "daemon_id": "uuid",
  "book_id": "xxx",
  "started_at": "2026-04-15T12:00:00Z",
  "last_run_at": "2026-04-15T13:00:00Z",
  "last_chapter_completed": 14,
  "total_chapters_completed": 14,
  "consecutive_successes": 14,
  "status": "running",
  "pause_reason": null
}
```

### Decision Matrix

| Condition | Action |
|-----------|--------|
| `chapter_complete` | write_next_chapter |
| `key_issue_detected` | pause, notify human |
| `count_limit_reached` | stop daemon |
| `interval_not_elapsed` | continue waiting |
| `user_stop_requested` | graceful shutdown |

### Webhook Notification Format

```json
{
  "event": "chapter_completed",
  "timestamp": "2026-04-15T13:00:00Z",
  "book_id": "xxx",
  "chapter": 15,
  "chapter_title": "师徒决裂",
  "word_count": 2847,
  "audit_result": "PASS",
  "execution_time_seconds": 142,
  "next_chapter_preview": "..."
}
```

---

## Multi-Book & World Management

### World Directory Structure

```
world/
└── {world-id}/
    ├── world_bible.md          # Shared world lore
    ├── shared/
    │   ├── characters.json     # Cross-book characters
    │   ├── locations.json      # Shared locations
    │   └── timeline.json       # Unified timeline
    └── books/
        ├── {book-1}/
        └── {book-2}/
```

### Shared Resources Inheritance

- Book-level truth files override world-level shared files
- World-level provides fallback for undefined characters/locations
- Timeline enforced across all books in world

---

## Configuration Reference

### Genre Configuration

```toml
# config/genres/xuanhuan.toml
[genre]
id = "xuanhuan"
name = "玄幻"

[rules]
pacing_template = "setup_20|conflict_25|growth_20|climax_20|hook_15"
chapter_hook_required = true
min_chapter_words = 2500
max_chapter_words = 3500

[audit_dimensions]
character_weight = 1.2
world_weight = 1.0
plot_weight = 1.1

[forbidden_elements]
cliche_tropes = ["退婚", "废柴"]
forbidden_endings = ["大团圆"]
```

### Writing Rules (Global)

```toml
# config/writing_rules.toml
[global]
max_sentence_length = 30
min_sentence_length = 5
max_paragraph_length = 200
dialogue_ratio_target = 0.3

[anti_ai_taste]
fatigue_lexicon_strict = true
banned_patterns_strict = true
style_fingerprint_enabled = true
```

---

*Last updated: 2026-04-15*
