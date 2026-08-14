export interface UserMessageFileAttachment {
  path: string;
  name: string;
  isDirectory: boolean;
}

export interface ExtractedUserMessageFileAttachments {
  text: string;
  attachments: UserMessageFileAttachment[];
}

const FOLDER_LABELS = ['输入文件夹', 'Input Folder'] as const;
const FILE_LABELS = ['输入文件', 'Input Files'] as const;
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const LABELS = [...FOLDER_LABELS, ...FILE_LABELS].map(escapeRegExp).join('|');
const ATTACHMENT_LINE_RE = new RegExp(
  `^[ \\t]*(${LABELS}): ((?:\\/|[A-Za-z]:[\\\\/]|\\\\\\\\)[^\\n]*?)[ \\t]*$`,
  'gm',
);

const attachmentName = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '');
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return separator >= 0 ? trimmed.slice(separator + 1) || path : trimmed || path;
};

export function extractUserMessageFileAttachments(content: string): ExtractedUserMessageFileAttachments {
  if (!content) return { text: content, attachments: [] };
  const attachments: UserMessageFileAttachment[] = [];
  const seen = new Set<string>();
  const text = content.replace(new RegExp(ATTACHMENT_LINE_RE.source, ATTACHMENT_LINE_RE.flags), (_match, label: string, rawPath: string) => {
    const path = rawPath.trim();
    const key = path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    if (path && !seen.has(key)) {
      seen.add(key);
      attachments.push({
        path,
        name: attachmentName(path),
        isDirectory: (FOLDER_LABELS as readonly string[]).includes(label),
      });
    }
    return '';
  });
  if (attachments.length === 0) return { text: content, attachments };
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), attachments };
}
