# README 重写设计

## 定位

**一句话：** Mermaid 驱动的轻量级 Agent 工作流引擎

## 设计思路：A+B 模式

- **A（理念先行）：** 先讲清楚"为什么"——LLM 在多步任务中的局限性，以及 YieldAgent 如何用确定性编排解决
- **B（示例紧跟）：** 用一个完整例子让读者 30 秒内理解工作方式

## README 结构

### 1. 标题 + 一句话定位

```
# YieldAgent
Mermaid 驱动的轻量级 Agent 工作流引擎
```

### 2. 为什么需要 YieldAgent

2-3 段文字，覆盖：
- LLM 擅长单步执行，但多步任务会偏离、遗忘、跳步骤
- 现有方案（Dify 等）需要部署基础设施，有学习成本
- YieldAgent 的核心思路：**流程图定义"做什么"，模型只负责"怎么做"**
- 类比：编排逻辑从模型脑袋移到确定性脚本中

### 3. 看一个例子（weekend-trip）

用现有的 `mermaid-compiler/examples/weekend-trip.mmd` 作为核心示例：

展示三部分：
1. Mermaid 流程图源码
2. 编译后的 shell 脚本
3. 实际运行效果（终端输出文本）

选择 weekend-trip 的原因：
- 场景直观，不需要技术背景解释
- 覆盖 ask、result 分支、循环、变量传递——一个例子展示全部核心能力
- 趣味性强，比 dry 的 deploy 示例更吸引人

### 4. 更多场景

每个场景给一段简短的 Mermaid 片段（不需要完整示例）：
- **代码审查流程：** lint → test → 人工确认 → deploy
- **数据处理管道：** 提取 → 清洗 → 验证 → 入库
- **多轮对话任务：** 面试模拟、需求调研

### 5. 快速开始

```bash
git clone git@github.com:JackieAnxis/YieldAgent.git
cd YieldAgent

# 运行示例
./yield-run run './demo.sh'

# 编译并运行 Mermaid 工作流
cd mermaid-compiler && npm install
node src/cli.js run examples/weekend-trip.mmd
```

### 6. 核心概念

- **yield 语法：** `result=$(yield "问题")` — 暂停脚本，等待 Agent 回答
- **节点类型：** cmd（执行命令）、ask（向 Agent 提问）、result（条件分支）
- **会话管理：** list / kill / clean
- **JSON 输出：** 所有命令输出结构化 JSON

### 7. CLI 命令参考

**yield-run：** run / resume / wait / list / kill / clean
**yield-mermaid：** run / compile / validate

### 8. 架构

```
Mermaid 流程图 (.mmd)
    ↓
yield-mermaid 编译
    ├── parse: 解析 Mermaid 语法
    ├── analyze: 图遍历、环检测
    └── generate: AST → shell 脚本
    ↓
Shell 脚本 (.sh)
    ↓
yield-run 执行
    ├── FIFO 管道通信
    └── 会话生命周期管理
    ↓
Agent (Claude) 响应
```

### 9. 项目结构 + License

```
YieldAgent/
├── yield-run              # CLI 入口
├── yield-wrapper.sh       # 核心引擎（FIFO + 会话管理）
├── demo.sh                # 基础示例
├── mermaid-compiler/      # Mermaid 编译器
│   ├── src/
│   │   ├── parser.js      # Mermaid 解析
│   │   ├── analyzer.js    # 图分析
│   │   ├── generator.js   # 代码生成
│   │   └── cli.js         # CLI 入口
│   └── examples/          # 示例流程图
└── .claude/skills/        # Claude Code Skill
```

## 删除的内容

当前 README 中以下内容需要简化或移除：
- 过于详细的 JSON 消息类型表格（保留简要说明即可）
- 环境变量表格（移到文档末尾或 wiki）
- 详细的 FIFO 通信原理说明（简化为架构图的一部分）

## 注意事项

- 代码注释使用中文
- 保持 README 简洁，避免信息过载
- 示例代码直接引用项目中已有的文件
