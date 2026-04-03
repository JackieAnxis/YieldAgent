#!/bin/bash
# Yield Wrapper - 允许脚本在执行中暂停并等待 agent 响应
#
# 使用方法:
#   ./yield-wrapper.sh [--json] start <command>           启动可 yield 的命令
#   ./yield-wrapper.sh [--json] resume <session_id> <data> 恢复暂停的命令
#
# 选项:
#   --json    输出 JSON 格式（供 agent 平台解析）
#
# 示例:
#   ./yield-wrapper.sh start './generate_jokes.sh'
#   ./yield-wrapper.sh --json start './demo.sh'
#
# 在脚本中使用 yield:
#   result=$(yield "请求消息")
#   echo "收到: $result"

# 输出模式: text（默认）或 json
OUTPUT_FORMAT="text"

SESSION_DIR="/tmp/yield-sessions-$USER"
mkdir -p "$SESSION_DIR" 2>/dev/null || SESSION_DIR="$HOME/.yield-sessions"
mkdir -p "$SESSION_DIR"

# 输出辅助函数
# 用法: emit <type> <key> <val> [<key> <val> ...]
# JSON 模式: 输出 {"type":"...","key":"val",...}
# 文本模式: 根据 type 输出人类可读格式
emit() {
  local type="$1"; shift

  if [ "$OUTPUT_FORMAT" = "json" ]; then
    if command -v jq &>/dev/null; then
      # 使用 jq 安全构建 JSON
      local args=(-n --arg type "$type")
      local jq_expr='{type: $type'
      local idx=1
      while [ $# -ge 2 ]; do
        args+=("--arg" "k$idx" "$1" "--arg" "v$idx" "$2")
        jq_expr="$jq_expr, \$k$idx: \$v$idx"
        shift 2
        idx=$((idx + 1))
      done
      jq_expr="$jq_expr}"
      jq "${args[@]}" "$jq_expr"
    else
      # fallback: 手动转义
      printf '{"type":"%s"' "$type"
      while [ $# -ge 2 ]; do
        local escaped
        escaped=$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\t/\\t/g; s/\n/\\n/g')
        printf ',"%s":"%s"' "$1" "$escaped"
        shift 2
      done
      printf '}\n'
    fi
  else
    # 文本模式：从参数中提取需要的值
    local msg="" sid=""
    while [ $# -ge 2 ]; do
      case "$1" in
        message) msg="$2" ;;
        session_id) sid="$2" ;;
      esac
      shift 2
    done
    case "$type" in
      yield)
        echo "⏸ YIELD: $msg"
        echo "→ 会话: $sid"
        echo "→ 继续执行: ./yield-wrapper.sh resume $sid \"<你的响应>\""
        ;;
      done)  echo "✓ 命令完成" ;;
      error) echo "错误: $msg" ;;
    esac
  fi
}

# 清理无效会话
cleanup_dead_sessions() {
  for session_path in "$SESSION_DIR"/session_*; do
    [ -d "$session_path" ] || continue
    if [ -f "$session_path/pid" ]; then
      pid=$(cat "$session_path/pid")
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -rf "$session_path" 2>/dev/null
      fi
    fi
  done
}
cleanup_dead_sessions

start_command() {
  local session_id="session_$(date +%s)_$$"
  local session_path="$SESSION_DIR/$session_id"
  mkdir -p "$session_path"
  
  mkfifo "$session_path/yield_pipe"
  mkfifo "$session_path/resume_pipe"
  
  echo "$session_id" > "$session_path/session_id"
  
  # macOS 兼容：优先 setsid，fallback 到 disown
  if command -v setsid &>/dev/null; then
    setsid bash -c "
      export SESSION_PATH='$session_path'
      yield() {
        echo \"\$1\" > \"\$SESSION_PATH/yield_pipe\"
        cat \"\$SESSION_PATH/resume_pipe\"
      }
      export -f yield
      $1
    " </dev/null >/dev/null 2>&1 &
  else
    bash -c "
      export SESSION_PATH='$session_path'
      yield() {
        echo \"\$1\" > \"\$SESSION_PATH/yield_pipe\"
        cat \"\$SESSION_PATH/resume_pipe\"
      }
      export -f yield
      $1
    " </dev/null >/dev/null 2>&1 &
    disown $! 2>/dev/null
  fi

  echo "$!" > "$session_path/pid"

  # 等待第一个 yield 或进程结束（兼容 macOS，不依赖 GNU timeout）
  rm -f "$session_path/last_msg"
  cat "$session_path/yield_pipe" > "$session_path/last_msg" 2>/dev/null &
  local cat_pid=$!
  (
    sleep 0.5
    kill "$cat_pid" 2>/dev/null
  ) &
  local killer_pid=$!
  wait "$cat_pid" 2>/dev/null
  kill "$killer_pid" 2>/dev/null
  wait "$killer_pid" 2>/dev/null
  
  if ! kill -0 $(cat "$session_path/pid") 2>/dev/null; then
    emit done session_id "$session_id"
    rm -rf "$session_path"
  elif [ -s "$session_path/last_msg" ]; then
    msg=$(cat "$session_path/last_msg")
    emit yield message "$msg" session_id "$session_id"
  fi
}

resume_command() {
  local session_id="$1"
  shift
  local data="$*"
  local session_path="$SESSION_DIR/$session_id"
  
  if [ ! -d "$session_path" ]; then
    emit error session_id "$session_id" message "会话不存在"
    return 1
  fi

  local pid=$(cat "$session_path/pid")
  if ! kill -0 "$pid" 2>/dev/null; then
    emit done session_id "$session_id"
    rm -rf "$session_path"
    return 0
  fi

  echo "$data" > "$session_path/resume_pipe"

  # 等待下一个 yield 或进程结束
  rm -f "$session_path/last_msg"
  (
    cat "$session_path/yield_pipe" > "$session_path/last_msg" 2>/dev/null
  ) &
  local cat_pid=$!

  # 轮询检查进程状态
  for i in {1..10}; do
    sleep 0.1
    if ! kill -0 "$pid" 2>/dev/null; then
      kill "$cat_pid" 2>/dev/null
      wait "$cat_pid" 2>/dev/null
      emit done session_id "$session_id"
      rm -rf "$session_path"
      return 0
    fi
    if [ -s "$session_path/last_msg" ]; then
      break
    fi
  done

  if [ -s "$session_path/last_msg" ]; then
    msg=$(cat "$session_path/last_msg")
    emit yield message "$msg" session_id "$session_id"
  fi
}

# 解析全局选项
while [[ "$1" == --* ]]; do
  case "$1" in
    --json) OUTPUT_FORMAT="json"; shift ;;
    *) echo "未知选项: $1"; exit 1 ;;
  esac
done

case "$1" in
  start)
    shift
    start_command "$*"
    ;;
  resume)
    shift
    resume_command "$@"
    ;;
  *)
    echo "用法: $0 [--json] start <command> | resume <session_id> <data>"
    exit 1
    ;;
esac
