import React from 'react';

import { i18nService } from '@/services/i18n';
import { type Artifact, ArtifactPreviewStatus } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

interface ArtifactPreviewStatusMessageProps {
  artifact: Artifact;
  fallbackKey?: string;
}

const getStatusMessage = (artifact: Artifact, fallbackKey: string): string => {
  switch (artifact.preview?.status) {
    case ArtifactPreviewStatus.Loading:
      return t('artifactSourceLoading');
    case ArtifactPreviewStatus.Missing:
      return t('artifactPreviewFileMissing');
    case ArtifactPreviewStatus.TooLarge:
      return t('artifactPreviewFileTooLarge');
    case ArtifactPreviewStatus.Unreadable:
      return artifact.preview.error
        ? `${t('artifactSourceLoadFailed')}: ${artifact.preview.error}`
        : t('artifactSourceLoadFailed');
    case ArtifactPreviewStatus.Ready:
    default:
      return t(fallbackKey);
  }
};

const ArtifactPreviewStatusMessage: React.FC<ArtifactPreviewStatusMessageProps> = ({
  artifact,
  fallbackKey = 'artifactNoContent',
}) => (
  <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
    {getStatusMessage(artifact, fallbackKey)}
  </div>
);

export default ArtifactPreviewStatusMessage;
