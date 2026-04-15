# 番茄小说专项配置

本目录包含番茄中文网文写作的专项优化规则。

## 文件清单

| 文件 | 用途 |
|------|------|
| `poison_points.md` | 番茄毒点清单（开局/中期/高级） |
| `chapter_hooks.md` | 章末钩子模板（7种类型） |
| `pacing.md` | 番茄节奏参数（3000字/章） |
| `dialogue_rules.md` | 中文网文对话守则 |

## 核心原则

```
番茄读者特征：
- 碎片时间阅读（通勤、午休、睡前）
- 快速扫描，2-3分钟看一章
- 追读率高但耐心低
- 章说是重要互动和决策点
```

## 避雷核心

```
CRITICAL（直接弃书）：
- 开局送女
- 圣母主角
- AI味因果链

HIGH（严重影响追读）：
- 战力崩坏
- 反派降智
- 循环套路无新意
```

## 引用方式

这些配置在以下位置被使用：

- `agents/WRITER.md` — 引用 poison_points、chapter_hooks、dialogue_rules
- `agents/AUDITOR.md` — 引用全部四个文件进行检测
- `config/platforms/tangfan.toml` — fanqie_specific 配置节
- `WORKFLOW.md` — 文档参考

## 更新日志

2026-04-15：初始化番茄专项配置包
