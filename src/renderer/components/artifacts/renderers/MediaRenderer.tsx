import React, { useMemo, useState } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.m4a']);

function getArtifactSource(artifact: Artifact): string | null {
  if (artifact.content) return artifact.content;
  if (!artifact.filePath) return null;

  let filePath = artifact.filePath;
  if (filePath.startsWith('file:///')) {
    filePath = filePath.slice(7);
  } else if (filePath.startsWith('file://')) {
    filePath = filePath.slice(7);
  } else if (filePath.startsWith('file:/')) {
    filePath = filePath.slice(5);
  }

  if (/^\/[A-Za-z]:/.test(filePath)) {
    filePath = filePath.slice(1);
  }

  const normalized = filePath.replace(/\\/g, '/');
  const prefix = /^[A-Za-z]:/.test(normalized) ? '/' : '';
  return `file://${prefix}${encodeURI(normalized)}`;
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
  const isVideo = artifact.type === 'video' || VIDEO_EXTENSIONS.has(ext);
  const isAudio = artifact.type === 'audio' || AUDIO_EXTENSIONS.has(ext);

  if (!source || error) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-sm">
        {i18nService.t('artifactNoPreview')}
      </div>
    );
  }

  if (isVideo) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black/95 p-4">
        <video
          key={source}
          src={source}
          controls
          preload="metadata"
          className="max-h-full max-w-full rounded object-contain"
          onError={() => setError(true)}
        />
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
            src={source}
            controls
            preload="metadata"
            className="w-full"
            onError={() => setError(true)}
          />
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
