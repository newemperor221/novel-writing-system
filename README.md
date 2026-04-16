# Novel Writing System

基于事件驱动的多 Agent 协作系统，为中文网络小说（番茄小说、起点中文网）实现自动化写作管道。

## 核心架构

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
                                    NORMALIZING ◄──────────► EDITING (并行)
                                                              │
                                                              ▼
                                                    TRUTH_UPDATING → COMPLETED
```

- **事件总线** (EventBus)：Agent 之间通过发布/订阅通信
- **并行执行**：ARCHITECT + COMPOSER、NORMALIZER + EDITOR 可同时运行
- **状态机**：章节生命周期自动管理（CREATED → ... → COMPLETED）

## 11 个专业 Agent

| Agent | 职责 |
|-------|------|
| **RADAR** | 市场趋势扫描，热点套路分析 |
| **PLANNER** | 读取作者意图 + 真相文件 → 章节意图 |
| **ARCHITECT** | 设计章节结构：场景、节拍、节奏线 |
| **COMPOSER** | 编译上下文，构建规则优先级栈 |
| **WRITER** | 生成章节正文，启用去 AI 味规则 |
| **OBSERVER** | 从草稿中提取 9 类事实 |
| **AUDITOR** | 三层审计：AI 味 / 疲劳 / 连续性 |
| **REVISER** | 自动修复 CRITICAL/HIGH 问题 |
| **NORMALIZER** | 调整字数至目标区间（不删情节）|
| **EDITOR** | 应用平台格式（番茄/起点）|
| **FACTS-KEEPER** | 原子更新 7 个真相文件 |

## 真相文件（7 个）

确保全书一致性，每次章节完成后原子更新。

| 文件 | 用途 |
|------|------|
| `current_state.json` | 世界状态：地点、主角、敌人 |
| `particle_ledger.json` | 资源追踪：灵力、金钱、声望 |
| `pending_hooks.json` | 伏笔追踪：open/progressing/deferred/resolved |
| `chapter_summaries.json` | 每章摘要：角色、事件、状态变化 |
| `subplot_board.json` | 支线进度 |
| `emotional_arcs.json` | 角色情感弧线 |
| `character_matrix.json` | 角色关系网 |

## 去 AI 味三层机制

1. **词汇层**：禁用词表（因此、然而、但是、缓缓、猛然...）
2. **句式层**：段落均匀度、过渡词密度、开头重复
3. **长程层**：跨章类型/情绪/标题/开篇/结尾的单调性

## 快速开始

### 1. 安装依赖

```bash
# 需要 jq 和 Node.js 22+
sudo apt install jq

export ANTHROPIC_API_KEY="sk-ant-..."
```

### 2. 初始化新书

```bash
./scripts/init-book.sh "我的小说" --genre xuanhuan --platform tangfan
```

### 3. 写章节

```bash
# 完整管道（写作+审计+修订）
./scripts/write-next.sh <book-id>

# 快速模式（跳过审计）
./scripts/write-next.sh <book-id> --skip-audit

# 指定上下文
./scripts/write-next.sh <book-id> --context "聚焦师徒矛盾"
```

### 4. 审计已有章节

```bash
./scripts/audit.sh <book-id> 5
```

### 5. 导出

```bash
./scripts/export.sh <book-id> --platform tangfan
```

### 6. 后台守护进程

```bash
./scripts/daemon.sh <book-id> --count 10 --notify
```

## 目录结构

```
novel-writing-system/
├── src/
│   ├── orchestrator.ts           # CLI 入口
│   ├── events/
│   │   ├── EventBus.ts           # 发布/订阅通信
│   │   └── EventTypes.ts         # 事件类型定义
│   ├── engine/
│   │   ├── WorkflowEngine.ts     # 主工作流引擎
│   │   ├── PhaseScheduler.ts     # 并行阶段调度
│   │   └── DependencyGraph.ts    # DAG 依赖图
│   ├── agents/
│   │   ├── AgentBase.ts          # Agent 基类
│   │   ├── AgentRegistry.ts      # Agent 注册表
│   │   └── legacy/
│   │       └── LegacyAgentWrapper.ts
│   └── state-machine/
│       └── ChapterStateMachine.ts # 章节生命周期
├── agents/                       # Agent Prompt 定义
├── scripts/                      # 工作流脚本
├── state/{book-id}/              # 真相文件
├── runtime/{book-id}/chapter-{n}/ # 运行时产物
└── books/{book-id}/chapters/     # 输出章节
```

## 技术栈

- **TypeScript** + **Node.js 22**
- **事件驱动**：Pub/Sub 架构
- **并行调度**：DAG + PhaseScheduler
- **状态机**：XState 风格的章节生命周期
- **CLI**：原生 TypeScript，无额外框架

## License

AGPL-3.0
