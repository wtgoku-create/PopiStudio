import { MapIcon } from '@heroicons/react/24/outline';
import React from 'react';

import MarkdownContent from '@/components/MarkdownContent';
import { i18nService } from '@/services/i18n';
import type { Artifact } from '@/types/artifact';
import { SourceReferenceKind, type SourceReference } from '@/types/sourceReference';

const getString = (value: unknown): string => (
  typeof value === 'string' ? value : ''
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const getPageTypeLabel = (pageType: string): string => {
  const normalized = pageType.trim().toLowerCase();
  if (normalized === 'entity') return i18nService.t('artifactWikiPageTypeEntity');
  if (normalized === 'concept') return i18nService.t('artifactWikiPageTypeConcept');
  return pageType || i18nService.t('artifactTypeWiki');
};

interface WikiRendererProps {
  artifact: Artifact;
}

const WikiRenderer: React.FC<WikiRendererProps> = ({ artifact }) => {
  const metadata = artifact.metadata ?? {};
  const wikiPage = isRecord(metadata.wikiPage) ? metadata.wikiPage : null;
  const status = getString(metadata.status);
  const error = getString(metadata.error);
  const kbId = getString(wikiPage?.knowledge_base_id) || getString(metadata.kbId);
  const pageType = getString(wikiPage?.page_type) || getString(metadata.pageType);
  const version = typeof wikiPage?.version === 'number'
    ? wikiPage.version
    : undefined;
  const showWikiHeader = status === 'loaded' && !!artifact.content;
  const handleSourceReferenceClick = (reference: SourceReference): void => {
    const nextReference = reference.kind === SourceReferenceKind.Wiki && !reference.kbId && kbId
      ? { ...reference, kbId }
      : reference;
    window.dispatchEvent(new CustomEvent('cowork:source-reference-click', {
      detail: nextReference,
    }));
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-background">
      <article className="mx-auto w-full max-w-3xl px-6 py-5 sm:px-8">
        {showWikiHeader && (
          <div className="mb-7 flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex shrink-0 items-center rounded border border-primary/40 bg-primary/5 px-2 py-0.5 text-sm font-medium leading-5 text-primary">
                {getPageTypeLabel(pageType)}
              </span>
              {version !== undefined && (
                <span className="text-sm text-secondary">
                  v{version}
                </span>
              )}
            </div>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary-hover"
              title={i18nService.t('artifactWikiViewInGraph')}
            >
              <MapIcon className="h-4 w-4" />
              <span>{i18nService.t('artifactWikiViewInGraph')}</span>
            </button>
          </div>
        )}
        {status === 'loading' && (
          <div className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary">
            {i18nService.t('artifactWikiLoading')}
          </div>
        )}
        {status === 'error' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-5 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
            {error || i18nService.t('artifactWikiLoadError')}
          </div>
        )}
        {status === 'loaded' && artifact.content && (
          <MarkdownContent
            content={artifact.content}
            className="[&_p]:my-3 [&_ul]:my-4 [&_li]:my-2 [&_li]:leading-7 [&_a]:text-primary"
            onSourceReferenceClick={handleSourceReferenceClick}
          />
        )}
        {status === 'loaded' && !artifact.content && (
          <p className="text-sm leading-6 text-secondary">
            {i18nService.t('artifactWikiEmpty')}
          </p>
        )}
      </article>
    </div>
  );
};

export default WikiRenderer;
