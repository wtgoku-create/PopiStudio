import { ChevronRightIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';

import {
  type ActivityChunkEntry,
  formatActivityDuration,
  getActivityCurrentActionText,
  getActivityGroupHeaderLabel,
  getActivityGroupSummary,
} from './messageDisplayUtils';

const isItemLive = (item: ActivityChunkEntry['item']): boolean => {
  if (item.type === 'tool_group') return !item.group.toolResult;
  return item.type === 'assistant' && Boolean(item.message.metadata?.isStreaming);
};

const ActivityGroupBlock: React.FC<{
  entries: ActivityChunkEntry[];
  isStreamingTail?: boolean;
  renderEntry: (
    entry: ActivityChunkEntry,
    options?: { initiallyExpanded?: boolean },
  ) => React.ReactNode;
}> = ({ entries, isStreamingTail = false, renderEntry }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const items = useMemo(() => entries.map(entry => entry.item), [entries]);
  const summary = useMemo(() => getActivityGroupSummary(items), [items]);
  const lastItem = items[items.length - 1];
  const showLiveAction = Boolean(lastItem) && isStreamingTail && isItemLive(lastItem);
  const label = showLiveAction
    ? getActivityCurrentActionText(lastItem)
    : getActivityGroupHeaderLabel(items);

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={() => setIsExpanded(value => !value)}
        className="group flex max-w-full items-center gap-1.5 text-left"
        aria-expanded={isExpanded}
      >
        <span className={`min-w-0 truncate text-sm text-secondary transition-colors group-hover:text-foreground ${showLiveAction ? 'shimmer-text' : ''}`}>
          {label}
        </span>
        {!showLiveAction && !isStreamingTail && summary.durationMs != null && summary.durationMs > 0 && (
          <span className="shrink-0 text-xs text-muted">· {formatActivityDuration(summary.durationMs)}</span>
        )}
        <ChevronRightIcon className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200 group-hover:text-secondary ${isExpanded ? 'rotate-90' : ''}`} />
      </button>
      {isExpanded && (
        <div className="mt-2 w-full overflow-hidden rounded-lg border border-border divide-y divide-border">
          {entries.map(entry => renderEntry(entry, { initiallyExpanded: entries.length === 1 }))}
        </div>
      )}
    </div>
  );
};

export default ActivityGroupBlock;
