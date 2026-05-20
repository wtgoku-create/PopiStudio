#!/usr/bin/env node

/**
 * Seedance 视频生成脚本
 *
 * 统一通过 popiart CLI 的 Seedance façade 执行：
 * - 文生视频 / 图生视频 -> popiart video seedance
 * - 生成音频 -> --generate-audio
 * - 参考音频 -> --audio <path-or-url>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_OUTPUT = 'generated_video.mp4';
const DEFAULT_RATIO = '16:9';
const DEFAULT_DURATION = 5;

function printError(message) {
  console.error(`错误: ${message}`);
}

function printInfo(message) {
  console.error(message);
}

function runPopiart(args, timeout = 900000) {
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

function buildOutputPath(outputArg, fallbackExt = '.mp4') {
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

function extractVideoResult(response) {
  const data = response.data || response;
  const artifactIds = Array.isArray(data.artifact_ids) ? [...data.artifact_ids] : [];
  const outputs = Array.isArray(data.outputs) ? data.outputs : [];

  for (const output of outputs) {
    if (output && typeof output.artifact_id === 'string' && output.artifact_id.length > 0) {
      artifactIds.push(output.artifact_id);
    }
  }

  const firstArtifactId = artifactIds.find((value) => typeof value === 'string' && value.length > 0) || null;
  const resultUrl = typeof data.result_url === 'string' ? data.result_url : null;
  const lastFrameUrl = typeof data.last_frame_url === 'string'
    ? data.last_frame_url
    : (data.metadata && typeof data.metadata.last_frame_url === 'string' ? data.metadata.last_frame_url : null);

  return {
    artifactId: firstArtifactId,
    resultUrl,
    lastFrameUrl,
  };
}

function guessArtifactExtension(artifactId) {
  const response = runPopiart(['artifacts', 'get', artifactId, '--output', 'json', '--quiet', '--non-interactive']);
  const data = response.data || response;
  const filename = String(data.filename || '');
  return path.extname(filename) || '.mp4';
}

function pullArtifact(artifactId, outputPath) {
  runPopiart(['artifacts', 'pull', artifactId, '--out', outputPath, '--output', 'json', '--quiet', '--non-interactive'], 300000);
}

function parseArgs(argv) {
  const options = {
    prompt: null,
    image: [],
    video: [],
    audio: [],
    model: null,
    duration: DEFAULT_DURATION,
    ratio: DEFAULT_RATIO,
    output: DEFAULT_OUTPUT,
    'return-last-frame': false,
    'generate-audio': false,
    wait: true,
    'no-watermark': false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);

    if (key === 'return-last-frame' || key === 'generate-audio' || key === 'wait' || key === 'no-watermark') {
      options[key] = true;
      continue;
    }

    if (key === 'audio') {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        options.audio.push(next);
        i += 1;
      } else {
        // 兼容旧 skill：`--audio` 曾被当作“生成音频”开关。
        options['generate-audio'] = true;
      }
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) continue;
    i += 1;

    if (key === 'image' || key === 'video') {
      options[key].push(next);
    } else if (key === 'duration') {
      options.duration = Number.parseInt(next, 10);
    } else {
      options[key] = next;
    }
  }

  return options;
}

function buildCommand(options) {
  const command = ['video', 'seedance'];

  for (const imagePath of options.image) {
    command.push('--image', imagePath);
  }
  for (const videoPath of options.video) {
    command.push('--video', videoPath);
  }
  for (const audioPath of options.audio) {
    command.push('--audio', audioPath);
  }

  if (options.prompt) {
    command.push('--prompt', options.prompt);
  }
  if (options.model) {
    command.push('--model', options.model);
  }
  if (options.duration) {
    command.push('--duration', String(options.duration));
  }
  if (options.ratio) {
    command.push('--ratio', options.ratio);
  }
  if (options['return-last-frame']) {
    command.push('--return-last-frame');
  }
  if (options['generate-audio']) {
    command.push('--generate-audio');
  }
  if (options['no-watermark']) {
    printInfo('提示: `--no-watermark` 当前未在 popiart Seedance façade 文档中明确保证，已忽略。');
  }
  if (options.wait) {
    command.push('--wait');
  }

  command.push('--output', 'json', '--quiet', '--non-interactive');
  return command;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const hasAnyInput = options.image.length > 0 || options.video.length > 0 || options.audio.length > 0;
  if (!options.prompt && !hasAnyInput) {
    printError('缺少必需参数: 至少提供 `--prompt`，或提供图片/视频/音频参考输入。');
    process.exit(1);
  }

  try {
    printInfo('='.repeat(50));
    printInfo('Seedance 视频生成（通过 PopiArt CLI）');
    printInfo('='.repeat(50));
    printInfo('');

    const command = buildCommand(options);
    const response = runPopiart(command);
    const { artifactId, resultUrl, lastFrameUrl } = extractVideoResult(response);

    if (!artifactId) {
      throw new Error(`未从 popiart 返回结果中找到视频 artifact_id: ${JSON.stringify(response)}`);
    }

    const outputPath = buildOutputPath(options.output, guessArtifactExtension(artifactId));
    pullArtifact(artifactId, outputPath);

    printInfo('');
    printInfo('='.repeat(50));
    printInfo('✓ 生成成功！');
    printInfo('='.repeat(50));

    console.log('视频生成成功！');
    console.log(`文件路径: ${outputPath}`);
    console.log(`artifact_id: ${artifactId}`);
    if (resultUrl) {
      console.log(`result_url: ${resultUrl}`);
    }
    if (lastFrameUrl) {
      console.log(`last_frame_url: ${lastFrameUrl}`);
    }
  } catch (error) {
    printInfo('');
    printInfo('='.repeat(50));
    printError(error instanceof Error ? error.message : String(error));
    printInfo('='.repeat(50));
    process.exit(1);
  }
}

main();
