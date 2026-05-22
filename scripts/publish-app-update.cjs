#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DEFAULT_BASE_URL = 'https://wwwtest.popi.art';
const DEFAULT_PRODUCT = 'popiai';
const DEFAULT_CHANNEL = 'prod';
const SUCCESS_STATUS = '0000';

function printHelp() {
  console.log(`Usage:
  node scripts/publish-app-update.cjs upload --file <path> --platform <platform> [--version <version>] [--channel <channel>] [--product <product>] [--signed <true|false>]
  node scripts/publish-app-update.cjs update --tag <tag> [--version <version>] [--date <yyyy-mm-dd>] [--channel <channel>] [--product <product>]
  node scripts/publish-app-update.cjs upload-and-update --file <path> --platform <platform> --tag <tag> [--version <version>] [--date <yyyy-mm-dd>] [--channel <channel>] [--product <product>] [--signed <true|false>]

Environment:
  APP_UPDATE_API_TOKEN      Required bearer token for write APIs.
  APP_UPDATE_API_BASE_URL   Optional base URL. Defaults to https://wwwtest.popi.art

Tag annotation format:
  First non-empty line is treated as the default title.
  Use [zh] and [en] sections for localized changelog entries.

Example:
  Popiai 2026.5.20

  [zh]
  - 修复若干问题
  - 优化更新流程

  [en]
  - Fixed several issues
  - Improved update flow
`);
}

function parseArgs(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help', options: {} };
  }

  const [command, ...rest] = argv;
  const options = {};

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = 'true';
      continue;
    }
    options[key] = next;
    index += 1;
  }

  return { command, options };
}

function requireOption(options, key, command) {
  const value = options[key];
  if (!value) {
    throw new Error(`Missing required option "--${key}" for "${command}"`);
  }
  return value;
}

function coerceBoolean(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return Boolean(value);
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function getBaseUrl() {
  return (process.env.APP_UPDATE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getAuthHeaders(contentType) {
  const token = (process.env.APP_UPDATE_API_TOKEN || '').trim();
  if (!token) {
    throw new Error('APP_UPDATE_API_TOKEN is required');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
  };

  if (contentType) {
    headers['Content-Type'] = contentType;
  }

  return headers;
}

function versionFromTag(tag) {
  return tag.replace(/^v/, '').trim();
}

function resolveVersion(options) {
  if (options.version) return options.version.trim();
  if (options.tag) return versionFromTag(options.tag);
  throw new Error('Either --version or --tag is required');
}

function resolveDate(options) {
  if (options.date) return options.date.trim();
  return new Date().toISOString().slice(0, 10);
}

function normalizeBullet(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s+/, '').trim();
}

function parseTagAnnotation(rawText, version) {
  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const firstNonEmpty = lines.find(line => line.trim());
  const defaultTitle = firstNonEmpty ? firstNonEmpty.trim() : `Popiai ${version}`;
  const defaultBody = [];
  const sections = {
    zh: { title: '', content: [] },
    en: { title: '', content: [] },
  };

  let currentSection = null;
  let beforeSections = true;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const sectionMatch = trimmed.match(/^(?:\[(zh|en)\]|##\s*(zh|en)|(zh|en):)$/i);
    if (sectionMatch) {
      currentSection = (sectionMatch[1] || sectionMatch[2] || sectionMatch[3]).toLowerCase();
      beforeSections = false;
      continue;
    }

    if (beforeSections) {
      if (trimmed !== defaultTitle) {
        defaultBody.push(normalizeBullet(trimmed) || trimmed);
      }
      continue;
    }

    if (!currentSection) continue;

    const section = sections[currentSection];
    const normalizedBullet = normalizeBullet(trimmed);
    if (!section.title && !trimmed.startsWith('-') && !trimmed.startsWith('*') && !/^\d+\./.test(trimmed)) {
      section.title = trimmed;
      continue;
    }
    section.content.push(normalizedBullet || trimmed);
  }

  const fallbackContent = defaultBody.filter(Boolean);

  return {
    ch: {
      title: sections.zh.title || defaultTitle,
      content: sections.zh.content.length > 0 ? sections.zh.content : fallbackContent,
    },
    en: {
      title: sections.en.title || defaultTitle,
      content: sections.en.content.length > 0 ? sections.en.content : fallbackContent,
    },
  };
}

function readTagAnnotation(tag) {
  try {
    return execFileSync('git', ['tag', '-l', '--format=%(contents)', tag], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error(`Failed to read tag annotation for ${tag}: ${error.message}`);
  }
}

async function ensureOkResponse(response, action) {
  const text = await response.text();
  let payload;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${action} failed: server returned non-JSON response (${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`${action} failed: HTTP ${response.status} ${payload.message || ''}`.trim());
  }

  if (payload.status !== SUCCESS_STATUS) {
    throw new Error(`${action} failed: ${payload.message || `status=${payload.status || 'unknown'}`}`);
  }

  return payload;
}

async function uploadInstaller(options) {
  const filePath = path.resolve(requireOption(options, 'file', 'upload'));
  const platform = requireOption(options, 'platform', 'upload').trim();
  const product = (options.product || DEFAULT_PRODUCT).trim();
  const channel = (options.channel || DEFAULT_CHANNEL).trim();
  const version = resolveVersion(options);
  const signed = coerceBoolean(options.signed, true);

  await fs.promises.access(filePath, fs.constants.R_OK);

  const fileBlob = await fs.openAsBlob(filePath);
  const form = new FormData();
  form.append('file', fileBlob, path.basename(filePath));
  form.append('product', product);
  form.append('version', version);
  form.append('platform', platform);
  form.append('channel', channel);
  form.append('signed', String(signed));

  console.log(`[AppUpdatePublish] uploading installer: ${path.basename(filePath)} (${platform}, ${version})`);

  const response = await fetch(`${getBaseUrl()}/api_client/app/create`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: form,
  });

  const payload = await ensureOkResponse(response, 'Installer upload');
  console.log(`[AppUpdatePublish] installer upload succeeded for ${platform}`);
  return payload;
}

async function updateMetadata(options) {
  const tag = requireOption(options, 'tag', 'update').trim();
  const product = (options.product || DEFAULT_PRODUCT).trim();
  const channel = (options.channel || DEFAULT_CHANNEL).trim();
  const version = resolveVersion(options);
  const date = resolveDate(options);
  const annotation = readTagAnnotation(tag);
  const changeLog = parseTagAnnotation(annotation, version);

  console.log(`[AppUpdatePublish] publishing metadata for ${version} on channel ${channel}`);

  const response = await fetch(`${getBaseUrl()}/api_client/app/update`, {
    method: 'POST',
    headers: getAuthHeaders('application/json'),
    body: JSON.stringify({
      product,
      channel,
      version,
      date,
      changeLog,
    }),
  });

  const payload = await ensureOkResponse(response, 'Metadata publish');
  console.log(`[AppUpdatePublish] metadata publish succeeded for ${version}`);
  return payload;
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === 'help') {
    printHelp();
    return;
  }

  if (command === 'upload') {
    await uploadInstaller(options);
    return;
  }

  if (command === 'update') {
    await updateMetadata(options);
    return;
  }

  if (command === 'upload-and-update') {
    await uploadInstaller(options);
    await updateMetadata(options);
    return;
  }

  throw new Error(`Unsupported command: ${command}`);
}

main().catch(error => {
  console.error('[AppUpdatePublish] operation failed:', error);
  process.exitCode = 1;
});
