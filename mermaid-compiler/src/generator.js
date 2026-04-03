/**
 * 代码生成器
 * 将执行流转译为 shell 脚本
 */

/**
 * 将执行流转译为 shell 脚本
 * @param {object} flow - analyzer.js 返回的执行流
 * @param {string} sourceName - 源文件名（用于注释）
 * @returns {string} shell 脚本内容
 */
export function generate(flow, sourceName = 'unknown.mmd') {
  const lines = [];
  lines.push('#!/bin/bash');
  lines.push(`# Generated from ${sourceName} by yield-mermaid`);
  lines.push('');

  emitFlow(flow, lines, 0);

  lines.push('');
  return lines.join('\n');
}

/**
 * 递归生成流程代码
 */
function emitFlow(flow, lines, indent) {
  if (!flow || flow.type === 'empty') return;

  switch (flow.type) {
    case 'sequence':
      for (const step of flow.steps) {
        emitFlow(step, lines, indent);
      }
      break;

    case 'node':
      emitNode(flow.node, lines, indent);
      break;

    case 'condition':
      emitCondition(flow, lines, indent);
      break;

    case 'loop':
      emitLoop(flow, lines, indent);
      break;

    case 'continue':
      lines.push(`${'  '.repeat(indent)}continue`);
      break;

    case 'break':
      lines.push(`${'  '.repeat(indent)}break`);
      break;

    case 'empty':
      break;
  }
}

/**
 * 生成单个节点的代码
 */
function emitNode(node, lines, indent) {
  const pad = '  '.repeat(indent);
  const text = node.text;

  const prefix = getPrefix(text);
  const content = getContent(text);

  switch (prefix) {
    case 'cmd':
      // 直接执行命令，自动将裸 $var 包裹双引号
      lines.push(`${pad}${quoteShellVars(content)}`);
      break;

    case 'ask':
      // yield 给 agent，结果存入变量（转义内容中的双引号）
      const escaped = content.replace(/"/g, '\\"');
      lines.push(`${pad}_last=$(yield "${escaped}")`);
      lines.push(`${pad}${node.id}="$_last"`);
      break;

    case 'result':
      // result 节点本身不生成代码，由 condition 处理
      break;

    default:
      // 没有前缀，当作 cmd 处理
      lines.push(`${pad}${text}`);
      break;
  }
}

/**
 * 生成条件分支的代码
 */
function emitCondition(flow, lines, indent) {
  const pad = '  '.repeat(indent);
  const variable = flow.variable;

  lines.push(`${pad}case "$_last" in`);

  const branchLabels = Object.keys(flow.branches);

  for (const label of branchLabels) {
    const branch = flow.branches[label];
    const pattern = label === '*' ? '*' : label;

    if (branch.type === 'empty') {
      lines.push(`${pad}  ${pattern}) ;;`);
    } else {
      // 检查分支是否只有一条简单指令
      const branchLines = [];
      emitFlow(branch, branchLines, 0);

      if (branchLines.length === 1 && !branchLines[0].includes('case') && !branchLines[0].includes('while')) {
        // 单行分支
        lines.push(`${pad}  ${pattern}) ${branchLines[0].trim()} ;;`);
      } else {
        // 多行分支
        lines.push(`${pad}  ${pattern})`);
        emitFlow(branch, lines, indent + 2);
        lines.push(`${pad}    ;;`);
      }
    }
  }

  lines.push(`${pad}esac`);
}

/**
 * 生成循环的代码
 */
function emitLoop(flow, lines, indent) {
  const pad = '  '.repeat(indent);

  lines.push(`${pad}while true; do`);
  emitFlow(flow.body, lines, indent + 1);

  // 循环末尾的 break 条件需要在 body 内部的 case 中处理
  // 如果 body 中有 condition 且包含 break 指令
  lines.push(`${pad}done`);
}

/**
 * 将命令中未引号包裹的 $var 自动包裹双引号
 * 例如: echo $_last > file.txt → echo "$_last" > file.txt
 */
function quoteShellVars(cmd) {
  // 匹配未被引号包裹的 $VAR 或 ${VAR}，替换为 "$var"
  return cmd.replace(/(?<!["'])\$\{?([A-Za-z_]\w*)\}?/g, '"$$$1"');
}

/**
 * 提取节点文本的前缀
 */
function getPrefix(text) {
  const match = text.match(/^(cmd|ask|result)\s*:/);
  return match ? match[1] : null;
}

/**
 * 提取节点文本的内容（去掉前缀）
 */
function getContent(text) {
  const match = text.match(/^(?:cmd|ask|result)\s*:\s*(.+)/);
  return match ? match[1].trim() : text;
}
