import React, { useMemo } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';

const getString = (value: unknown): string => (
  typeof value === 'string' ? value : ''
);

interface WikiRendererProps {
  artifact: Artifact;
}

const WikiRenderer: React.FC<WikiRendererProps> = ({ artifact }) => {
  const metadata = artifact.metadata ?? {};
  const title = getString(metadata.title) || artifact.title;
  const slug = getString(metadata.slug);
  const kbId = getString(metadata.kbId);
  const app = getString(metadata.app) || 'weknora';
  const rows = useMemo(() => [
    ['app', app],
    ['type', 'wiki'],
    ['title', title],
    ['slug', slug],
    ...(kbId ? [['kb_id', kbId] as [string, string]] : []),
  ].filter(([, value]) => value), [app, kbId, slug, title]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-secondary">
          {i18nService.t('artifactTypeWiki')}
        </div>
        <h2 className="mt-1 text-base font-semibold text-foreground">
          {title}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="rounded-lg border border-border bg-surface-raised p-3">
          <div className="mb-2 text-xs font-medium text-secondary">
            {i18nService.t('artifactWikiLookupFields')}
          </div>
          <dl className="space-y-2">
            {rows.map(([key, value]) => (
              <div key={key} className="grid grid-cols-[64px_1fr] gap-2 text-xs">
                <dt className="text-secondary">{key}</dt>
                <dd className="break-all text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="mt-3 text-xs leading-5 text-secondary">
          {i18nService.t('artifactWikiDetailPending')}
        </p>
      </div>
    </div>
  );
};

export default WikiRenderer;
