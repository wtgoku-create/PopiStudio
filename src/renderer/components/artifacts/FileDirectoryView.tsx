import React, { useMemo, useState } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact, ArtifactType } from '@/types/artifact';

import FileTypeIcon from '../icons/fileTypes/FileTypeIcon';

const t = (key: string) => i18nService.t(key);

const TYPE_ORDER: Record<ArtifactType, number> = {
  html: 0,
  svg: 1,
  image: 2,
  video: 3,
  audio: 4,
  mermaid: 5,
  document: 6,
  markdown: 7,
  text: 8,
  wiki: 9,
  code: 10,
  'local-service': 11,
};

const TYPE_LABEL_KEYS: Record<ArtifactType, string> = {
  html: 'artifactTypeHtml',
  svg: 'artifactTypeSvg',
  image: 'artifactTypeImage',
  video: 'artifactTypeVideo',
  audio: 'artifactTypeAudio',
  mermaid: 'artifactTypeMermaid',
  document: 'artifactTypeDocument',
  markdown: 'artifactTypeMarkdown',
  text: 'artifactTypeText',
  wiki: 'artifactTypeWiki',
  code: 'artifactCode',
  'local-service': 'artifactTypeHtml',
};

function getShortPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.length > 2
    ? `.../${parts.slice(-2).join('/')}`
    : parts.join('/');
}

function getShortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    const fileName = path.split('/').filter(Boolean).pop();
    return fileName
      ? `${parsed.host}/.../${fileName}`
      : parsed.host;
  } catch {
    return url;
  }
}

function getArtifactSecondaryText(artifact: Artifact): string {
  const remoteUrl = artifact.remoteUrl || (!artifact.filePath && /^https?:\/\//i.test(artifact.content) ? artifact.content : '');
  if (remoteUrl) return getShortUrl(remoteUrl);
  if (artifact.filePath) return getShortPath(artifact.filePath);
  return '';
}

interface FileDirectoryViewProps {
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact?: boolean;
}

const FileDirectoryView: React.FC<FileDirectoryViewProps> = ({ artifacts, selectedId, onSelect, compact }) => {
  const [search, setSearch] = useState('');

  const sortedAndFiltered = useMemo(() => {
    let items = artifacts;

    if (search.trim()) {
      const keyword = search.trim().toLowerCase();
      items = items.filter(a => {
        const searchable = [
          a.fileName,
          a.title,
          a.filePath,
          a.remoteUrl,
          /^https?:\/\//i.test(a.content) ? a.content : '',
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(keyword);
      });
    }

    return [...items].sort((a, b) => {
      const typeA = TYPE_ORDER[a.type] ?? 99;
      const typeB = TYPE_ORDER[b.type] ?? 99;
      if (typeA !== typeB) return typeA - typeB;
      return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
    });
  }, [artifacts, search]);

  if (artifacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-sm p-4">
        {t('artifactEmptyFiles')}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2 shrink-0">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('artifactSearchPlaceholder')}
          className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-foreground placeholder:text-muted outline-none focus:border-primary transition-colors"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {sortedAndFiltered.length === 0 ? (
          <div className="flex items-center justify-center text-muted text-xs p-4">
            {t('artifactSearchEmpty')}
          </div>
        ) : (
          sortedAndFiltered.map((artifact, idx) => {
            const showGroupHeader = !compact && (
              idx === 0 || artifact.type !== sortedAndFiltered[idx - 1].type
            );
            const fileName = artifact.fileName || artifact.title;
            const secondaryText = getArtifactSecondaryText(artifact);
            return (
              <React.Fragment key={artifact.id}>
                {showGroupHeader && (
                  <div className="px-3 pt-2 pb-1 text-[10px] font-medium text-muted uppercase tracking-wide">
                    {t(TYPE_LABEL_KEYS[artifact.type] || 'artifactCode')}
                  </div>
                )}
                <div
                  onClick={() => onSelect(artifact.id)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors
                    ${artifact.id === selectedId ? 'bg-primary/10 text-primary' : 'hover:bg-surface text-foreground'}`}
                >
                  <FileTypeIcon fileName={fileName} className="h-4 w-4 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate">
                      {fileName}
                    </div>
                    {!compact && secondaryText && (
                      <div className="text-[10px] text-muted truncate">
                        {secondaryText}
                      </div>
                    )}
                  </div>
                  {!compact && (
                    <span className="shrink-0 text-xs text-muted uppercase">
                      {t(TYPE_LABEL_KEYS[artifact.type] || 'artifactCode')}
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
};

export default FileDirectoryView;
