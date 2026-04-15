# Plan: 原生 Claude Code 多 Agent 架构迁移

## Context

**问题**: 当前 novel-writing-workflow 的 11 个 agent 实现为 TypeScript 类 + `callLLM()` placeholder，实际调用仍是 bash/curl 直连 Anthropic API，不是 Claude Code 原生 agent。

**目标**: 将流水线迁移到 Claude Code 原生的 Agent tool，让每个阶段 agent 都是真正的 Claude Code 子 agent，Orchestrator 也作为原生 agent 协调整个流程。

**已确认现状**:
- `agents/*.md` — 已有 11 个 agent 提示词定义（缺少 YAML frontmatter）
- `src/agents/*.ts` — TypeScript 类实现，包含 `callLLM()` placeholder
- `src/types/agents.ts` — 保留为 Zod 验证的类型定义
- `config/` — 反 AI 味词表、平台配置不变

---

## 架构设计

### 核心原则

1. **Agent 即文件**: 每个 agent 是 `agents/*.md` 文件，带 YAML frontmatter（name/description/tools/model）
2. **Orchestrator 即 Agent**: `ORCHESTRATOR.md` 作为父 agent，用 Agent tool 按顺序 spawn 11 个阶段 agent
3. **文件传递状态**: agent 间通过 `runtime/{book}/chapter-{n}/` 目录下的编号文件传递上下文
4. **真相文件不变**: `state/{book}/` 下的 7 个 JSON 文件保持不变

### Agent 模型选择

| Agent | 模型 | 理由 |
|-------|------|------|
| ORCHESTRATOR | **opus** | 复杂协调、工具调用、上下文管理 |
| WRITER | **opus** | 创意 prose 生成 + 反 AI 味规则 |
| AUDITOR | **sonnet** | 33 维度分析，高复杂度 |
| PLANNER, ARCHITECT, COMPOSER, REVISER, FACTS-KEEPER, RADAR | **sonnet** | 结构化任务 |
| OBSERVER, NORMALIZER, EDITOR | **haiku** | 机械性任务 |

### Agent 工具权限

| Agent | 工具 | 理由 |
|-------|------|------|
| ORCHESTRATOR | Agent, Read, Write, Glob, Bash | 协调流水线，目录操作 |
| PLANNER | Read, Glob | 读取真相文件和已有输出 |
| ARCHITECT | Read, Write | 读取 PLANNER 输出，写架构 |
| COMPOSER | Read, Write, Glob | 读取多个来源 |
| WRITER | Read, Write | 读取架构+规则，写草稿 |
| OBSERVER | Read, Write | 事实提取 |
| AUDITOR | Read, Glob | 需要读取多个上下文 |
| REVISER | Read, Write | 基于审计修复 |
| NORMALIZER | Read, Write | 字数调整 |
| EDITOR | Read, Write, Glob | 平台格式化 |
| FACTS-KEEPER | Read, Write, Bash | 原子写入 + Zod 验证 |
| RADAR | Read, Write, WebSearch | 市场研究 |

---

## 实施步骤

### Step 1: 为 11 个 Agent 文件添加 YAML frontmatter

为 `agents/` 目录下的 11 个 Markdown 文件添加标准 Claude Code agent frontmatter：

```yaml
---
name: <AGENT_NAME>
description: <简洁描述>
tools: [<工具列表>]
model: <haiku|sonnet|opus>
---
```

需要修改的文件：
- `agents/PLANNER.md`
- `agents/ARCHITECT.md`
- `agents/COMPOSER.md`
- `agents/WRITER.md` ← 重点：需要明确 anti-AI-taste 规则
- `agents/OBSERVER.md`
- `agents/AUDITOR.md` ← 重点：需要明确 CRITICAL 暂停机制
- `agents/REVISER.md`
- `agents/NORMALIZER.md`
- `agents/EDITOR.md`
- `agents/FACTS-KEEPER.md` ← 重点：需要 Bash 原子写入 + Zod
- `agents/RADAR.md`

### Step 2: 创建 ORCHESTRATOR.md agent

新建 `agents/ORCHESTRATOR.md`，作为父 agent：
- 使用 `Agent` tool 按顺序 spawn 每个子 agent
- 管理 `runtime/{book}/chapter-{n}/` 目录结构
- 在 AUDITOR CRITICAL 问题时暂停流水线
- 管理字數范围验证

Pipeline 顺序：
```
PLANNER → ARCHITECT → COMPOSER → WRITER → OBSERVER → AUDITOR → REVISER → NORMALIZER → EDITOR → FACTS_KEEPER
```

### Step 3: 创建 CLI 入口脚本

创建 `scripts/write-next.sh` 或直接提供 `./write-next <book-id> [--chapter N]` 命令，底层调用 Claude Code 原生 agent：

```bash
#!/bin/bash
# 使用 Claude Code --print 运行 ORCHESTRATOR agent
claude --print --agent "ORCHESTRATOR" --input "write-next $1 --chapter ${2:-next}"
```

### Step 4: 保留的类型定义

保留以下文件，不删除：
- `src/types/agents.ts` — Agent 输入/输出 TypeScript 接口
- `src/types/schema.ts` — Zod schemas for 真相文件验证

FACTS-KEEPER agent 内部使用 Zod 验证真相文件更新。

### Step 5: 废弃的 TypeScript 文件

迁移完成后可删除（但不是本次步骤）：
- `src/agents/` 整个目录
- `src/tasks/pipeline-orchestrator.ts`

---

## 关键实现细节

### Anti-AI-Taste 在 WRITER agent 中的强制执行

WRITER agent 的 frontmatter 需要包含完整的反 AI 味规则作为 system prompt 的一部分，并要求 agent 在生成草稿后自检。

### AUDITOR CRITICAL 暂停机制

AUDITOR agent 输出 `07-audit.json` 后，如果包含 CRITICAL 问题：
1. 在输出中明确说明 `## PIPELINE PAUSE: CRITICAL ISSUE DETECTED`
2. ORCHESTRATOR 读取到 CRITICAL 标记后停止，等待人工确认
3. 人工确认后继续 REVISER 阶段

### FACTS-KEEPER 原子写入

FACTS-KEEPER 使用 Bash 进行原子写入：
```bash
mkdir -p state/{book_id}/.tmp
# 写入临时文件
mv state/{book_id}/.tmp/*.json state/{book_id}/
rm -rf state/{book_id}/.tmp
```

---

## 验证计划

1. **Agent 定义验证**: 每个 agent markdown 文件能被 Claude Code 识别为有效 agent
2. **Pipeline 完整性**: 运行 `./scripts/write-next.sh <book-id>` 完整执行所有 11 个阶段
3. **输出文件验证**: 检查 `runtime/{book}/chapter-{n}/` 下所有编号文件存在且格式正确
4. **真相文件更新验证**: 确认 `state/{book}/` 下的 JSON 文件被正确更新
5. **Anti-AI-Taste 验证**: AUDITOR 能检测出 AI 味问题
6. **CRITICAL 暂停验证**: 注入 CRITICAL 问题后流水线正确暂停

---

## 关键文件

| 操作 | 文件 |
|------|------|
| 新建 | `agents/ORCHESTRATOR.md` |
| 修改 | `agents/PLANNER.md` — 添加 YAML frontmatter |
| 修改 | `agents/WRITER.md` — 添加 frontmatter + anti-AI-taste |
| 修改 | `agents/AUDITOR.md` — 添加 frontmatter + CRITICAL gate |
| 修改 | `agents/FACTS-KEEPER.md` — 添加 frontmatter + Bash 原子写入 |
| 保留 | `src/types/agents.ts`, `src/types/schema.ts` |
| 新建/修改 | `scripts/write-next.sh` — 原生 Claude Code 调用入口 |
