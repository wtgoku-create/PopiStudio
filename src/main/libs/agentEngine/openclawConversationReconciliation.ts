import * as path from 'path';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
};

const normalizeLocalMediaPathKey = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\\/g, '/').toLowerCase();
};

export const getLocalMediaAttachmentsKey = (metadata: unknown): string => {
  if (!isRecord(metadata) || !Array.isArray(metadata.localMediaAttachments)) {
    return '';
  }
  return metadata.localMediaAttachments
    .map((item) => {
      if (!isRecord(item)) return '';
      const localPath = normalizeLocalMediaPathKey(item.localPath);
      if (!localPath) return '';
      const mimeType = typeof item.mimeType === 'string' ? item.mimeType.trim().toLowerCase() : '';
      return `${localPath}\x1e${mimeType}`;
    })
    .filter(Boolean)
    .sort()
    .join('\x1f');
};

export const buildGatewayMediaMetadata = (
  entry: { mediaAttachments?: Array<{ localPath: string; mimeType?: string }> },
): Record<string, unknown> | undefined => {
  const attachments = entry.mediaAttachments
    ?.map((attachment) => {
      const localPath = attachment.localPath.trim();
      if (!localPath) return null;
      const mimeType = attachment.mimeType?.trim();
      return {
        localPath,
        ...(mimeType ? { mimeType } : {}),
        name: path.basename(localPath),
      };
    })
    .filter((attachment): attachment is { localPath: string; mimeType?: string; name: string } => attachment !== null);

  return attachments?.length ? { localMediaAttachments: attachments } : undefined;
};

export const isSameHistoryEntry = (
  left: { role: 'user' | 'assistant'; text: string },
  right: { role: 'user' | 'assistant'; text: string },
): boolean => left.role === right.role && left.text === right.text;

export const isSameReconciledEntry = (
  left: { role: 'user' | 'assistant'; text: string; metadata?: Record<string, unknown> },
  right: { role: 'user' | 'assistant'; text: string; metadata?: Record<string, unknown> },
): boolean => {
  return isSameHistoryEntry(left, right)
    && getLocalMediaAttachmentsKey(left.metadata) === getLocalMediaAttachmentsKey(right.metadata);
};
