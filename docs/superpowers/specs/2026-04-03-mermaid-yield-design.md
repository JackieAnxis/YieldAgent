# Mermaid → Yield 流程编排设计

## 概述

通过解析 Mermaid 流程图来驱动 YieldAgent 的执行流程。用户编写 `.mmd` 文件定义工作流，系统将其转译为 shell 脚本，再由现有的 `yield-wrapper.sh` 机制执行。

**核心价值**：将手写 yield shell 脚本的方式，升级为声明式流程图定义，降低使用门槛，提升可读性和可维护性。

## 节点类型

三种前缀标记，用在 Mermaid 节点文本中：

| 前缀 | 用途 | 转译结果 | 示例 |
|------|------|----------|------|
| `cmd:` | 执行 shell 命令 | 直接执行命令 | `[cmd: echo "hello"]` |
| `ask:` | yield 给 agent，等待回答 | `VAR=$(yield "...")` | `[ask: 哪个环境？]` |
| `result:` | 条件分支 | `case` 语句 | `{result: _last}` |

- `ask:` 节点的结果自动存为 `$<节点ID>`（如节点 B 的结果为 `$B`）
- 预定义变量 `_last` 始终指向最近一次 `ask:` 的结果
- `result:` 节点的边标签（`|value|`）即为 case 分支值

## 控制流（V1）

| 流程结构 | Mermaid 表达 | Shell 转译 |
|---------|-------------|-----------|
| 顺序 | `A --> B --> C` | 顺序执行 |
| 条件分支 | `{result} --> \|x\| A` / `\|y\| B` | `case` 语句 |
| 循环 | 节点回指 `B --> C --> B` | `while` 循环 |

### 条件分支示例

```mermaid
flowchart TD
    A[ask: 选择环境？] --> B{result: _last}
    B -->|staging| C[cmd: deploy staging]
    B -->|production| D[cmd: deploy prod]
    B -->|*| E[cmd: echo "未知"]
```

转译为：

```bash
_last=$(yield "选择环境？")
case "$_last" in
  staging) deploy staging ;;
  production) deploy prod ;;
  *) echo "未知" ;;
esac
```

### 循环示例

```mermaid
flowchart TD
    A[cmd: count=0] --> B[cmd: count=$((count+1))]
    B --> C[ask: 继续？]
    C --> D{result: _last}
    D -->|yes| B
    D -->|no| E[cmd: echo "完成"]
```

转译为：

```bash
count=0
while true; do
  count=$((count+1))
  _last=$(yield "继续？")
  case "$_last" in
    yes) continue ;;
    no) break ;;
  esac
done
echo "完成"
```

## 变量与上下文

- 每个 `ask:` 节点的结果以节点 ID 为变量名存储（如 `$A`, `$B`）
- `_last` 始终为最近一次 `ask:` 的结果
- yield 消息中附带当前所有变量的上下文，方便 agent 做决策
- `cmd:` 节点的 stdout 可通过 `$?` 获取退出码

## 完整转译示例

**输入** (`deploy.mmd`):

```mermaid
flowchart TD
    A[cmd: echo "部署开始"] --> B[ask: 选择哪个环境？]
    B --> C{result: _last}
    C -->|staging| D[cmd: echo "部署到 staging"]
    C -->|production| E[ask: 确认部署到生产？]
    E --> F{result: _last}
    F -->|yes| G[cmd: echo "部署到 production"]
    F -->|no| H[cmd: echo "已取消"]
```

**输出** (`deploy.sh`):

```bash
#!/bin/bash
# Generated from deploy.mmd by yield-mermaid
echo "部署开始"
_last=$(yield "选择哪个环境？")
case "$_last" in
  staging)
    echo "部署到 staging"
    ;;
  production)
    _last=$(yield "确认部署到生产？")
    case "$_last" in
      yes)
        echo "部署到 production"
        ;;
      no)
        echo "已取消"
        ;;
    esac
    ;;
esac
```

## 架构

```
deploy.mmd
    ↓
yield-mermaid (Node.js CLI)
    ├── parse: @mermaid-js/parser → AST
    ├── analyze: 图遍历、环检测、拓扑排序
    └── generate: AST → shell 脚本
    ↓
deploy.sh (生成的脚本)
    ↓
yield-run run './deploy.sh'  (现有机制执行)
```

### 模块划分

| 模块 | 职责 |
|------|------|
| `parser.js` | 调用 `@mermaid-js/parser` 将 .mmd 转为 AST |
| `analyzer.js` | 图分析：入口节点、环检测、拓扑排序、验证 |
| `generator.js` | AST → shell 脚本代码生成 |
| `cli.js` | CLI 入口：run / compile / validate 子命令 |

## CLI 用法

```bash
# 转译 + 执行
yield-mermaid run deploy.mmd

# 只转译不执行（预览生成的脚本）
yield-mermaid compile deploy.mmd -o deploy.sh

# 验证 Mermaid 语法和节点类型
yield-mermaid validate deploy.mmd
```

## 实现技术

- **语言**：Node.js
- **解析器**：`@mermaid-js/parser`（Mermaid 官方 AST 解析器）
- **包管理**：npm，项目内新增 `package.json`
- **依赖**：仅 `@mermaid-js/parser`

## V1 范围

### 包含

- 顺序执行
- 条件分支（`result:` + 边标签 → `case`）
- 循环（节点回指 → `while`）
- 变量传递与 `_last` 预定义变量
- yield 消息附带上下文
- CLI 三个子命令（run / compile / validate）

### 不包含（Future）

- 并行执行（`&` + `wait`）
- subgraph 子流程
- 错误重试机制
- 节点超时控制
- 嵌套条件（多层 if/else）

## 错误处理

- 解析错误：明确提示 Mermaid 语法问题的位置和原因
- 节点验证：检查前缀是否合法（cmd/ask/result），缺失前缀的节点报错
- 图验证：检测孤立节点、无入口节点、无出口节点等问题
- 运行时：shell 脚本自身的错误由 yield-wrapper.sh 现有机制处理
