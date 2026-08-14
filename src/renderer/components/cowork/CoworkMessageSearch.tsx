import { ChevronDownIcon, ChevronUpIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkMessage } from '../../types/cowork';

interface CoworkMessageSearchProps {
  messages: CoworkMessage[];
  searchMessages?: (query: string) => Promise<CoworkMessage[]>;
  onClose: () => void;
  onQueryChange?: (query: string) => void;
  onSelectMessage: (messageId: string) => void | Promise<void>;
}

const isVisibleSearchMessage = (message: CoworkMessage): boolean => (
  (message.type === 'user' || message.type === 'assistant')
  && message.metadata?.isThinking !== true
  && message.metadata?.hidden !== true
);

const CoworkMessageSearch: React.FC<CoworkMessageSearchProps> = ({ messages, searchMessages, onClose, onQueryChange, onSelectMessage }) => {
  const [query, setQuery] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [remoteMatches, setRemoteMatches] = useState<CoworkMessage[] | null>(null);
  const localMatches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return messages.filter(message => (
      isVisibleSearchMessage(message)
      && message.content.toLocaleLowerCase().includes(normalized)
    ));
  }, [messages, query]);
  const matches = (remoteMatches ?? localMatches).filter(isVisibleSearchMessage);

  useEffect(() => {
    let active = true;
    setRemoteMatches(null);
    if (!searchMessages || !query.trim()) {
      return () => { active = false; };
    }
    void searchMessages(query).then(result => {
      if (active) setRemoteMatches(result);
    }).catch(() => {
      if (active) setRemoteMatches(localMatches);
    });
    return () => { active = false; };
  }, [localMatches, query, searchMessages]);

  useEffect(() => setMatchIndex(0), [query]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Enter' && matches.length > 0) {
        event.preventDefault();
        onSelectMessage(matches[matchIndex]?.id ?? matches[0].id);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [matchIndex, matches, onClose, onSelectMessage]);

  const move = (direction: number) => {
    if (matches.length === 0) return;
    const nextIndex = (matchIndex + direction + matches.length) % matches.length;
    setMatchIndex(nextIndex);
    const nextMatch = matches[nextIndex];
    if (nextMatch) {
      void onSelectMessage(nextMatch.id);
    }
  };

  return (
    <div className="absolute right-3 top-14 z-[10020] flex w-[min(420px,calc(100vw-24px))] items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 shadow-popover">
      <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-secondary" />
      <input
        autoFocus
        value={query}
        onChange={event => {
          setQuery(event.target.value);
          onQueryChange?.(event.target.value);
        }}
        placeholder={i18nService.t('coworkMessageSearchPlaceholder')}
        className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground outline-none"
      />
      <span className="whitespace-nowrap text-[11px] text-secondary">
        {matches.length ? `${matchIndex + 1}/${matches.length}` : i18nService.t('coworkMessageSearchNoMatches')}
      </span>
      <button type="button" title={i18nService.t('previous')} aria-label={i18nService.t('previous')} onClick={() => move(-1)} className="rounded p-1 text-secondary hover:bg-surface-raised">
        <ChevronUpIcon className="h-4 w-4" />
      </button>
      <button type="button" title={i18nService.t('next')} aria-label={i18nService.t('next')} onClick={() => move(1)} className="rounded p-1 text-secondary hover:bg-surface-raised">
        <ChevronDownIcon className="h-4 w-4" />
      </button>
      <button type="button" title={i18nService.t('close')} aria-label={i18nService.t('close')} onClick={onClose} className="rounded p-1 text-secondary hover:bg-surface-raised">
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  );
};

export default CoworkMessageSearch;
