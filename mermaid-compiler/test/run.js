/**
 * yield-mermaid 测试运行器
 * 验证各示例 .mmd 文件的编译输出是否符合预期
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse, validate } from '../src/parser.js';
import { analyze } from '../src/analyzer.js';
import { generate } from '../src/generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    failed++;
  }
}

function assertContains(haystack, needle, msg) {
  if (!haystack.includes(needle)) {
    throw new Error(`${msg || '期望包含'}: "${needle}"\n    实际输出:\n${haystack}`);
  }
}

function assertNotContains(haystack, needle, msg) {
  if (haystack.includes(needle)) {
    throw new Error(`${msg || '期望不包含'}: "${needle}"`);
  }
}

function compileMmd(filename) {
  const content = readFileSync(resolve(fixturesDir, filename), 'utf-8');
  const ast = parse(content);
  const validation = validate(ast);
  if (!validation.valid) {
    throw new Error(`验证失败: ${validation.errors.join(', ')}`);
  }
  const flow = analyze(ast);
  return generate(flow, filename);
}

// ============================================================
console.log('\n=== parser 测试 ===\n');

test('解析简单顺序流程', () => {
  const ast = parse(`flowchart TD
    A[cmd: echo "hello"] --> B[ask: 问题？]
    B --> C[cmd: echo "done"]`);
  if (ast.nodes.length !== 3) throw new Error(`期望 3 个节点，实际 ${ast.nodes.length}`);
  if (ast.edges.length !== 2) throw new Error(`期望 2 条边，实际 ${ast.edges.length}`);
});

test('解析带标签的边', () => {
  const ast = parse(`flowchart TD
    A{result: x}
    A -->|yes| B[cmd: ok]
    A -->|no| C[cmd: cancel]`);
  const yesEdge = ast.edges.find((e) => e.label === 'yes');
  const noEdge = ast.edges.find((e) => e.label === 'no');
  if (!yesEdge || !noEdge) throw new Error('缺少标签为 yes/no 的边');
});

test('检测不支持的 subgraph 语法', () => {
  const ast = parse(`flowchart TD
    subgraph g1
      A[cmd: test]
    end`);
  if (ast.warnings.length === 0) throw new Error('期望有警告');
  if (!ast.warnings[0].includes('subgraph')) throw new Error('期望警告包含 subgraph');
});

test('验证菱形节点必须用 result: 前缀', () => {
  const ast = parse(`flowchart TD
    A{wrong prefix}
    A --> B[cmd: ok]`);
  const validation = validate(ast);
  if (validation.valid) throw new Error('期望验证失败');
});

// ============================================================
console.log('\n=== 编译输出测试 ===\n');

test('simple.mmd — 顺序执行', () => {
  const script = compileMmd('simple.mmd');
  assertContains(script, 'echo "开始"');
  assertContains(script, '_last=$(yield "你想做什么？")');
  assertContains(script, 'echo "结束"');
});

test('deploy.mmd — 条件分支', () => {
  const script = compileMmd('deploy.mmd');
  assertContains(script, 'echo "部署开始"');
  assertContains(script, '_last=$(yield "选择哪个环境？")');
  assertContains(script, 'case "$_last" in');
  assertContains(script, 'staging) echo "部署到 staging"');
  assertContains(script, 'production)');
  assertContains(script, '_last=$(yield "确认部署到生产？")');
  assertContains(script, 'yes) echo "部署到 production"');
  assertContains(script, 'no) echo "已取消"');
  assertContains(script, 'esac');
});

test('loop.mmd — 循环', () => {
  const script = compileMmd('loop.mmd');
  assertContains(script, 'echo "循环开始"');
  assertContains(script, 'while true; do');
  assertContains(script, '_last=$(yield "继续吗？")');
  assertContains(script, 'yes) continue');
  assertContains(script, 'no) break');
  assertContains(script, 'done');
  assertContains(script, 'echo "结束"');
});

test('unsupported.mmd — 跳过不支持语法后仍可编译', () => {
  const script = compileMmd('unsupported.mmd');
  assertContains(script, 'echo "开始"');
  assertContains(script, '_last=$(yield "选环境？")');
  // subgraph 不应出现在输出中
  assertNotContains(script, 'subgraph');
});

// ============================================================
console.log('\n=== 结果 ===\n');
console.log(`通过: ${passed}, 失败: ${failed}`);

if (failed > 0) {
  process.exit(1);
}
