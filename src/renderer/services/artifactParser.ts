import { type Artifact, type ArtifactType, ArtifactTypeValue } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';

/**
 * Normalize file path for deduplication comparison.
 * Handles Windows file:// URL leading slash and backslash differences.
 */
export function normalizeFilePathForDedup(p: string): string {
  // Strip leading / before drive letter (e.g. /D:/path from file:///D:/path)
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  // Unify separators and case for comparison
  return p.replace(/\\/g, '/').toLowerCase();
}

const EXTENSION_TO_ARTIFACT_TYPE: Record<string, ArtifactType> = {
  '.html': 'html',
  '.htm': 'html',
  '.svg': 'svg',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.webp': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.m4v': 'video',
  '.avi': 'video',
  '.mkv': 'video',
  '.wmv': 'video',
  '.flv': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
  '.mermaid': 'mermaid',
  '.mmd': 'mermaid',
  '.jsx': 'code',
  '.tsx': 'code',
  '.css': 'code',
  '.md': 'markdown',
  '.txt': 'text',
  '.log': 'text',
  '.csv': 'document',
  '.tsv': 'document',
  '.xls': 'document',
  '.docx': 'document',
  '.xlsx': 'document',
  '.pptx': 'document',
  '.pdf': 'document',
};

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv', '.wmv', '.flv',
  '.mp3', '.wav', '.m4a',
]);
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf', '.csv', '.tsv', '.xls']);
const LOCAL_SERVICE_URL_RE = /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s<>"'`)\]]*)?/gi;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const LOCAL_SERVICE_TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？、]+$/;
const REMOTE_MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const REMOTE_IMAGE_URL_RE = /(?:^|[\s<("'`])(https?:\/\/[^\s<>"'`)]*\.(?:png|jpe?g|gif|webp|bmp|avif)(?:\?[^\s<>"'`)]*)?)(?:[\s>)"'`]|$)/gi;

export function getArtifactTypeFromExtension(ext: string): ArtifactType | null {
  return EXTENSION_TO_ARTIFACT_TYPE[ext.toLowerCase()] ?? null;
}

export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isMediaExtension(ext: string): boolean {
  return MEDIA_EXTENSIONS.has(ext.toLowerCase());
}

export function isBinaryDocumentExtension(ext: string): boolean {
  return BINARY_DOCUMENT_EXTENSIONS.has(ext.toLowerCase());
}

function trimLocalServiceUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  while (url.endsWith(')') && !url.includes('(')) {
    url = url.slice(0, -1);
  }
  while (url.endsWith(']') && !url.includes('[')) {
    url = url.slice(0, -1);
  }
  return url.replace(LOCAL_SERVICE_TRAILING_PUNCTUATION_RE, '');
}

export function normalizeLocalServiceUrlForDedup(url: string): string {
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    const pathname = parsed.pathname === '/' ? '/' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimLocalServiceUrl(url).toLowerCase();
  }
}

const getArtifactIdentityKeys = (artifact: Artifact): string[] => {
  const keys: string[] = [];
  if (artifact.filePath) {
    keys.push(`file:${artifact.type}:${normalizeFilePathForDedup(artifact.filePath)}`);
  }
  const remoteUrl = artifact.remoteUrl?.trim();
  if (remoteUrl) {
    keys.push(`url:${artifact.type}:${remoteUrl}`);
  }
  if ((artifact.type === ArtifactTypeValue.Image || artifact.type === ArtifactTypeValue.Video) && artifact.content?.trim()) {
    keys.push(`url:${artifact.type}:${artifact.content.trim()}`);
  }
  if (artifact.type === ArtifactTypeValue.LocalService) {
    const localServiceUrl = artifact.url?.trim() || artifact.content?.trim();
    if (localServiceUrl) {
      keys.push(`local-service:${normalizeLocalServiceUrlForDedup(localServiceUrl)}`);
    }
  }
  const fileName = artifact.fileName?.trim() || artifact.title?.trim();
  if (artifact.type === ArtifactTypeValue.Video && fileName) {
    keys.push(`name:${artifact.type}:${fileName.toLowerCase()}`);
  }
  return keys;
};

export const shouldPreferArtifactForDisplay = (
  candidate: Artifact,
  current: Artifact,
): boolean => {
  const currentHasFileProtocol = Boolean(current.filePath && /^file:/i.test(current.filePath));
  const candidateHasFileProtocol = Boolean(candidate.filePath && /^file:/i.test(candidate.filePath));
  if (current.filePath && !candidate.filePath) return false;
  if (!current.filePath && candidate.filePath) return true;
  if (currentHasFileProtocol && candidate.filePath && !candidateHasFileProtocol) return true;
  if (!currentHasFileProtocol && current.filePath && candidateHasFileProtocol) return false;
  if (!current.remoteUrl && candidate.remoteUrl) return true;
  if (!current.content && candidate.content) return true;
  if (candidate.createdAt !== current.createdAt) return candidate.createdAt > current.createdAt;
  return true;
};

export function dedupeArtifactsForDisplay(artifacts: Artifact[]): Artifact[] {
  const result: Artifact[] = [];
  const keyToIndex = new Map<string, number>();

  for (const artifact of artifacts) {
    const keys = getArtifactIdentityKeys(artifact);
    const existingIndex = keys
      .map(key => keyToIndex.get(key))
      .find((index): index is number => index !== undefined);

    if (existingIndex === undefined) {
      const nextIndex = result.length;
      result.push(artifact);
      for (const key of keys) {
        keyToIndex.set(key, nextIndex);
      }
      continue;
    }

    if (shouldPreferArtifactForDisplay(artifact, result[existingIndex])) {
      result[existingIndex] = artifact;
    }
    for (const key of keys) {
      keyToIndex.set(key, existingIndex);
    }
  }

  return result;
}

function isLocalServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    const isHttp = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    if (!isHttp) return false;

    return parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '[::1]' ||
      /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

function buildLocalServiceTitle(url: string, linkText?: string): string {
  const title = linkText?.trim();
  if (title && !/^https?:\/\//i.test(title)) {
    return title;
  }

  try {
    const parsed = new URL(url);
    const pathPart = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() ?? '');
    return pathPart || parsed.host;
  } catch {
    return url;
  }
}

export function parseLocalServiceUrlsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const seenUrls = new Set<string>();
  let index = 0;

  const addUrl = (rawUrl: string, linkText?: string) => {
    const url = trimLocalServiceUrl(rawUrl);
    if (!url || !isLocalServiceUrl(url)) return;

    const normalized = normalizeLocalServiceUrlForDedup(url);
    if (seenUrls.has(normalized)) return;
    seenUrls.add(normalized);

    artifacts.push({
      id: `artifact-local-service-${messageId}-${index}`,
      messageId,
      sessionId,
      type: ArtifactTypeValue.LocalService,
      title: buildLocalServiceTitle(url, linkText),
      content: url,
      url,
      createdAt: Date.now(),
    });
    index++;
  };

  const markdownRe = new RegExp(MARKDOWN_LINK_RE.source, 'gi');
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRe.exec(messageContent)) !== null) {
    addUrl(markdownMatch[2], markdownMatch[1]);
  }

  const urlRe = new RegExp(LOCAL_SERVICE_URL_RE.source, 'gi');
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRe.exec(messageContent)) !== null) {
    addUrl(urlMatch[0]);
  }

  return artifacts;
}

export const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^`\n]+?)`?\s*$/gim;

export function parseMediaTokensFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(MEDIA_TOKEN_RE.source, 'gim');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    let filePath = match[1].trim();
    if (!filePath) continue;

    if (filePath.startsWith('file:///')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.slice(7);
    }

    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `artifact-media-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: fileName,
      content: '',
      fileName,
      filePath,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

const FILE_LINK_RE = /\[([^\]]+)\]\(file:\/\/([^)]+)\)/g;

export function stripFileLinksFromText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(file:\/\/([^)]+)\)/g, '');
}

const BARE_FILE_PATH_RE = /(?:^|[\s"'`(])(\/?(?:[^\s"'`()\[\]]+\/)*[^\s"'`()\[\]]+\.(?:docx|xlsx|pptx|pdf|md|txt|log|csv|mp4|mov|webm|m4v|avi|mkv|wmv|flv|mp3|wav|m4a))(?:[\s"'`)]|$)/gmi;

export function parseFilePathsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
  idPrefix = 'artifact-path',
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(BARE_FILE_PATH_RE.source, 'gm');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    let filePath = match[1];

    if (filePath.startsWith('file:///')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.slice(7);
    } else if (filePath.startsWith('file:/')) {
      filePath = filePath.slice(5);
    }

    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }

    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `${idPrefix}-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: fileName,
      content: '',
      fileName,
      filePath,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

export function parseFileLinksFromMessage(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(FILE_LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const linkText = match[1];
    let filePath: string;
    try {
      filePath = decodeURIComponent(match[2]);
    } catch {
      filePath = match[2];
    }
    // Strip leading / before Windows drive letter (e.g. /D:/path from file:///D:/path)
    if (/^\/[A-Za-z]:/.test(filePath)) {
      filePath = filePath.slice(1);
    }
    const ext = getFileExtension(filePath);
    const artifactType = getArtifactTypeFromExtension(ext);
    if (!artifactType) continue;

    const fileName = getFileName(filePath);

    artifacts.push({
      id: `artifact-link-${messageId}-${index}`,
      messageId,
      sessionId,
      type: artifactType,
      title: linkText || fileName,
      content: '',
      fileName,
      filePath,
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

export function parseRemoteImageArtifactsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
  idPrefix = 'artifact-remote-image',
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const seen = new Set<string>();
  let index = 0;

  const pushImage = (url: string, title?: string) => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl || seen.has(trimmedUrl)) return;
    seen.add(trimmedUrl);
    const displayIndex = index + 1;
    artifacts.push({
      id: `${idPrefix}-${messageId}-${index}`,
      messageId,
      sessionId,
      type: ArtifactTypeValue.Image,
      title: title?.trim() || `Generated image ${displayIndex}`,
      content: trimmedUrl,
      fileName: title?.trim() || `generated-image-${displayIndex}`,
      remoteUrl: trimmedUrl,
      source: 'tool',
      createdAt: Date.now(),
    });
    index += 1;
  };

  const markdownRe = new RegExp(REMOTE_MARKDOWN_IMAGE_RE.source, 'g');
  let markdownMatch: RegExpExecArray | null;
  while ((markdownMatch = markdownRe.exec(messageContent)) !== null) {
    pushImage(markdownMatch[2], markdownMatch[1]);
  }

  const bareUrlRe = new RegExp(REMOTE_IMAGE_URL_RE.source, 'gi');
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = bareUrlRe.exec(messageContent)) !== null) {
    pushImage(urlMatch[1]);
  }

  return artifacts;
}

export function parseToolResultMediaArtifacts(
  toolResultMsg: CoworkMessage | undefined,
  sessionId: string,
): Artifact[] {
  if (!toolResultMsg?.metadata || toolResultMsg.metadata.isError) return [];

  const details = toolResultMsg.metadata.toolResultDetails;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return [];

  const assets = (details as Record<string, unknown>).assets;
  if (!Array.isArray(assets)) return [];

  const artifacts: Artifact[] = [];
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) continue;
    const item = asset as Record<string, unknown>;
    if (item.type !== 'image' && item.type !== 'video') continue;
    const artifactType: ArtifactType = item.type === 'video'
      ? ArtifactTypeValue.Video
      : ArtifactTypeValue.Image;

    const url = typeof item.url === 'string' && item.url.trim()
      ? item.url.trim()
      : '';
    const filePath = typeof item.filePath === 'string' && item.filePath.trim()
      ? item.filePath.trim()
      : typeof item.localPath === 'string' && item.localPath.trim()
        ? item.localPath.trim()
        : '';
    if (artifactType === ArtifactTypeValue.Video && !filePath) continue;
    if (!url && !filePath) continue;

    const filename = typeof item.filename === 'string' && item.filename.trim()
      ? item.filename.trim()
      : filePath
        ? getFileName(filePath)
        : `generated-${artifactType}-${index + 1}`;

    artifacts.push({
      id: `artifact-media-${toolResultMsg.id}-${index}`,
      messageId: toolResultMsg.id,
      sessionId,
      type: artifactType,
      title: filename,
      content: filePath ? '' : url,
      fileName: filename,
      ...(filePath ? { filePath } : {}),
      ...(url ? { remoteUrl: url } : {}),
      source: 'tool',
      createdAt: toolResultMsg.timestamp || Date.now(),
    });
  }

  return artifacts;
}

const IMAGE_GEN_TOOL_NAMES_FOR_PATH_DETECTION = new Set([
  'image_generate',
  'lobsterai_image_generate',
]);

export function shouldParseFilePathsFromToolResult(toolName: string | undefined | null): boolean {
  if (!toolName) return false;
  return IMAGE_GEN_TOOL_NAMES_FOR_PATH_DETECTION.has(toolName.toLowerCase());
}

const WRITE_TOOL_NAMES = new Set(['write', 'writefile', 'write_file']);

function normalizeToolName(name: string): string {
  return name.toLowerCase().replace(/[_\s]/g, '');
}

function extractFilePath(toolInput: Record<string, unknown>): string | null {
  for (const key of ['file_path', 'path', 'filePath', 'target_file', 'targetFile']) {
    const val = toolInput[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return null;
}

function getFileExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function getFileName(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return lastSlash === -1 ? filePath : filePath.slice(lastSlash + 1);
}

export function parseToolArtifact(
  toolUseMsg: CoworkMessage,
  toolResultMsg: CoworkMessage | undefined,
  sessionId: string,
): Artifact | null {
  const toolName = toolUseMsg.metadata?.toolName;
  if (!toolName || !WRITE_TOOL_NAMES.has(normalizeToolName(toolName))) {
    return null;
  }

  if (toolResultMsg?.metadata?.isError) {
    return null;
  }

  const toolInput = toolUseMsg.metadata?.toolInput as Record<string, unknown> | undefined;
  if (!toolInput) return null;

  const filePath = extractFilePath(toolInput);
  if (!filePath) return null;

  const ext = getFileExtension(filePath);
  const artifactType = getArtifactTypeFromExtension(ext);
  if (!artifactType) return null;

  const fileName = getFileName(filePath);
  const isImage = isImageExtension(ext);
  const isBinaryDoc = isBinaryDocumentExtension(ext);
  const isMedia = isMediaExtension(ext);
  const content = (isImage || isBinaryDoc || isMedia) ? '' : (typeof toolInput.content === 'string' ? toolInput.content : '');

  return {
    id: `artifact-tool-${toolUseMsg.id}`,
    messageId: toolUseMsg.id,
    sessionId,
    type: artifactType,
    title: fileName,
    content,
    fileName,
    filePath,
    createdAt: toolUseMsg.timestamp || Date.now(),
  };
}
