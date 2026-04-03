#!/usr/bin/env node

/**
 * yield-mermaid CLI
 * 将 Mermaid 流程图转译为 yield shell 脚本
 *
 * 用法：
 *   yield-mermaid run <file.mmd>          转译并执行
 *   yield-mermaid compile <file.mmd> [-o output.sh]  只转译
 *   yield-mermaid validate <file.mmd>     验证语法
 */

import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { execSync, spawn } from 'child_process';
import { parse, validate } from './parser.js';
import { analyze } from './analyzer.js';
import { generate } from './generator.js';

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`
yield-mermaid - 将 Mermaid 流程图转译为 yield shell 脚本

用法：
  yield-mermaid run <file.mmd>                      转译并执行
  yield-mermaid compile <file.mmd> [-o output.sh]   只转译不执行
  yield-mermaid validate <file.mmd>                  验证 Mermaid 语法
  yield-mermaid help                                 显示帮助
`);
}

/**
 * 编译 .mmd 文件为 shell 脚本
 * @returns {string} 生成的 shell 脚本
 */
function compileFile(filePath) {
  const absPath = resolve(filePath);
  const content = readFileSync(absPath, 'utf-8');
  const name = basename(filePath);

  // 1. 解析
  const ast = parse(content);

  // 输出解析警告（不支持的语法）
  if (ast.warnings && ast.warnings.length > 0) {
    console.warn('警告：');
    for (const w of ast.warnings) {
      console.warn(`  ⚠ ${w}`);
    }
  }

  // 2. 验证
  const validation = validate(ast);
  if (!validation.valid) {
    console.error('验证失败：');
    for (const err of validation.errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // 3. 分析
  const flow = analyze(ast);

  // 4. 生成
  const script = generate(flow, name);

  return script;
}

// 子命令处理
switch (command) {
  case 'compile': {
    const file = args[1];
    if (!file) {
      console.error('错误：请指定 .mmd 文件');
      usage();
      process.exit(1);
    }

    const script = compileFile(file);

    // 检查 -o 参数
    const oIdx = args.indexOf('-o');
    if (oIdx >= 0 && args[oIdx + 1]) {
      const outputPath = args[oIdx + 1];
      writeFileSync(outputPath, script, 'utf-8');
      console.log(`已输出到: ${outputPath}`);
    } else {
      console.log(script);
    }
    break;
  }

  case 'validate': {
    const file = args[1];
    if (!file) {
      console.error('错误：请指定 .mmd 文件');
      usage();
      process.exit(1);
    }

    const absPath = resolve(file);
    const content = readFileSync(absPath, 'utf-8');

    try {
      const ast = parse(content);
      const validation = validate(ast);

      console.log(`节点数: ${ast.nodes.length}`);
      console.log(`边数: ${ast.edges.length}`);
      console.log(`方向: ${ast.direction}`);

      // 输出解析警告
      if (ast.warnings && ast.warnings.length > 0) {
        console.log('\n警告：');
        for (const w of ast.warnings) {
          console.log(`  ⚠ ${w}`);
        }
      }

      if (validation.valid) {
        console.log('\n验证通过 ✓');
      } else {
        console.error('\n验证失败：');
        for (const err of validation.errors) {
          console.error(`  - ${err}`);
        }
        process.exit(1);
      }
    } catch (e) {
      console.error(`解析错误: ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case 'run': {
    const file = args[1];
    if (!file) {
      console.error('错误：请指定 .mmd 文件');
      usage();
      process.exit(1);
    }

    const script = compileFile(file);

    // 写入临时文件
    const tmpPath = `/tmp/yield-mermaid-${Date.now()}.sh`;
    writeFileSync(tmpPath, script, 'utf-8');
    execSync(`chmod +x ${tmpPath}`);

    // 查找 yield-run
    const yieldRunPath = findYieldRun();
    if (!yieldRunPath) {
      console.error('错误：找不到 yield-run，请确保它在 PATH 中或项目目录中');
      process.exit(1);
    }

    // 执行 yield-run run
    const child = spawn(yieldRunPath, ['run', tmpPath], {
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      // 清理临时文件
      try {
        execSync(`rm -f ${tmpPath}`);
      } catch (_) {}
      process.exit(code || 0);
    });
    break;
  }

  case 'help':
  case '--help':
  case '-h':
  case undefined:
    usage();
    break;

  default:
    console.error(`未知命令: ${command}`);
    usage();
    process.exit(1);
}

/**
 * 查找 yield-run 可执行文件
 */
function findYieldRun() {
  // 1. 先检查 PATH
  try {
    return execSync('which yield-run', { encoding: 'utf-8' }).trim();
  } catch (_) {}

  // 2. 检查项目目录（相对于当前文件）
  const candidates = [
    '../../yield-run',           // mermaid-compiler/src/ -> YieldAgent/
    '../../../yield-run',       // fallback
    resolve(process.cwd(), '../yield-run'),
    resolve(process.cwd(), 'yield-run'),
  ];

  for (const candidate of candidates) {
    try {
      const resolved = resolve(candidate);
      readFileSync(resolved);
      return resolved;
    } catch (_) {}
  }

  return null;
}
