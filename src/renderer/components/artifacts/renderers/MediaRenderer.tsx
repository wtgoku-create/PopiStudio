import React, { useMemo, useState } from 'react';

import { i18nService } from '@/services/i18n';
import { type Artifact, ArtifactTypeValue } from '@/types/artifact';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv', '.wmv', '.flv']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a']);
const MEDIA_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};

function getArtifactSource(artifact: Artifact): string | null {
  if (artifact.content) return artifact.content;
  if (!artifact.filePath) return null;

  return toLocalFileSource(artifact.filePath);
}

function stripFileProtocol(filePath: string): string {
  let normalized = filePath.trim();
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
  if (/^\/[A-Za-z]:/.test(normalized)) {
    normalized = normalized.slice(1);
  }
  return normalized;
}

function encodeLocalPathForUrl(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .map((segment, index) => {
      if (index === 0 && segment === '') return '';
      if (/^[A-Za-z]:$/.test(segment)) return segment;
      return encodeURIComponent(segment);
    })
    .join('/');
}

function toLocalFileSource(filePath: string): string {
  const normalized = stripFileProtocol(filePath);
  const encoded = encodeLocalPathForUrl(normalized);
  if (/^[A-Za-z]:/.test(normalized)) {
    return `localfile:///${encoded}`;
  }
  if (encoded.startsWith('/')) {
    return `localfile://${encoded}`;
  }
  return `localfile:///${encoded}`;
}

function getExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot === -1 ? '' : name.slice(lastDot).toLowerCase();
}

interface MediaRendererProps {
  artifact: Artifact;
}

const MediaRenderer: React.FC<MediaRendererProps> = ({ artifact }) => {
  const [error, setError] = useState(false);

  const source = useMemo(() => getArtifactSource(artifact), [artifact]);
  const fileName = artifact.fileName || artifact.filePath || artifact.title;
  const ext = getExtension(fileName);
  const isVideo = artifact.type === ArtifactTypeValue.Video || VIDEO_EXTENSIONS.has(ext);
  const isAudio = artifact.type === ArtifactTypeValue.Audio || AUDIO_EXTENSIONS.has(ext);
  const sourceMimeType = MEDIA_MIME_BY_EXT[ext];

  const handleOpenWithApp = () => {
    if (!artifact.filePath) return;
    window.electron?.shell?.openPath(artifact.filePath);
  };

  if (!source || error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="text-sm font-medium text-foreground">
          {artifact.fileName || artifact.title}
        </div>
        <div className="text-xs text-muted">
          {i18nService.t('artifactNoPreview')}
        </div>
        {artifact.filePath && (
          <button
            type="button"
            onClick={handleOpenWithApp}
            className="rounded bg-primary px-3 py-1.5 text-xs text-white transition-colors hover:bg-primary/90"
          >
            {i18nService.t('artifactOpenWithApp')}
          </button>
        )}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/95 p-4">
        <video
          key={source}
          controls
          preload="metadata"
          className="max-h-full max-w-full rounded object-contain"
          onError={() => setError(true)}
        >
          <source src={source} type={sourceMimeType} />
        </video>
      </div>
    );
  }

  if (isAudio) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-xl border border-border bg-surface-raised p-6">
          <div className="mb-4 text-sm font-medium text-foreground truncate">
            {artifact.fileName || artifact.title}
          </div>
          <audio
            key={source}
            controls
            preload="metadata"
            className="w-full"
            onError={() => setError(true)}
          >
            <source src={source} type={sourceMimeType} />
          </audio>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full text-muted text-sm">
      {i18nService.t('artifactNoPreview')}
    </div>
  );
};

export default MediaRenderer;
