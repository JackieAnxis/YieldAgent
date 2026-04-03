# YieldAgent

让 Shell 脚本能够暂停执行，向 AI Agent 发起提问，收到回答后继续运行。

## 特性

- **暂停/恢复机制** — 脚本通过 `yield` 暂停，等待 Agent 回答后自动恢复
- **双向通信** — 基于命名管道（FIFO）实现脚本与 Agent 的实时交互
- **会话管理** — 支持多会话并行运行、查看、终止和清理
- **JSON 输出** — 所有命令输出结构化 JSON，便于 Agent 自动化处理
- **零依赖** — 纯 Bash 实现，可选 `jq` 优化 JSON 输出

## 快速开始

```bash
# 克隆仓库
git clone git@github.com:JackieAnxis/YieldAgent.git
cd YieldAgent

# 运行示例脚本
./yield-run run './demo.sh'
# 输出: {"type":"yield","message":"你好！你叫什么名字？","session_id":"session_xxx"}

# 回复脚本的提问
./yield-run resume session_xxx "我是 Claude"
# 输出: {"type":"yield","message":"你喜欢做什么？","session_id":"session_xxx"}

./yield-run resume session_xxx "帮助用户写代码"
# 输出: {"type":"done","session_id":"session_xxx"}
```

## 工作原理

```
┌──────────────────────────────────────────────────────┐
│  Agent (Claude)                                       │
│                                                      │
│  1. yield-run run './script.sh'                      │
│     → 脚本启动，执行到 yield 时暂停                    │
│     → 收到 JSON: {type:"yield", message:"问题", ...}  │
│                                                      │
│  2. 理解 message，生成回答                             │
│                                                      │
│  3. yield-run resume <session_id> "回答"              │
│     → 脚本收到回答，继续执行                           │
│     → 可能再次 yield（回到步骤 2）或返回 done          │
└──────────────────────────────────────────────────────┘
```

底层通过命名管道（FIFO）实现阻塞式 IPC：

- `yield_pipe` — 脚本写入问题，阻塞直到 Agent 读取
- `resume_pipe` — Agent 写入回答，阻塞直到脚本读取

## 命令参考

```
yield-run run '<command>'              启动可 yield 的脚本
yield-run resume <session_id> <text>   恢复暂停的会话，传入回答
yield-run wait <session_id>            等待下次 yield 或完成（超时可配置）
yield-run list                         列出所有活跃会话
yield-run kill <session_id>            终止指定会话
yield-run clean                        清理已结束的会话
```

### JSON 消息类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `yield` | 脚本暂停，请求 Agent 回答 | `{"type":"yield","message":"问题","session_id":"session_xxx"}` |
| `done` | 脚本执行完毕 | `{"type":"done","session_id":"session_xxx"}` |
| `error` | 发生错误 | `{"type":"error","message":"错误描述"}` |
| `timeout` | 等待超时 | `{"type":"timeout","session_id":"session_xxx"}` |

## 编写 Yield 脚本

在脚本中直接使用 `yield "问题"`，它会暂停脚本并将问题发送给 Agent：

```bash
#!/bin/bash

# 向 Agent 请求表名
table_name=$(yield "请给出一个适合存储用户日志的数据库表名")
echo "使用表名: $table_name"

# 向 Agent 请求技术决策
decision=$(yield "数据量约 100 万行，应该用分区表还是普通表？")
echo "采用方案: $decision"

# 让 Agent 检查构建结果
review=$(yield "构建完成，以下是日志摘要，请检查是否有异常：$(tail -20 build.log)")
echo "Agent 评估: $review"
```

`yield` 的返回值就是 Agent 的回答，可以直接赋值给变量使用。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `YIELD_TIMEOUT` | `30` | `wait` 命令超时秒数 |

## Claude Code 集成

项目内置了 Claude Code Skill（`.claude/skills/yield-agent/SKILL.md`），可让 Claude 自动处理 yield 脚本的暂停/恢复循环。

## 项目结构

```
YieldAgent/
├── yield-run              # CLI 入口，6 个子命令
├── yield-wrapper.sh       # 核心引擎，管理 FIFO 管道和会话生命周期
├── demo.sh                # 示例脚本
└── .claude/
    └── skills/
        └── yield-agent/
            └── SKILL.md   # Claude Code Skill 定义
```

## License

MIT
