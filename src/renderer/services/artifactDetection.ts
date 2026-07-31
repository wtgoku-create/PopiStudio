import {
  type Artifact,
  ArtifactPreviewStatus,
  ArtifactTypeValue,
  collectSessionArtifacts,
  toAbsoluteArtifactPath,
} from '@shared/cowork/artifacts';

export { collectSessionArtifacts };

const resolveFailedPreviewStatus = (error?: string): ArtifactPreviewStatus =>
  error && /too large|file too large|max \d+mb/i.test(error)
    ? ArtifactPreviewStatus.TooLarge
    : ArtifactPreviewStatus.Unreadable;

export async function loadDetectedFileArtifact(
  artifact: Artifact,
  cwd?: string,
): Promise<Artifact | null> {
  if (!artifact.filePath) return null;
  const absPath = toAbsoluteArtifactPath(artifact.filePath, cwd);

  if (artifact.type === ArtifactTypeValue.Video || artifact.type === ArtifactTypeValue.Audio) {
    try {
      const stat = await window.electron.dialog.statFile(absPath);
      if (!stat?.success || !stat.isFile) {
        return {
          ...artifact,
          content: '',
          filePath: absPath,
          preview: {
            status: ArtifactPreviewStatus.Missing,
            error: stat?.error || 'File not found',
          },
        };
      }
      return {
        ...artifact,
        content: '',
        filePath: absPath,
        preview: {
          status: ArtifactPreviewStatus.Ready,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        },
      };
    } catch (error) {
      return {
        ...artifact,
        content: '',
        filePath: absPath,
        preview: {
          status: ArtifactPreviewStatus.Unreadable,
          error: error instanceof Error ? error.message : 'Failed to stat file',
        },
      };
    }
  }

  if (artifact.type === ArtifactTypeValue.Html) {
    try {
      const stat = await window.electron.dialog.statFile(absPath);
      if (stat?.success && stat.isFile) {
        return {
          ...artifact,
          content: '',
          filePath: absPath,
          contentVersion: Date.now(),
          preview: {
            status: ArtifactPreviewStatus.Ready,
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          },
        };
      }
      return {
        ...artifact,
        content: '',
        filePath: absPath,
        preview: {
          status: ArtifactPreviewStatus.Missing,
          error: stat?.error || 'File not found',
        },
      };
    } catch {
      // File unreadable or missing.
    }
    return {
      ...artifact,
      content: '',
      filePath: absPath,
      preview: {
        status: ArtifactPreviewStatus.Unreadable,
        error: 'File unreadable or missing',
      },
    };
  }

  try {
    const isTextType = artifact.type !== ArtifactTypeValue.Image && artifact.type !== ArtifactTypeValue.Document;
    if (isTextType && window.electron.dialog.readTextFile) {
      const result = await window.electron.dialog.readTextFile(absPath);
      if (result?.success && typeof result.content === 'string') {
        return {
          ...artifact,
          content: result.content,
          filePath: absPath,
          preview: {
            status: ArtifactPreviewStatus.Ready,
            size: result.size,
            readBytes: result.readBytes,
            truncated: result.truncated,
          },
        };
      }
      return {
        ...artifact,
        content: '',
        filePath: absPath,
        preview: {
          status: resolveFailedPreviewStatus(result?.error),
          error: result?.error || 'Failed to read file',
        },
      };
    }

    const result = await window.electron.dialog.readFileAsDataUrl(absPath);
    if (result?.success && result.dataUrl) {
      let content = result.dataUrl;
      if (isTextType) {
        try {
          const base64 = result.dataUrl.split(',')[1] || '';
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
          content = new TextDecoder('utf-8').decode(bytes);
        } catch {
          content = result.dataUrl;
        }
      }
      return {
        ...artifact,
        content,
        filePath: absPath,
        preview: {
          status: ArtifactPreviewStatus.Ready,
        },
      };
    }
    return {
      ...artifact,
      content: '',
      filePath: absPath,
      preview: {
        status: resolveFailedPreviewStatus(result?.error),
        error: result?.error || 'Failed to read file',
      },
    };
  } catch {
    // File unreadable or missing.
  }
  return {
    ...artifact,
    content: '',
    filePath: absPath,
    preview: {
      status: ArtifactPreviewStatus.Unreadable,
      error: 'File unreadable or missing',
    },
  };
}
