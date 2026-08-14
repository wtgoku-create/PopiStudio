import { ChevronRightIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkMessage } from '../../types/cowork';

const ThinkingBlock: React.FC<{
  message: CoworkMessage;
  mapDisplayText?: (value: string) => string;
  variant?: 'default' | 'row';
  initiallyExpanded?: boolean;
  highlightQuery?: string;
}> = ({ message, mapDisplayText, variant = 'default', initiallyExpanded = false, highlightQuery }) => {
  const isCurrentlyStreaming = Boolean(message.metadata?.isStreaming);
  const isRowVariant = variant === 'row';
  const [isExpanded, setIsExpanded] = useState(
    isRowVariant ? initiallyExpanded : isCurrentlyStreaming,
  );
  const displayContent = mapDisplayText ? mapDisplayText(message.content) : message.content;

  useEffect(() => {
    if (isRowVariant) return;
    if (isCurrentlyStreaming) {
      setIsExpanded(true);
    } else {
      setIsExpanded(false);
    }
  }, [isCurrentlyStreaming, isRowVariant]);

  return (
    <div className={isRowVariant ? '' : 'rounded-lg border border-border bg-surface-sunken/50 overflow-hidden'}>
      <button
        onClick={() => setIsExpanded(value => !value)}
        className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors ${
          isRowVariant ? 'hover:bg-surface-raised/40' : 'hover:bg-surface-raised/50'
        }`}
      >
        <LightBulbIcon className="h-3 w-3 text-secondary flex-shrink-0" />
        <span className="text-xs text-secondary">
          {i18nService.t('reasoning')}
        </span>
        {isCurrentlyStreaming && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse flex-shrink-0" />
        )}
        <ChevronRightIcon
          className={`h-3 w-3 text-muted flex-shrink-0 transition-transform duration-200 ${
            !isRowVariant ? 'ml-auto' : ''
          } ${
            isExpanded ? 'rotate-90' : ''
          }`}
        />
      </button>
      {isExpanded && (
        <div className="activity-row-detail px-4 pb-3 max-h-[300px] overflow-y-auto">
          <div className="text-xs leading-relaxed text-muted whitespace-pre-wrap">
            {highlightQuery
              ? displayContent.split(new RegExp(`(${highlightQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')).map((part, index) => (
                part.toLocaleLowerCase() === highlightQuery.trim().toLocaleLowerCase()
                  ? <mark key={`${part}-${index}`} className="cowork-search-highlight">{part}</mark>
                  : part
              ))
              : displayContent}
          </div>
        </div>
      )}
    </div>
  );
};

export default ThinkingBlock;
