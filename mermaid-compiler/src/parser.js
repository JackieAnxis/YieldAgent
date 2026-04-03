/**
 * Mermaid 流程图解析器
 * 手写正则解析器，只处理 flowchart 子集：
 * - flowchart TD/LR/TB/RL 头
 * - 节点：ID[text]、ID(text)、ID{text}、ID[[text]]
 * - 边：ID --> ID、ID -->|label| ID
 * - 注释：%% ...
 */

// 节点形状对应的正则（按括号类型区分）
const NODE_PATTERNS = [
  // ID[[text]] - 子程序形状（必须在方括号之前匹配）
  { regex: /(\w+)\[\[([^\]]+)\]\]/g, shape: 'subroutine' },
  // ID[text] - 矩形
  { regex: /(\w+)\[([^\]]+)\]/g, shape: 'rect' },
  // ID(text) - 圆角矩形
  { regex: /(\w+)\(([^)]+)\)/g, shape: 'round' },
  // ID{text} - 菱形（条件）
  { regex: /(\w+)\{([^}]+)\}/g, shape: 'diamond' },
];

// 边的正则：支持 -->、---、==>、-.-> 等，可带 |label|
const EDGE_REGEX = /(\w+)\s*(-->|---|==>|-.->)\s*(?:\|([^|]*)\|)?\s*(\w+)/g;

// 流程图头：flowchart/graph + 方向
const HEADER_REGEX = /^\s*(?:flowchart|graph)\s+(TD|TB|LR|RL)\s*$/i;

// 不支持的 Mermaid 语法检测规则
const UNSUPPORTED_PATTERNS = [
  { regex: /^\s*subgraph\b/i, name: 'subgraph（子图）' },
  { regex: /^\s*end\s*$/i, name: 'end（子图结束）' },
  { regex: /^\s*click\s/i, name: 'click（点击事件）' },
  { regex: /^\s*style\s/i, name: 'style（样式定义）' },
  { regex: /^\s*classDef\s/i, name: 'classDef（类定义）' },
  { regex: /^\s*class\s\s/i, name: 'class（类应用）' },
  { regex: /^\s*linkStyle\s/i, name: 'linkStyle（链接样式）' },
];

/**
 * 解析 Mermaid 流程图为图结构
 * @param {string} text - Mermaid 文本
 * @returns {{ direction: string, nodes: Array, edges: Array, warnings: string[] }}
 */
export function parse(text) {
  const lines = text.split('\n');
  let direction = 'TD';
  const nodes = new Map(); // id -> { id, text, shape }
  const edges = [];
  const warnings = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    // 检测不支持的语法，命中则跳过该行
    let unsupported = false;
    for (const { regex, name } of UNSUPPORTED_PATTERNS) {
      if (regex.test(line)) {
        warnings.push(`第 ${i + 1} 行: 不支持的语法 "${name}"，该行将被忽略`);
        unsupported = true;
        break;
      }
    }
    if (unsupported) continue;

    // 解析头部
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      direction = headerMatch[1].toUpperCase();
      continue;
    }

    // 解析边（必须在节点之前，因为边中包含节点 ID）
    parseEdges(line, edges, nodes);

    // 解析节点定义
    parseNodes(line, nodes);
  }

  return {
    direction,
    nodes: Array.from(nodes.values()),
    edges,
    warnings,
  };
}

/**
 * 去掉行内注释
 */
function stripComment(line) {
  const idx = line.indexOf('%%');
  return idx >= 0 ? line.substring(0, idx) : line;
}

/**
 * 从一行中解析边
 */
function parseEdges(line, edges, nodes) {
  // 先剥离行中的节点定义，将 ID[text] 替换为 ID
  // 否则节点定义的括号会干扰边正则匹配（如 A[text] --> B[text] 中，
  // A 和 --> 之间插入了 [text]，导致 (\w+)\s*--> 匹配失败）
  let stripped = line;
  stripped = stripped.replace(/(\w+)\[\[[^\]]*\]\]/g, '$1');
  stripped = stripped.replace(/(\w+)\[[^\]]*\]/g, '$1');
  stripped = stripped.replace(/(\w+)\([^)]*\)/g, '$1');
  stripped = stripped.replace(/(\w+)\{[^}]*\}/g, '$1');

  // 重置 regex lastIndex
  EDGE_REGEX.lastIndex = 0;
  let match;
  while ((match = EDGE_REGEX.exec(stripped)) !== null) {
    const [, fromId, _arrow, label, toId] = match;
    // 确保 from/to 节点存在（如果还没定义就先创建占位）
    ensureNode(nodes, fromId);
    ensureNode(nodes, toId);
    edges.push({
      from: fromId,
      to: toId,
      label: label ? label.trim() : null,
    });
  }
}

/**
 * 从一行中解析节点定义
 */
function parseNodes(line, nodes) {
  for (const { regex, shape } of NODE_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
      const [, id, text] = match;
      nodes.set(id, { id, text: text.trim(), shape });
    }
  }
}

/**
 * 确保节点存在（如果引用了未定义的节点，创建占位）
 */
function ensureNode(nodes, id) {
  if (!nodes.has(id)) {
    nodes.set(id, { id, text: id, shape: 'rect' });
  }
}

/**
 * 解析结果的验证
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(ast) {
  const errors = [];
  const nodeIds = new Set(ast.nodes.map((n) => n.id));

  // 检查节点前缀
  for (const node of ast.nodes) {
    const prefix = getPrefix(node.text);
    if (node.shape === 'diamond' && prefix !== 'result') {
      errors.push(`节点 ${node.id}: 菱形节点必须使用 result: 前缀，当前为 "${node.text}"`);
    }
    if (node.shape !== 'diamond' && prefix && !['cmd', 'ask'].includes(prefix)) {
      errors.push(`节点 ${node.id}: 未知前缀 "${prefix}"，支持 cmd: / ask: / result:`);
    }
  }

  // 检查边引用的节点是否存在
  for (const edge of ast.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`边引用了不存在的节点 "${edge.from}"`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`边引用了不存在的节点 "${edge.to}"`);
    }
  }

  // 检查是否有入口节点（无入边的节点，排除回边目标）
  // 使用 DFS 检测回边，排除回边后判断入口
  const backEdges = detectBackEdgesForValidation(ast.nodes, ast.edges);
  const nonBackIncoming = new Set();
  for (const edge of ast.edges) {
    const isBack = backEdges.some((b) => b.from === edge.from && b.to === edge.to);
    if (!isBack) {
      nonBackIncoming.add(edge.to);
    }
  }
  const entryNodes = ast.nodes.filter((n) => !nonBackIncoming.has(n.id));
  if (entryNodes.length === 0 && ast.nodes.length > 0) {
    errors.push('没有找到入口节点（所有节点都有入边，可能存在循环依赖）');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 提取节点文本的前缀
 */
function getPrefix(text) {
  const match = text.match(/^(cmd|ask|result)\s*:/);
  return match ? match[1] : null;
}

/**
 * 为验证阶段检测回边（简化版 DFS）
 */
function detectBackEdgesForValidation(nodes, edges) {
  const backEdges = [];
  const outgoing = new Map();
  for (const n of nodes) outgoing.set(n.id, []);
  for (const e of edges) outgoing.get(e.from).push(e.to);

  const visited = new Set();
  const inStack = new Set();

  function dfs(nodeId) {
    visited.add(nodeId);
    inStack.add(nodeId);
    for (const to of outgoing.get(nodeId) || []) {
      if (inStack.has(to)) {
        backEdges.push({ from: nodeId, to });
      } else if (!visited.has(to)) {
        dfs(to);
      }
    }
    inStack.delete(nodeId);
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) dfs(n.id);
  }
  return backEdges;
}
