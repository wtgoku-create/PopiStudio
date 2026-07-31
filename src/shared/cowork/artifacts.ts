export const ArtifactTypeValue = {
  Html: 'html',
  Svg: 'svg',
  Image: 'image',
  Video: 'video',
  Audio: 'audio',
  Mermaid: 'mermaid',
  Code: 'code',
  Markdown: 'markdown',
  Text: 'text',
  Wiki: 'wiki',
  Document: 'document',
  LocalService: 'local-service',
} as const;
export type ArtifactType = typeof ArtifactTypeValue[keyof typeof ArtifactTypeValue];

export const PREVIEWABLE_ARTIFACT_TYPES = new Set<ArtifactType>([
  ArtifactTypeValue.Html,
  ArtifactTypeValue.Svg,
  ArtifactTypeValue.Mermaid,
  ArtifactTypeValue.Image,
  ArtifactTypeValue.Video,
  ArtifactTypeValue.Audio,
  ArtifactTypeValue.Markdown,
  ArtifactTypeValue.Text,
  ArtifactTypeValue.Wiki,
  ArtifactTypeValue.Document,
  ArtifactTypeValue.LocalService,
]);

export const ArtifactPreviewStatus = {
  Loading: 'loading',
  Ready: 'ready',
  Missing: 'missing',
  TooLarge: 'tooLarge',
  Unreadable: 'unreadable',
} as const;
export type ArtifactPreviewStatus = typeof ArtifactPreviewStatus[keyof typeof ArtifactPreviewStatus];

export interface LocalServiceProjectCandidate {
  directory: string;
  source: 'text-labeled-path' | 'text-cd-command' | 'text-file-link' | 'text-common-parent';
  confidence: number;
  reason?: string;
  evidence?: string;
  messageId?: string;
  detectedAt: number;
}

export interface Artifact {
  id: string;
  messageId: string;
  sessionId: string;
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fileName?: string;
  filePath?: string;
  url?: string;
  remoteUrl?: string;
  source?: 'tool' | 'message' | 'manual';
  localService?: {
    url: string;
    origin: string;
    projectDirectory?: string;
    projectCandidates?: LocalServiceProjectCandidate[];
  };
  contentVersion?: number;
  metadata?: Record<string, unknown>;
  preview?: {
    status: ArtifactPreviewStatus;
    error?: string;
    size?: number;
    mtimeMs?: number;
    readBytes?: number;
    truncated?: boolean;
  };
  createdAt: number;
}

export interface ArtifactMarker {
  type: ArtifactType;
  title: string;
  content: string;
  language?: string;
  fullMatch: string;
}

export interface ArtifactMessage {
  id: string;
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system';
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export function normalizeArtifactFilePath(filePath: string): string {
  let normalized = filePath.trim();
  const mediaMatch = normalized.match(/(?:^|[\\/])MEDIA:\s*(.+)$/i);
  if (mediaMatch) {
    normalized = mediaMatch[1].trim();
  } else {
    normalized = normalized.replace(/^MEDIA:\s*/i, '').trim();
  }
  if (normalized.startsWith('file:///')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file://')) {
    normalized = normalized.slice(7);
  } else if (normalized.startsWith('file:/')) {
    normalized = normalized.slice(5);
  } else if (normalized.startsWith('localfile:///')) {
    normalized = normalized.slice(12);
  } else if (normalized.startsWith('localfile://')) {
    normalized = normalized.slice(12);
  }
  const queryIndex = normalized.search(/[?#]/);
  if (queryIndex >= 0) {
    normalized = normalized.slice(0, queryIndex);
  }
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep literal percent signs as-is.
  }
  if (/^\/[A-Za-z]:/.test(normalized)) normalized = normalized.slice(1);
  return normalized;
}

export function normalizeFilePathForDedup(p: string): string {
  const normalized = normalizeArtifactFilePath(p);
  return normalized.replace(/\\/g, '/').toLowerCase();
}

export function toAbsoluteArtifactPath(filePath: string, cwd?: string): string {
  const rawPath = normalizeArtifactFilePath(filePath);
  if (rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath) || rawPath.startsWith('~')) {
    return rawPath;
  }
  const base = cwd?.trim().replace(/[\\/]+$/, '');
  if (!base) return rawPath;
  return `${base}/${rawPath.replace(/^\.\//, '')}`;
}

const IGNORED_ARTIFACT_DIRECTORY_NAMES = new Set(['node_modules']);

export function isIgnoredArtifactPath(filePath: string): boolean {
  const normalized = normalizeArtifactFilePath(filePath).replace(/\\/g, '/');
  const segments = normalized
    .split('/')
    .filter(segment => segment && segment !== '.' && segment !== '..' && segment !== '~');
  return segments.some(segment => {
    const lower = segment.toLowerCase();
    return lower.startsWith('.') || IGNORED_ARTIFACT_DIRECTORY_NAMES.has(lower);
  });
}

export function normalizeProjectDirectoryForDedup(projectDirectory: string): string {
  let normalized = projectDirectory.trim().replace(/\\/g, '/');
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLowerCase();
}

export function isPathInsideDirectory(filePath: string, directory: string): boolean {
  const file = normalizeFilePathForDedup(filePath);
  const dir = normalizeProjectDirectoryForDedup(directory);
  if (!file || !dir) return false;
  if (file === dir) return true;
  const prefix = dir.endsWith('/') ? dir : `${dir}/`;
  return file.startsWith(prefix);
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
  '.bmp': 'image',
  '.avif': 'image',
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

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif']);
const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv', '.wmv', '.flv',
  '.mp3', '.wav', '.m4a',
]);
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf', '.csv', '.tsv', '.xls']);
const LOCAL_SERVICE_URL_RE = /\bhttps?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s<>"'`)\]]*)?/gi;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
const LOCAL_SERVICE_TRAILING_PUNCTUATION_RE = /[.,;:!?，。；：！？、]+$/;
const PROJECT_DIRECTORY_LABEL_RE = /(?:项目目录|项目路径|工程目录|工作目录|project\s+directory|project\s+path|working\s+directory)\s*[:：]\s*([^\n]+)|(?:项目位置|项目位于)\s*(?:[:：]|为|是|在)?\s*([^\n]+)/gi;
const CD_COMMAND_RE = /(?:^|\n)\s*(?:[$>]\s*)?cd(?:\s+\/d)?\s+(?:"([^"]+)"|'([^']+)'|`([^`]+)`|([^\n;&|]+))/gi;
const FILE_LIKE_PATH_EXTENSION_RE = /\.[A-Za-z0-9]{1,12}$/;
const REMOTE_MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
const REMOTE_IMAGE_URL_RE = /(?:^|[\s<("'`])(https?:\/\/[^\s<>"'`)]*\.(?:png|jpe?g|gif|webp|bmp|avif)(?:\?[^\s<>"'`)]*)?)(?:[\s>)"'`]|$)/gi;
export const MEDIA_TOKEN_RE = /\bMEDIA:\s*`?([^`\n]+?)`?\s*$/gim;
const ANY_MARKDOWN_LINK_RE = /\[([^\]]*)\]\(([^)]+)\)/g;
const BARE_FILE_PATH_RE = /(?:^|[\s"'`(])((?:\/|[A-Za-z]:[\\/])?(?:[^\s"'`()\[\]\\/]+[\\/]+)+[^\s"'`()\[\]\\/]+\.(?:png|jpe?g|gif|webp|bmp|avif|mp4|webm|mov|m4v|avi|mkv|wmv|flv|mp3|wav|m4a|docx|xlsx|pptx|pdf|md|txt|log|csv|html?|svg))(?:[\s"'`)]|$)/gmi;

function getRemoteImageFileName(url: string, fallbackIndex: number): string {
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/, 1)[0] || '';
  }

  const rawFileName = pathname.split('/').filter(Boolean).pop() || '';
  const decodedFileName = (() => {
    try {
      return decodeURIComponent(rawFileName);
    } catch {
      return rawFileName;
    }
  })().trim();
  if (decodedFileName && getFileExtension(decodedFileName)) {
    return decodedFileName;
  }

  let hash = 0;
  for (let index = 0; index < url.length; index += 1) {
    hash = ((hash << 5) - hash + url.charCodeAt(index)) | 0;
  }
  const stableSuffix = Math.abs(hash).toString(36).slice(0, 6) || String(fallbackIndex);
  return `remote-image-${stableSuffix}.png`;
}

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

function decodeProjectDirectoryFileUrl(value: string): string {
  const trimmed = value.trim();
  if (!/^file:/i.test(trimmed)) return '';
  try {
    const parsed = new URL(trimmed);
    let pathname = decodeURIComponent(parsed.pathname);
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return pathname;
  } catch {
    return '';
  }
}

function cleanProjectDirectoryCandidate(value: string): string {
  let candidate = value.trim();
  const markdownLinkMatch = candidate.match(/^\[\s*`?([^`\]\n]+?)`?\s*\]\(([^)\n]+)\)/);
  if (markdownLinkMatch) {
    const linkText = markdownLinkMatch[1].trim();
    const hrefPath = decodeProjectDirectoryFileUrl(markdownLinkMatch[2]);
    candidate = isAbsoluteProjectDirectoryCandidate(linkText) || linkText.includes('/') || linkText.includes('\\')
      ? linkText
      : hrefPath || linkText;
  }

  return candidate
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/[，。；;,.]+$/g, '')
    .trim();
}

function isAbsoluteProjectDirectoryCandidate(value: string): boolean {
  return /^\/[^/]/.test(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\/.test(value) ||
    /^~\//.test(value);
}

function isPlausibleProjectDirectoryCandidate(value: string): boolean {
  if (!value) return false;
  if (/^[`[\](){}<>]+$/.test(value)) return false;
  return isAbsoluteProjectDirectoryCandidate(value) ||
    value.includes('/') ||
    value.includes('\\') ||
    /^[\w.-]+$/.test(value);
}

function resolveRelativeProjectDirectory(candidate: string, baseDirectory?: string): string {
  const base = baseDirectory?.trim();
  if (!base || isAbsoluteProjectDirectoryCandidate(candidate)) return candidate;
  if (!candidate || candidate.startsWith('$')) return candidate;

  const separator = base.includes('\\') && !base.includes('/') ? '\\' : '/';
  const normalizedBase = base.replace(/[\\/]+$/g, '');
  const combined = `${normalizedBase}${separator}${candidate}`;
  const parts = combined.replace(/\\/g, '/').split('/');
  const resolvedParts: string[] = [];
  const prefix = combined.startsWith('/') ? '/' : '';

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  return `${prefix}${resolvedParts.join('/')}`;
}

function pathDirectoryName(value: string): string {
  let normalized = value.trim().replace(/\\/g, '/');
  while (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  const separatorIndex = normalized.lastIndexOf('/');
  if (separatorIndex <= 0) return normalized;
  return normalized.slice(0, separatorIndex);
}

function fileUrlPathToDirectory(value: string, linkText?: string): string {
  const decoded = decodeProjectDirectoryFileUrl(value);
  if (!decoded) return '';
  const link = linkText?.trim() || '';
  if (decoded.endsWith('/') || link.endsWith('/')) {
    return decoded.replace(/[\\/]+$/g, '');
  }
  const lastSegment = decoded.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  const linkLastSegment = link.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  const targetLooksLikeFile = FILE_LIKE_PATH_EXTENSION_RE.test(lastSegment) ||
    (linkLastSegment && FILE_LIKE_PATH_EXTENSION_RE.test(linkLastSegment));
  return targetLooksLikeFile ? pathDirectoryName(decoded) : decoded.replace(/[\\/]+$/g, '');
}

function collectProjectDirectoryCandidatesFromText(
  messageContent: string,
  baseDirectory?: string,
  messageId?: string,
): LocalServiceProjectCandidate[] {
  const candidates: LocalServiceProjectCandidate[] = [];
  const addCandidate = (
    raw: string,
    source: LocalServiceProjectCandidate['source'],
    confidence: number,
    evidence?: string,
    reason?: string,
  ) => {
    const cleaned = cleanProjectDirectoryCandidate(raw);
    if (!isPlausibleProjectDirectoryCandidate(cleaned)) return;
    candidates.push({
      directory: resolveRelativeProjectDirectory(cleaned, baseDirectory),
      source,
      confidence,
      evidence,
      reason,
      messageId,
      detectedAt: Date.now(),
    });
  };

  const labelRe = new RegExp(PROJECT_DIRECTORY_LABEL_RE.source, 'gi');
  let labelMatch: RegExpExecArray | null;
  while ((labelMatch = labelRe.exec(messageContent)) !== null) {
    addCandidate(labelMatch[1] || labelMatch[2] || '', 'text-labeled-path', 85, labelMatch[0], 'labeled project directory');
  }

  const cdRe = new RegExp(CD_COMMAND_RE.source, 'gi');
  let cdMatch: RegExpExecArray | null;
  while ((cdMatch = cdRe.exec(messageContent)) !== null) {
    addCandidate(cdMatch[1] || cdMatch[2] || cdMatch[3] || cdMatch[4] || '', 'text-cd-command', 80, cdMatch[0], 'cd command');
  }

  const fileLinkRe = /\[([^\]]*)\]\((file:\/\/[^)\s]+)\)/gi;
  let fileLinkMatch: RegExpExecArray | null;
  while ((fileLinkMatch = fileLinkRe.exec(messageContent)) !== null) {
    const directory = fileUrlPathToDirectory(fileLinkMatch[2], fileLinkMatch[1]);
    if (directory) addCandidate(directory, 'text-file-link', 70, fileLinkMatch[0], 'file link directory');
  }

  return candidates;
}

function selectBestProjectDirectoryCandidate(
  candidates: LocalServiceProjectCandidate[],
): LocalServiceProjectCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return right.detectedAt - left.detectedAt;
  })[0];
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

export function normalizeLocalServiceOrigin(url: string): string {
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    return parsed.origin.toLowerCase();
  } catch {
    return trimLocalServiceUrl(url).replace(/\/+$/, '').toLowerCase();
  }
}

export function getLocalServicePortIdentityKey(url?: string): string {
  if (!url?.trim()) return '';
  try {
    const parsed = new URL(trimLocalServiceUrl(url));
    const port = parsed.port ||
      (parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '');
    return port ? `local-service-port:${port}` : `local-service:${normalizeLocalServiceUrlForDedup(url)}`;
  } catch {
    return `local-service:${normalizeLocalServiceUrlForDedup(url)}`;
  }
}

interface DedupeArtifactsOptions {
  defaultProjectDirectory?: string;
}

export const getArtifactIdentityKeys = (artifact: Artifact): string[] => {
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
      keys.push(getLocalServicePortIdentityKey(localServiceUrl));
    }
  }
  const fileName = artifact.fileName?.trim() || artifact.title?.trim();
  if (artifact.type === ArtifactTypeValue.Video && fileName) {
    keys.push(`name:${artifact.type}:${fileName.toLowerCase()}`);
  }
  return keys;
};

export function getArtifactStorageIdentity(artifact: Artifact): string {
  const keys = getArtifactIdentityKeys(artifact);
  return keys[0] || `artifact:${artifact.type}:${artifact.id}`;
}

function getLocalServiceProjectConfidence(
  artifact: Artifact,
  options: DedupeArtifactsOptions = {},
): number {
  if (artifact.type !== ArtifactTypeValue.LocalService) return 0;
  const projectDirectory = artifact.localService?.projectDirectory?.trim();
  if (!projectDirectory) return 0;

  const defaultProjectDirectory = options.defaultProjectDirectory?.trim()
    ? normalizeProjectDirectoryForDedup(options.defaultProjectDirectory)
    : '';
  const normalizedProjectDirectory = normalizeProjectDirectoryForDedup(projectDirectory);
  return defaultProjectDirectory && normalizedProjectDirectory === defaultProjectDirectory ? 0 : 1;
}

export const shouldPreferArtifactForDisplay = (
  candidate: Artifact,
  current: Artifact,
  options: DedupeArtifactsOptions = {},
): boolean => {
  if (
    candidate.type === ArtifactTypeValue.LocalService &&
    current.type === ArtifactTypeValue.LocalService
  ) {
    const candidateProjectConfidence = getLocalServiceProjectConfidence(candidate, options);
    const currentProjectConfidence = getLocalServiceProjectConfidence(current, options);
    if (candidateProjectConfidence !== currentProjectConfidence) {
      return candidateProjectConfidence > currentProjectConfidence;
    }
  }

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

export function dedupeArtifactsForDisplay(
  artifacts: Artifact[],
  options: DedupeArtifactsOptions = {},
): Artifact[] {
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

    if (shouldPreferArtifactForDisplay(artifact, result[existingIndex], options)) {
      result[existingIndex] = artifact;
    }
    for (const key of keys) {
      keyToIndex.set(key, existingIndex);
    }
  }

  return result;
}

export function resolveArtifactIdForDisplay(
  artifacts: Artifact[],
  artifactId: string,
  options: DedupeArtifactsOptions = {},
): string {
  const target = artifacts.find(artifact => artifact.id === artifactId);
  if (!target) return artifactId;

  const displayArtifacts = dedupeArtifactsForDisplay(artifacts, options);
  if (displayArtifacts.some(artifact => artifact.id === artifactId)) {
    return artifactId;
  }

  const targetKeys = new Set(getArtifactIdentityKeys(target));
  if (targetKeys.size === 0) return artifactId;

  const displayArtifact = displayArtifacts.find(artifact =>
    getArtifactIdentityKeys(artifact).some(key => targetKeys.has(key))
  );

  return displayArtifact?.id ?? artifactId;
}

export function dedupeArtifactsWithinMessages(artifacts: Artifact[]): Artifact[] {
  const result: Artifact[] = [];
  const keyToIndex = new Map<string, number>();

  for (const artifact of artifacts) {
    const keys = getArtifactIdentityKeys(artifact).map(key => `${artifact.messageId}:${key}`);
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

export function hasToolResultMediaAssets(toolResultMsg: ArtifactMessage | undefined): boolean {
  if (!toolResultMsg?.metadata || toolResultMsg.metadata.isError) return false;

  const details = toolResultMsg.metadata.toolResultDetails;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return false;

  const assets = (details as Record<string, unknown>).assets;
  if (!Array.isArray(assets)) return false;

  return assets.some(asset => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) return false;
    const item = asset as Record<string, unknown>;
    if (item.type !== ArtifactTypeValue.Image && item.type !== ArtifactTypeValue.Video) return false;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const filePath = typeof item.filePath === 'string' ? item.filePath.trim() : '';
    const localPath = typeof item.localPath === 'string' ? item.localPath.trim() : '';
    if (item.type === ArtifactTypeValue.Video) {
      return Boolean(filePath || localPath);
    }
    return Boolean(url || filePath || localPath);
  });
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
  context?: { projectDirectory?: string },
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const seenUrls = new Set<string>();
  const projectCandidates = collectProjectDirectoryCandidatesFromText(
    messageContent,
    context?.projectDirectory,
    messageId,
  );
  const projectDirectory = selectBestProjectDirectoryCandidate(projectCandidates)?.directory || '';
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
      localService: {
        url,
        origin: normalizeLocalServiceOrigin(url),
        ...(projectDirectory
          ? { projectDirectory }
          : {}),
        ...(projectCandidates.length > 0
          ? { projectCandidates }
          : {}),
      },
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

export function stripFileLinksFromText(text: string): string {
  return text.replace(/\[([^\]]+)\]\(file:\/\/([^)]+)\)/g, '');
}

function resolveLocalHrefPath(rawHref: string): string | null {
  let href = rawHref.trim();
  if (href.startsWith('<') && href.endsWith('>')) {
    href = href.slice(1, -1).trim();
  }
  if (!href || href.startsWith('#') || href.startsWith('//')) return null;
  if (/^(?:file|localfile):/i.test(href)) {
    return normalizeArtifactFilePath(href) || null;
  }

  const isWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(href);
  if (!isWindowsAbsolute && /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;

  const candidate = normalizeArtifactFilePath(href);
  if (!candidate) return null;
  const isPosixAbsolute = candidate.startsWith('/');
  const isHomePath = candidate === '~' || candidate.startsWith('~/') || candidate.startsWith('~\\');
  const hasSeparator = candidate.includes('/') || candidate.includes('\\');
  if (isPosixAbsolute || isWindowsAbsolute || isHomePath || hasSeparator) {
    return candidate;
  }
  return null;
}

export function parseFilePathsFromText(
  messageContent: string,
  messageId: string,
  sessionId: string,
  idPrefix = 'artifact-path',
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = new RegExp(BARE_FILE_PATH_RE.source, 'gmi');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const rawMatch = match[1];
    if (/:\/\//.test(rawMatch) && !/^file:/i.test(rawMatch.trim())) continue;

    const filePath = normalizeArtifactFilePath(rawMatch);

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
  const re = new RegExp(ANY_MARKDOWN_LINK_RE.source, 'g');
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const linkText = match[1];
    const filePath = resolveLocalHrefPath(match[2]);
    if (!filePath) continue;
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
    const explicitTitle = title?.trim();
    const fallbackFileName = getRemoteImageFileName(trimmedUrl, displayIndex);
    artifacts.push({
      id: `${idPrefix}-${messageId}-${index}`,
      messageId,
      sessionId,
      type: ArtifactTypeValue.Image,
      title: explicitTitle || fallbackFileName,
      content: trimmedUrl,
      fileName: explicitTitle || fallbackFileName,
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
  toolResultMsg: ArtifactMessage | undefined,
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
      ? normalizeArtifactFilePath(item.filePath)
      : typeof item.localPath === 'string' && item.localPath.trim()
        ? normalizeArtifactFilePath(item.localPath)
        : '';
    if (artifactType === ArtifactTypeValue.Video && !filePath) continue;
    if (!url && !filePath) continue;

    const remoteFileName = artifactType === ArtifactTypeValue.Image && url
      ? getRemoteImageFileName(url, index + 1)
      : '';
    let filename = typeof item.filename === 'string' ? item.filename.trim() : '';
    if (!filename) {
      filename = remoteFileName || (filePath ? getFileName(filePath) : `generated-${artifactType}-${index + 1}`);
    }

    artifacts.push({
      id: `artifact-media-${toolResultMsg.id}-${index}`,
      messageId: toolResultMsg.id,
      sessionId,
      type: artifactType,
      title: filename,
      content: filePath ? '' : url,
      fileName: filename,
      ...(filePath ? { filePath } : {}),
      ...(filePath && url ? { remoteUrl: url } : {}),
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

const WRITE_TOOL_NAMES = new Set([
  'write',
  'writefile',
  'write_file',
  'edit',
  'editfile',
  'multiedit',
  'createfile',
]);

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
  toolUseMsg: ArtifactMessage,
  toolResultMsg: ArtifactMessage | undefined,
  sessionId: string,
): Artifact | null {
  const toolName = toolUseMsg.metadata?.toolName;
  if (typeof toolName !== 'string' || !WRITE_TOOL_NAMES.has(normalizeToolName(toolName))) {
    return null;
  }

  if (toolResultMsg?.metadata?.isError) {
    return null;
  }

  const toolInput = toolUseMsg.metadata?.toolInput as Record<string, unknown> | undefined;
  if (!toolInput) return null;

  const rawFilePath = extractFilePath(toolInput);
  const filePath = rawFilePath ? normalizeArtifactFilePath(rawFilePath) : null;
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

export function collectSessionArtifacts(
  messages: ArtifactMessage[],
  sessionId: string,
  cwd?: string,
): Artifact[] {
  const detected: Artifact[] = [];

  const absolutize = (artifact: Artifact): Artifact =>
    artifact.filePath
      ? { ...artifact, filePath: toAbsoluteArtifactPath(artifact.filePath, cwd) }
      : artifact;

  const pushFileArtifactIfNew = (artifact: Artifact, seenFilePaths: Set<string>) => {
    const normalized = artifact.filePath ? normalizeFilePathForDedup(artifact.filePath) : '';
    if (!artifact.filePath || seenFilePaths.has(normalized)) return;
    seenFilePaths.add(normalized);
    detected.push(artifact);
  };

  const pushLinkedFileArtifact = (artifact: Artifact, seenFilePaths: Set<string>) => {
    const resolved = absolutize(artifact);
    if (!resolved.filePath || isIgnoredArtifactPath(resolved.filePath)) return;
    pushFileArtifactIfNew(resolved, seenFilePaths);
  };

  const pushBarePathArtifact = (artifact: Artifact, seenFilePaths: Set<string>) => {
    const resolved = absolutize(artifact);
    if (!resolved.filePath || isIgnoredArtifactPath(resolved.filePath)) return;
    if (cwd?.trim() && !isPathInsideDirectory(resolved.filePath, cwd)) return;
    pushFileArtifactIfNew(resolved, seenFilePaths);
  };

  const pushMediaFileArtifact = (artifact: Artifact, seenFilePaths: Set<string>) => {
    pushFileArtifactIfNew(absolutize(artifact), seenFilePaths);
  };

  const pushLocalServiceArtifactIfNew = (artifact: Artifact, seenLocalServiceUrls: Set<string>) => {
    const url = artifact.url || artifact.content;
    const normalized = normalizeLocalServiceUrlForDedup(url);
    if (!url || seenLocalServiceUrls.has(normalized)) return;
    seenLocalServiceUrls.add(normalized);
    detected.push(artifact);
  };

  for (const msg of messages) {
    if (msg.type === 'assistant' && !msg.metadata?.isThinking && msg.content) {
      const seenFilePaths = new Set<string>();
      const seenLocalServiceUrls = new Set<string>();
      const localServiceArtifacts = parseLocalServiceUrlsFromText(
        msg.content,
        msg.id,
        sessionId,
        { projectDirectory: cwd },
      );
      for (const serviceArtifact of localServiceArtifacts) {
        pushLocalServiceArtifactIfNew(serviceArtifact, seenLocalServiceUrls);
      }

      const fileLinks = parseFileLinksFromMessage(msg.content, msg.id, sessionId);
      for (const fileLink of fileLinks) {
        pushLinkedFileArtifact(fileLink, seenFilePaths);
      }

      const pathArtifacts = parseFilePathsFromText(
        stripFileLinksFromText(msg.content),
        msg.id,
        sessionId,
      );
      for (const pathArtifact of pathArtifacts) {
        pushBarePathArtifact(pathArtifact, seenFilePaths);
      }

      detected.push(...parseRemoteImageArtifactsFromText(msg.content, msg.id, sessionId, 'artifact-remote-assistant'));
    }

    if (msg.type === 'tool_result') {
      const seenFilePaths = new Set<string>();
      const toolMediaArtifacts = parseToolResultMediaArtifacts(msg, sessionId);
      if (toolMediaArtifacts.length > 0) {
        for (const mediaArtifact of toolMediaArtifacts) {
          if (mediaArtifact.filePath) {
            pushMediaFileArtifact(mediaArtifact, seenFilePaths);
          } else {
            detected.push(mediaArtifact);
          }
        }
        continue;
      }

      if (!msg.content) continue;

      const mediaArtifacts = parseMediaTokensFromText(msg.content, msg.id, sessionId);
      for (const mediaArtifact of mediaArtifacts) {
        pushMediaFileArtifact(mediaArtifact, seenFilePaths);
      }

      const toolUseId = msg.metadata?.toolUseId;
      const pairedToolUse = typeof toolUseId === 'string'
        ? messages.find(m => m.type === 'tool_use' && m.metadata?.toolUseId === toolUseId)
        : undefined;
      const toolName = pairedToolUse?.metadata?.toolName
        ? String(pairedToolUse.metadata.toolName)
        : '';
      if (shouldParseFilePathsFromToolResult(toolName)) {
        const pathArtifacts = parseFilePathsFromText(msg.content, msg.id, sessionId, 'artifact-toolresult');
        for (const pathArtifact of pathArtifacts) {
          pushMediaFileArtifact(pathArtifact, seenFilePaths);
        }
      }
      detected.push(...parseRemoteImageArtifactsFromText(msg.content, msg.id, sessionId, 'artifact-remote-toolresult'));
    }

    if (msg.type === 'system') {
      const seenFilePaths = new Set<string>();
      const toolMediaArtifacts = parseToolResultMediaArtifacts(msg, sessionId);
      if (toolMediaArtifacts.length > 0) {
        for (const mediaArtifact of toolMediaArtifacts) {
          if (mediaArtifact.filePath) {
            pushMediaFileArtifact(mediaArtifact, seenFilePaths);
          } else {
            detected.push(mediaArtifact);
          }
        }
        continue;
      }

      if (!msg.content) continue;

      const fileLinks = parseFileLinksFromMessage(msg.content, msg.id, sessionId);
      for (const fileLink of fileLinks) {
        pushLinkedFileArtifact(fileLink, seenFilePaths);
      }

      const pathArtifacts = parseFilePathsFromText(
        stripFileLinksFromText(msg.content),
        msg.id,
        sessionId,
        'artifact-system-path',
      );
      for (const pathArtifact of pathArtifacts) {
        pushBarePathArtifact(pathArtifact, seenFilePaths);
      }

      detected.push(...parseRemoteImageArtifactsFromText(msg.content, msg.id, sessionId, 'artifact-remote-system'));
    }
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type !== 'tool_use') continue;
    const toolUseId = msg.metadata?.toolUseId;
    const toolResult = typeof toolUseId === 'string'
      ? messages.find(m => m.type === 'tool_result' && m.metadata?.toolUseId === toolUseId)
      : messages[i + 1]?.type === 'tool_result' ? messages[i + 1] : undefined;
    const toolArtifact = parseToolArtifact(msg, toolResult, sessionId);
    if (toolArtifact?.filePath) {
      const resolved = absolutize(toolArtifact);
      if (resolved.filePath && !isIgnoredArtifactPath(resolved.filePath)) {
        detected.push(resolved);
      }
    }
  }

  return detected;
}
