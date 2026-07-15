import { describe, expect, test } from 'vitest';

import type { Artifact } from '../../types/artifact';
import { ArtifactAutoPreviewOpenTarget, getAutoPreviewOpenTarget, selectAutoPreviewArtifact } from './autoPreviewPolicy';

const artifact = (overrides: Partial<Artifact>): Artifact => ({
  id: 'artifact-1',
  messageId: 'msg1',
  sessionId: 'sess1',
  type: 'image',
  title: 'image.png',
  content: '',
  createdAt: 100,
  ...overrides,
});

describe('selectAutoPreviewArtifact', () => {
  test('prefers local service before documents and media', () => {
    const selected = selectAutoPreviewArtifact([
      artifact({ id: 'image', type: 'image' }),
      artifact({ id: 'doc', type: 'document' }),
      artifact({ id: 'service', type: 'local-service', url: 'http://localhost:3000', content: 'http://localhost:3000' }),
    ]);

    expect(selected?.id).toBe('service');
  });

  test('deduplicates candidates before selecting', () => {
    const selected = selectAutoPreviewArtifact([
      artifact({ id: 'old', type: 'image', filePath: '/tmp/a.png', createdAt: 100 }),
      artifact({ id: 'new', type: 'image', filePath: '/tmp/a.png', createdAt: 200 }),
    ]);

    expect(selected?.id).toBe('new');
  });
});

describe('getAutoPreviewOpenTarget', () => {
  test('opens local services in browser and other previewable artifacts in preview tabs', () => {
    expect(getAutoPreviewOpenTarget(artifact({
      type: 'local-service',
      content: 'http://localhost:3000',
      url: 'http://localhost:3000',
    }))).toBe(ArtifactAutoPreviewOpenTarget.LocalServiceBrowser);
    expect(getAutoPreviewOpenTarget(artifact({ type: 'image' }))).toBe(ArtifactAutoPreviewOpenTarget.PreviewTab);
  });
});
