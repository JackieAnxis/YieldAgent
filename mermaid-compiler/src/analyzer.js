/**
 * 图分析器
 * 分析解析后的图结构，构建可执行的流程表示
 * - 找入口节点
 * - 检测环（用于循环生成）
 * - 构建执行流（顺序、分支、循环）
 */

/**
 * 分析图结构，返回执行流
 * @param {object} ast - parser.js 返回的 { direction, nodes, edges }
 * @returns {object} 执行流描述
 */
export function analyze(ast) {
  const { nodes, edges } = ast;
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // 构建邻接表
  const outgoing = new Map(); // nodeId -> [{ to, label }]
  const incoming = new Map(); // nodeId -> [{ from, label }]

  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
  }
  for (const edge of edges) {
    outgoing.get(edge.from).push({ to: edge.to, label: edge.label });
    incoming.get(edge.to).push({ from: edge.from, label: edge.label });
  }

  // 找入口节点（无入边的节点）
  const entries = nodes.filter((n) => incoming.get(n.id).length === 0);
  if (entries.length === 0 && nodes.length > 0) {
    // 如果所有节点都有入边，可能存在纯循环图，选第一个节点
    entries.push(nodes[0]);
  }

  // 检测环，标记回边
  const backEdges = detectBackEdges(nodes, outgoing);

  // 构建执行流（从第一个入口开始）
  const flow = buildFlow(entries[0], nodeMap, outgoing, incoming, backEdges, new Set());

  return flow;
}

/**
 * 使用 DFS 检测回边（环）
 * 返回回边列表 [{ from, to }]
 */
function detectBackEdges(nodes, outgoing) {
  const backEdges = [];
  const visited = new Set();
  const inStack = new Set();

  function dfs(nodeId) {
    visited.add(nodeId);
    inStack.add(nodeId);

    const neighbors = outgoing.get(nodeId) || [];
    for (const { to } of neighbors) {
      if (inStack.has(to)) {
        // 回边：目标在当前 DFS 栈中
        backEdges.push({ from: nodeId, to: to });
      } else if (!visited.has(to)) {
        dfs(to);
      }
    }

    inStack.delete(nodeId);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return backEdges;
}

/**
 * 递归构建执行流
 * @param {object} node - 当前节点
 * @param {Map} nodeMap - 节点映射
 * @param {Map} outgoing - 出边表
 * @param {Map} incoming - 入边表
 * @param {Array} backEdges - 回边列表
 * @param {Set} visited - 已访问节点
 * @returns {object} 流描述
 */
function buildFlow(node, nodeMap, outgoing, incoming, backEdges, visited) {
  if (!node || visited.has(node.id)) {
    return { type: 'empty' };
  }

  visited.add(node.id);

  // 检查入口节点本身是否是循环目标（回边指向它）
  // 如：A-->B-->C-->D-->E-->A（回边），从 A 开始构建时，A 就是循环目标
  const entryBackTargets = backEdges.filter((b) => b.to === node.id);
  if (entryBackTargets.length > 0) {
    // 入口节点是循环目标 → 整个流构建为 while 循环
    const { loopBody, loopExits } = buildLoopBody(
      node, nodeMap, outgoing, backEdges, new Set(visited)
    );

    // 循环结束后继续的节点 = 回边源节点的非回边出边 + 循环体追踪到的出口节点
    const afterSteps = [];
    const processedExits = new Set();

    // 处理回边源节点的非回边出边（这是循环退出的主要路径）
    for (const bt of entryBackTargets) {
      const srcNonBack = (outgoing.get(bt.from) || []).filter(
        (e) => !backEdges.some((b) => b.from === bt.from && b.to === e.to)
      );
      for (const edge of srcNonBack) {
        if (!visited.has(edge.to) && !processedExits.has(edge.to)) {
          processedExits.add(edge.to);
          const rest = buildFlow(nodeMap.get(edge.to), nodeMap, outgoing, incoming, backEdges, new Set(visited));
          if (rest.type !== 'empty') afterSteps.push(rest);
        }
      }
    }

    // 处理循环体中追踪到的出口节点（兜底）
    for (const exitId of loopExits) {
      if (!visited.has(exitId) && !processedExits.has(exitId)) {
        processedExits.add(exitId);
        const rest = buildFlow(nodeMap.get(exitId), nodeMap, outgoing, incoming, backEdges, new Set(visited));
        if (rest.type !== 'empty') afterSteps.push(rest);
      }
    }

    if (afterSteps.length === 0) return loopBody;
    return { type: 'sequence', steps: [loopBody, ...afterSteps] };
  }

  const steps = [];
  let current = node;

  while (current) {
    const outEdges = outgoing.get(current.id) || [];
    const nonBackEdges = outEdges.filter(
      (e) => !backEdges.some((b) => b.from === current.id && b.to === e.to)
    );
    const backEdgeFromHere = backEdges.find((b) => b.from === current.id);

    // 检查当前节点是否是循环的回边目标
    const isLoopTarget = backEdges.some((b) => b.to === current.id);

    if (isLoopTarget && current.id !== node.id) {
      // 这是一个循环目标节点，生成 while 循环
      const { loopBody, loopExits } = buildLoopBody(
        current, nodeMap, outgoing, backEdges, new Set(visited)
      );
      steps.push(loopBody);

      // 循环后继续的节点 = 回边源节点的非回边出边（优先）或循环出口节点
      let nextNode = null;

      const backSrc = backEdges.find((b) => b.to === current.id);
      if (backSrc) {
        const srcNonBack = (outgoing.get(backSrc.from) || []).filter(
          (e) => !backEdges.some((b) => b.from === backSrc.from && b.to === e.to)
        );
        if (srcNonBack.length > 0) {
          nextNode = nodeMap.get(srcNonBack[0].to);
        }
      }

      // 兜底：循环出口节点
      if (!nextNode) {
        for (const exitId of loopExits) {
          if (!visited.has(exitId)) {
            nextNode = nodeMap.get(exitId);
            break;
          }
        }
      }

      if (nextNode) {
        current = nextNode;
        continue;
      }
      break;
    }

    // 添加当前节点步骤
    steps.push({ type: 'node', node: { ...current } });

    if (nonBackEdges.length === 0) {
      // 无出边或只有回边，结束
      break;
    } else if (nonBackEdges.length === 1) {
      // 单一出边，继续顺序执行
      const nextId = nonBackEdges[0].to;
      if (visited.has(nextId)) {
        break;
      }
      current = nodeMap.get(nextId);
    } else {
      // 多个出边 - 条件分支（result 节点）
      const branches = {};
      for (const edge of nonBackEdges) {
        const label = edge.label || '*';
        if (!visited.has(edge.to)) {
          const branchFlow = buildFlow(
            nodeMap.get(edge.to),
            nodeMap,
            outgoing,
            incoming,
            backEdges,
            new Set(visited)
          );
          branches[label] = branchFlow;
        } else {
          branches[label] = { type: 'empty' };
        }
      }
      steps.push({
        type: 'condition',
        variable: current.id,
        branches,
      });
      break; // 条件分支后不再继续顺序执行
    }
  }

  if (steps.length === 1) return steps[0];
  return { type: 'sequence', steps };
}

/**
 * 构建循环体
 * 从循环目标节点开始，到回边源节点（条件分支）结束
 *
 * 返回 { loopBody, loopExits }
 * - loopBody: while 循环的 flow 结构
 * - loopExits: 循环出口节点 ID 列表（真正跳出循环的前进边目标）
 *
 * 关键逻辑：
 * - 回边分支 → continue
 * - 前进边分支需要区分：
 *   a) 目标可达循环头（如 D→E→A）→ 构建完整分支流（含中间节点）+ continue
 *   b) 目标不可达循环头（如 F）→ 循环出口，生成 break
 *   c) 目标是已访问节点 → continue
 */
function buildLoopBody(loopTarget, nodeMap, outgoing, backEdges, visited) {
  const bodySteps = [];
  const loopExits = [];
  let current = loopTarget;

  while (current) {
    visited.add(current.id);

    const outEdges = outgoing.get(current.id) || [];

    // 区分回边和前进边
    const forwardEdges = outEdges.filter(
      (e) => !backEdges.some((b) => b.from === current.id && b.to === e.to)
    );

    if (outEdges.length > 1) {
      // 多条出边 → 条件分支
      bodySteps.push({ type: 'node', node: { ...current } });

      const branches = {};
      for (const edge of outEdges) {
        const label = edge.label || '*';
        const isBack = backEdges.some(
          (b) => b.from === current.id && b.to === edge.to
        );
        if (isBack) {
          // 回边分支 → 循环继续
          branches[label] = { type: 'continue' };
        } else if (visited.has(edge.to)) {
          // 目标已访问 → continue
          branches[label] = { type: 'continue' };
        } else if (forwardReachesLoopTarget(edge.to, loopTarget.id, nodeMap, outgoing, backEdges)) {
          // 前进边可达循环头 → 循环体的一部分
          // 构建分支流：从目标到循环头的路径（含中间节点和条件分支）
          const branchFlow = buildBranchFlow(
            edge.to, loopTarget.id, nodeMap, outgoing, backEdges, new Set(visited)
          );
          branches[label] = branchFlow;
        } else {
          // 前进边不可达循环头 → 循环出口
          branches[label] = { type: 'break' };
          loopExits.push(edge.to);
        }
      }

      bodySteps.push({
        type: 'condition',
        variable: current.id,
        branches,
      });
      break;
    }

    // 普通节点（单一出边或无出边）
    bodySteps.push({ type: 'node', node: { ...current } });

    if (forwardEdges.length === 0) {
      break;
    } else if (forwardEdges.length === 1) {
      const nextId = forwardEdges[0].to;
      if (nextId === loopTarget.id || visited.has(nextId)) {
        break;
      }
      current = nodeMap.get(nextId);
    } else {
      break;
    }
  }

  const body =
    bodySteps.length === 1 ? bodySteps[0] : { type: 'sequence', steps: bodySteps };

  return {
    loopBody: {
      type: 'loop',
      loopNode: loopTarget,
      body,
    },
    loopExits,
  };
}

/**
 * 构建分支流：从 startId 到 loopTargetId 的路径
 * 处理路径上的所有节点和条件分支
 * 返回 sequence flow，以 continue 结尾（回到循环头）
 */
function buildBranchFlow(startId, loopTargetId, nodeMap, outgoing, backEdges, visited) {
  const steps = [];
  let currentId = startId;

  while (currentId && currentId !== loopTargetId && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodeMap.get(currentId);
    if (!node) break;

    const outEdges = outgoing.get(currentId) || [];

    if (outEdges.length > 1) {
      // 条件节点：处理各分支
      steps.push({ type: 'node', node: { ...node } });

      const branches = {};
      for (const edge of outEdges) {
        const label = edge.label || '*';
        if (edge.to === loopTargetId) {
          branches[label] = { type: 'continue' };
        } else if (visited.has(edge.to)) {
          branches[label] = { type: 'continue' };
        } else if (forwardReachesLoopTarget(edge.to, loopTargetId, nodeMap, outgoing, backEdges)) {
          // 递归处理可达循环头的分支
          branches[label] = buildBranchFlow(
            edge.to, loopTargetId, nodeMap, outgoing, backEdges, new Set(visited)
          );
        } else {
          branches[label] = { type: 'break' };
        }
      }

      steps.push({ type: 'condition', variable: currentId, branches });
      steps.push({ type: 'continue' });

      if (steps.length === 1) return steps[0];
      return { type: 'sequence', steps };
    }

    steps.push({ type: 'node', node: { ...node } });

    const nonBack = outEdges.filter(
      (e) => !backEdges.some((b) => b.from === currentId && b.to === e.to)
    );

    if (nonBack.length === 0) break;
    if (nonBack.length === 1) {
      currentId = nonBack[0].to;
    } else {
      break;
    }
  }

  // 到达循环头 → continue
  steps.push({ type: 'continue' });

  if (steps.length === 1) return steps[0];
  return { type: 'sequence', steps };
}

/**
 * 判断从 startId 出发，沿边是否可达 loopTargetId
 * 用于区分"循环体内的路径"和"循环出口"
 *
 * 注意：必须检查所有边（包括回边），因为回边就是指向循环头的。
 * 如 E→A 是回边，但正是它让 E 成为循环体的一部分。
 */
function forwardReachesLoopTarget(startId, loopTargetId, nodeMap, outgoing, backEdges) {
  const visited = new Set();
  let currentId = startId;

  while (currentId && !visited.has(currentId)) {
    if (currentId === loopTargetId) return true;
    visited.add(currentId);

    const outEdges = outgoing.get(currentId) || [];

    if (outEdges.length === 0) return false;

    // 检查所有出边（包括回边！回边指向循环头就是可达的证明）
    for (const edge of outEdges) {
      if (edge.to === loopTargetId) return true;
    }

    // 沿第一条边继续追踪（线性路径）
    // 如果有分支，递归检查每条分支
    if (outEdges.length === 1) {
      currentId = outEdges[0].to;
    } else {
      for (const edge of outEdges) {
        if (forwardReachesLoopTarget(edge.to, loopTargetId, nodeMap, outgoing, backEdges)) {
          return true;
        }
      }
      return false;
    }
  }

  return false;
}
