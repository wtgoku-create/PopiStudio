#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_COS_PREFIX = 'popiai/local-tests';

function readEnv(name, required = true) {
  const value = (process.env[name] || '').trim();
  if (required && !value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function runCommand(stage, command, args, options = {}) {
  console.log(`[CosUploadTest] ${stage}`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    throw new Error(`${stage} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    const stdout = result.stdout ? `\n${result.stdout.trim()}` : '';
    throw new Error(`${stage} failed with exit code ${result.status}${stderr}${stdout}`);
  }

  return result.stdout || '';
}

function normalizePrefix(prefix) {
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
}

async function createTempFile(objectKey) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'popiai-cos-test-'));
  const filePath = path.join(tempDir, path.basename(objectKey));
  const content = [
    'Popiai COS upload test',
    `createdAt=${new Date().toISOString()}`,
    `objectKey=${objectKey}`,
    '',
  ].join('\n');
  await fs.promises.writeFile(filePath, content, 'utf8');
  return { tempDir, filePath };
}

async function cleanupLocal(tempDir) {
  if (!tempDir) return;
  try {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.warn('[CosUploadTest] failed to remove local temp directory:', error);
  }
}

async function main() {
  const secretId = readEnv('TENCENT_COS_SECRET_ID');
  const secretKey = readEnv('TENCENT_COS_SECRET_KEY');
  const bucket = readEnv('TENCENT_COS_BUCKET');
  const region = readEnv('TENCENT_COS_REGION');
  const endpoint = readEnv('TENCENT_COS_ENDPOINT', false);
  const publicBaseUrl = readEnv('TENCENT_COS_PUBLIC_BASE_URL', false);
  const prefix = normalizePrefix(readEnv('TENCENT_COS_PREFIX', false) || DEFAULT_COS_PREFIX);
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const objectKey = `${prefix}/coscmd-local-test-${timestamp}.txt`;
  let tempDir = '';
  let uploaded = false;

  console.log('[CosUploadTest] starting local COS upload test');
  console.log(`[CosUploadTest] bucket=${bucket}, region=${region}, prefix=${prefix}`);
  console.log(`[CosUploadTest] secretId=${maskSecret(secretId)}`);
  if (endpoint) {
    console.log(`[CosUploadTest] endpoint=${endpoint}`);
  }

  try {
    const version = runCommand('checking coscmd version', 'coscmd', ['--version'], { capture: true }).trim();
    if (version) {
      console.log(`[CosUploadTest] ${version}`);
    }

    const configArgs = [
      'config',
      '-a', secretId,
      '-s', secretKey,
      '-b', bucket,
      '-r', region,
      '-m', '30',
    ];
    if (endpoint) {
      configArgs.push('-e', endpoint);
    }
    runCommand('configuring coscmd', 'coscmd', configArgs);

    const temp = await createTempFile(objectKey);
    tempDir = temp.tempDir;
    console.log(`[CosUploadTest] created local test file: ${temp.filePath}`);

    runCommand('uploading test object', 'coscmd', ['upload', temp.filePath, objectKey]);
    uploaded = true;

    runCommand('checking uploaded object', 'coscmd', ['info', objectKey]);

    if (publicBaseUrl) {
      console.log(`[CosUploadTest] test object URL: ${publicBaseUrl.replace(/\/+$/, '')}/${objectKey}`);
    }

    runCommand('deleting uploaded object', 'coscmd', ['delete', '-f', objectKey]);
    uploaded = false;

    console.log('[CosUploadTest] local COS upload test completed successfully');
  } catch (error) {
    if (uploaded) {
      try {
        runCommand('cleaning uploaded object after failure', 'coscmd', ['delete', '-f', objectKey]);
      } catch (cleanupError) {
        console.warn('[CosUploadTest] failed to delete uploaded object after failure:', cleanupError);
      }
    }
    throw error;
  } finally {
    await cleanupLocal(tempDir);
  }
}

main().catch(error => {
  console.error('[CosUploadTest] operation failed:', error);
  process.exitCode = 1;
});
