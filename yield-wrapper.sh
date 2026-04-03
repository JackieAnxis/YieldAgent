#!/bin/bash
# Yield Wrapper - 允许脚本在执行中暂停并等待 agent 响应
#
# 使用方法:
#   ./yield-wrapper.sh start <command>           启动可 yield 的命令
#   ./yield-wrapper.sh resume <session_id> <data> 恢复暂停的命令
#
# 示例:
#   ./yield-wrapper.sh start './generate_jokes.sh'
#   ./yield-wrapper.sh resume session_xxx "笑话内容"
#
# 在脚本中使用 yield:
#   result=$(yield "请求消息")
#   echo "收到: $result"

SESSION_DIR="/tmp/yield-sessions-$USER"
mkdir -p "$SESSION_DIR" 2>/dev/null || SESSION_DIR="$HOME/.yield-sessions"
mkdir -p "$SESSION_DIR"

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
  
  setsid bash -c "
    export SESSION_PATH='$session_path'
    
    yield() {
      echo \"\$1\" > \"\$SESSION_PATH/yield_pipe\"
      cat \"\$SESSION_PATH/resume_pipe\"
    }
    export -f yield
    
    $1
  " </dev/null >/dev/null 2>&1 &
  
  echo "$!" > "$session_path/pid"
  
  # 等待第一个 yield 或进程结束
  timeout 0.5 cat "$session_path/yield_pipe" > "$session_path/last_msg" 2>/dev/null &
  wait $! 2>/dev/null
  
  if ! kill -0 $(cat "$session_path/pid") 2>/dev/null; then
    echo "✓ 命令立即完成"
    rm -rf "$session_path"
  elif [ -s "$session_path/last_msg" ]; then
    msg=$(cat "$session_path/last_msg")
    echo "⏸ YIELD: $msg"
    echo "→ 会话: $session_id"
    echo "→ 继续执行: ./yield-wrapper.sh resume $session_id \"<你的响应>\""
  fi
}

resume_command() {
  local session_id="$1"
  shift
  local data="$*"
  local session_path="$SESSION_DIR/$session_id"
  
  if [ ! -d "$session_path" ]; then
    echo "错误: 会话不存在"
    return 1
  fi
  
  local pid=$(cat "$session_path/pid")
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "✓ 命令已完成"
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
      echo "✓ 命令完成"
      rm -rf "$session_path"
      return 0
    fi
    if [ -s "$session_path/last_msg" ]; then
      break
    fi
  done
  
  if [ -s "$session_path/last_msg" ]; then
    msg=$(cat "$session_path/last_msg")
    echo "⏸ YIELD: $msg"
    echo "→ 会话: $session_id"
    echo "→ 继续执行: ./yield-wrapper.sh resume $session_id \"<你的响应>\""
  fi
}

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
    echo "用法: $0 start <command> | resume <session_id> <data>"
    exit 1
    ;;
esac
