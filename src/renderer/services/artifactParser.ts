import type { Artifact, ArtifactType } from '../types/artifact';
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

const LANGUAGE_TO_ARTIFACT_TYPE: Record<string, ArtifactType> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'code',
  tsx: 'code',
  markdown: 'markdown',
  md: 'markdown',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
};

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
const BINARY_DOCUMENT_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf']);
const MEDIA_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mp3', '.wav', '.m4a']);

export function getArtifactTypeFromLanguage(lang: string): ArtifactType | null {
  return LANGUAGE_TO_ARTIFACT_TYPE[lang.toLowerCase()] ?? null;
}

export function getArtifactTypeFromExtension(ext: string): ArtifactType | null {
  return EXTENSION_TO_ARTIFACT_TYPE[ext.toLowerCase()] ?? null;
}

export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function isBinaryDocumentExtension(ext: string): boolean {
  return BINARY_DOCUMENT_EXTENSIONS.has(ext.toLowerCase());
}

export function isMediaExtension(ext: string): boolean {
  return MEDIA_EXTENSIONS.has(ext.toLowerCase());
}

export function parseCodeBlockArtifacts(
  messageContent: string,
  messageId: string,
  sessionId: string,
): Artifact[] {
  if (!messageContent) return [];

  const artifacts: Artifact[] = [];
  const re = /```(artifact:)?(\w+)(?:\s+title="([^"]*)")?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = re.exec(messageContent)) !== null) {
    const isExplicitArtifact = Boolean(match[1]);
    const language = match[2];
    const explicitTitle = match[3];
    const content = match[4].trimEnd();

    const artifactType = getArtifactTypeFromLanguage(language);

    if (!artifactType && !isExplicitArtifact) {
      continue;
    }

    const type = artifactType ?? 'code';
    const title = explicitTitle || generateTitle(type, language, content);

    artifacts.push({
      id: `artifact-${messageId}-${index}`,
      messageId,
      sessionId,
      type,
      title,
      content,
      language: type === 'code' ? language : undefined,
      source: 'codeblock',
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

const BARE_FILE_PATH_RE = /(?:^|[\s"'`(])(\/?(?:[^\s"'`()\[\]]+\/)*[^\s"'`()\[\]]+\.(?:docx|xlsx|pptx|pdf|md|txt|log|csv|mp4|mov|webm|mp3|wav|m4a))(?:[\s"'`)]|$)/gmi;

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
      source: 'tool',
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
      source: 'tool',
      createdAt: Date.now(),
    });

    index++;
  }

  return artifacts;
}

function generateTitle(type: ArtifactType, language: string, content: string): string {
  switch (type) {
    case 'html': {
      const titleMatch = content.match(/<title>([^<]+)<\/title>/i);
      return titleMatch ? titleMatch[1] : 'HTML Page';
    }
    case 'svg':
      return 'SVG Image';
    case 'mermaid':
      return 'Mermaid Diagram';
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'markdown':
      return 'Markdown Document';
    case 'text':
      return 'Text File';
    case 'document':
      return 'Document';
    case 'code':
      return `${language.charAt(0).toUpperCase() + language.slice(1)} Code`;
  }
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
    source: 'tool',
    createdAt: toolUseMsg.timestamp || Date.now(),
  };
}
