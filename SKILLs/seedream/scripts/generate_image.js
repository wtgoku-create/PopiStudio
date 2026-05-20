#!/usr/bin/env node

/**
 * Seedream 图片生成脚本
 *
 * 现在统一通过内置 popiart CLI 执行：
 * - 文生图 -> popiart image generate
 * - 图生图 -> popiart image img2img
 *
 * 输出会被下载到 skill 目录下的 generation/ 中，便于 LobsterAI 预览。
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_OUTPUT = 'generated_image.png';
const DEFAULT_ASPECT_RATIO = '16:9';

function printError(message) {
  console.error(`错误: ${message}`);
}

function printInfo(message) {
  console.error(message);
}

function runPopiart(args, timeout = 600000) {
  const command = ['popiart', ...args];
  const result = spawnSync(command[0], command.slice(1), {
    encoding: 'utf8',
    timeout,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  const combined = `${stdout}\n${stderr}`.trim();

  if (result.status !== 0) {
    throw new Error(combined || `popiart 命令执行失败: ${command.join(' ')}`);
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`popiart 输出不是合法 JSON: ${stdout || combined}`);
  }
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveGenerationDir() {
  const scriptDir = __dirname;
  const skillDir = path.dirname(scriptDir);
  return path.join(skillDir, 'generation');
}

function guessExtensionFromArtifact(artifactId) {
  const response = runPopiart(['artifacts', 'get', artifactId, '--output', 'json', '--quiet', '--non-interactive']);
  const data = response.data || response;
  const filename = String(data.filename || '');
  const ext = path.extname(filename);
  return ext || '.png';
}

function buildOutputPath(outputArg, fallbackExt = '.png') {
  const generationDir = resolveGenerationDir();
  ensureDirectory(generationDir);

  if (!outputArg) {
    return path.join(generationDir, DEFAULT_OUTPUT);
  }

  const resolved = path.resolve(outputArg);
  const ext = path.extname(resolved);
  if (ext) {
    ensureDirectory(path.dirname(resolved));
    return resolved;
  }

  ensureDirectory(path.dirname(resolved));
  return `${resolved}${fallbackExt}`;
}

function extractArtifactIds(response) {
  const data = response.data || response;
  const directIds = Array.isArray(data.artifact_ids) ? [...data.artifact_ids] : [];

  if (directIds.length > 0) {
    return directIds;
  }

  const outputs = Array.isArray(data.outputs) ? data.outputs : [];
  return outputs
    .map((item) => item && item.artifact_id)
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function pullArtifact(artifactId, outputPath) {
  runPopiart(['artifacts', 'pull', artifactId, '--out', outputPath, '--output', 'json', '--quiet', '--non-interactive'], 300000);
}

function parseArgs(argv) {
  const options = {
    prompt: null,
    image: [],
    output: DEFAULT_OUTPUT,
    model: null,
    'aspect-ratio': DEFAULT_ASPECT_RATIO,
    size: null,
    wait: true,
    search: false,
    sequential: false,
    'max-images': null,
    'no-watermark': false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);

    if (key === 'no-watermark' || key === 'search' || key === 'sequential') {
      options[key] = true;
      continue;
    }

    if (key === 'wait') {
      options.wait = true;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) continue;
    i += 1;

    if (key === 'image') {
      options.image.push(next);
    } else {
      options[key] = next;
    }
  }

  return options;
}

function buildCommand(options) {
  const isImg2Img = options.image.length > 0;
  const command = isImg2Img ? ['image', 'img2img'] : ['image', 'generate'];

  if (isImg2Img) {
    for (const imagePath of options.image) {
      command.push('--image', imagePath);
    }
  }

  command.push('--prompt', options.prompt);

  if (options.model) {
    command.push('--model', options.model);
  }
  if (options['aspect-ratio']) {
    command.push('--aspect-ratio', options['aspect-ratio']);
  }
  if (options.size) {
    command.push('--size', options.size);
  }
  if (options.search) {
    printInfo('提示: `--search` 是旧的 Seedream 直连参数；当前 CLI façade 未提供等价开关，已忽略。');
  }
  if (options.sequential || options['max-images']) {
    printInfo('提示: 组图参数 `--sequential` / `--max-images` 当前未映射到 popiart façade，已忽略。');
  }
  if (options['no-watermark']) {
    printInfo('提示: `--no-watermark` 当前未在 popiart façade 文档中明确保证，已忽略。');
  }

  if (options.wait) {
    command.push('--wait');
  }

  command.push('--output', 'json', '--quiet', '--non-interactive');
  return command;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.prompt) {
    printError('缺少必需参数: --prompt');
    process.exit(1);
  }

  if (options.image.length > 1) {
    printInfo('提示: `popiart image img2img` 主要面向单图输入；多图会按多个 `--image` 直接透传给 CLI。');
  }

  try {
    printInfo('='.repeat(50));
    printInfo('Seedream 图片生成（通过 PopiArt CLI）');
    printInfo('='.repeat(50));
    printInfo('');

    const command = buildCommand(options);
    const response = runPopiart(command);
    const artifactIds = extractArtifactIds(response);

    if (artifactIds.length === 0) {
      throw new Error(`未从 popiart 返回结果中找到 artifact_id: ${JSON.stringify(response)}`);
    }

    const outputPath = buildOutputPath(options.output, guessExtensionFromArtifact(artifactIds[0]));
    pullArtifact(artifactIds[0], outputPath);

    printInfo('');
    printInfo('='.repeat(50));
    printInfo('✓ 生成成功！');
    printInfo('='.repeat(50));

    console.log('图片生成成功！');
    console.log(`文件路径: ${outputPath}`);
    console.log(`artifact_id: ${artifactIds[0]}`);
  } catch (error) {
    printInfo('');
    printInfo('='.repeat(50));
    printError(error instanceof Error ? error.message : String(error));
    printInfo('='.repeat(50));
    process.exit(1);
  }
}

main();
