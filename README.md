# Novel Writing Workflow

基于 InkOS 架构的 Claude Code 多 Agent 小说写作工作流，支持番茄小说、起点中文网等平台。

## 特性

- **11 个专业 Agent**：RADAR → PLANNER → COMPOSER → ARCHITECT → WRITER → OBSERVER → AUDITOR → REVISER → NORMALIZER → EDITOR → FACTS-KEEPER
- **7 个真相文件**：确保全书一致性
- **33 维度连续性审计**：角色、资源、伏笔、情感弧线等
- **3 层去 AI 味机制**：词汇疲劳词表 + 禁用句式 + 文风指纹
- **守护进程模式**：后台自动写章 + Webhook 通知
- **多平台适配**：番茄小说 / 起点中文网

## 快速开始

### 1. 安装依赖

```bash
# 需要 jq 和 Node.js 22+
sudo apt install jq  # Ubuntu
brew install jq      # macOS

# API Key
export ANTHROPIC_API_KEY="sk-ant-..."
# 或创建 ~/.inkos/.env
```

### 2. 初始化新书

```bash
cd novel-writing-workflow
./scripts/init-book.sh "我的小说" --genre xuanhuan --platform tangfan
```

### 3. 写章节

```bash
# 完整管线（写作+审计+修订）
./scripts/write-next.sh <book-id>

# 仅写作草稿（跳过审计）
./scripts/write-next.sh <book-id> --no-audit

# 指定章节上下文
./scripts/write-next.sh <book-id> --context "本章聚焦师徒矛盾"
```

### 4. 导出

```bash
# 导出 TXT
./scripts/export.sh <book-id> --platform tangfan --format txt

# 导出 EPUB
./scripts/export.sh <book-id> --format epub
```

### 5. 守护进程

```bash
# 后台写 10 章，每 30 分钟检查
./scripts/daemon.sh <book-id> --count 10 --interval 30 --notify --webhook https://...

# 查看状态
./scripts/daemon.sh <book-id> --status

# 停止
./scripts/daemon.sh <book-id> --stop
```

## 项目结构

```
novel-writing-workflow/
├── CLAUDE.md                    # Agent 角色定义
├── WORKFLOW.md                  # 详细技术文档
├── agents/                      # Agent prompt 定义
│   ├── PLANNER.md
│   ├── WRITER.md
│   ├── AUDITOR.md
│   └── ...
├── scripts/                     # 工作流脚本
│   ├── init-book.sh            # 初始化书籍
│   ├── write-next.sh           # 完整管线
│   ├── audit.sh                # 审计章节
│   ├── export.sh               # 导出平台格式
│   └── daemon.sh               # 守护进程
├── state/                       # 真相文件（per-book）
│   └── {book-id}/
│       ├── current_state.json
│       ├── particle_ledger.json
│       ├── pending_hooks.json
│       └── ...
├── books/                       # 书籍内容（per-book）
│   └── {book-id}/
│       └── chapters/
├── config/                      # 配置
│   ├── platforms/              # 平台配置
│   ├── genres/                 # 题材配置
│   ├── fatigue_lexicon/        # AI 疲劳词表
│   └── banned_patterns/        # 禁用句式
└── runtime/                    # 运行时产物
    └── {book-id}/
        └── chapter-{n}/
```

## 真相文件

| 文件 | 用途 |
|------|------|
| `current_state.json` | 世界状态 |
| `particle_ledger.json` | 资源账本 |
| `pending_hooks.json` | 伏笔追踪 |
| `chapter_summaries.json` | 章节摘要 |
| `subplot_board.json` | 支线进度 |
| `emotional_arcs.json` | 情感弧线 |
| `character_matrix.json` | 角色关系 |

## 去 AI 味

```
# 禁用词
因此、然而、但是、于是、总之
此时、此刻、缓缓、渐渐、猛然

# 句式规则
- 避免"只见"开头
- 避免3+连续"他..."开头
- 避免"被...所..."被动句过度
```

## 配置

### 平台

编辑 `config/platforms/` 下的 TOML 文件：
- `tangfan.toml` — 番茄小说
- `qidian.toml` — 起点中文网

### 题材

编辑 `config/genres/` 下的 TOML 文件：
- `xuanhuan.toml` — 玄幻
- `urban.toml` — 都市
- `common.toml` — 通用规则

## License

AGPL-3.0
