import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';

import { classifyErrorKey } from '../../../common/coworkErrorClassify';
import { ContextCompactionStatus } from '../../../common/coworkSystemMessages';
import { getScheduledReminderDisplayText } from '../../../scheduledTask/reminderText';
import {
  type CoworkErrorDetail,
  formatCoworkErrorDetailText,
  parseCoworkErrorDetail,
} from '../../../shared/cowork/errorDetail';
import { dedupeArtifactsForDisplay } from '../../services/artifactParser';
import { i18nService } from '../../services/i18n';
import type { Artifact } from '../../types/artifact';
import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import { ArtifactPreviewCard } from '../artifacts';
import ExclamationTriangleIcon from '../icons/ExclamationTriangleIcon';
import InformationCircleIcon from '../icons/InformationCircleIcon';
import ActivityGroupBlock from './ActivityGroupBlock';
import AssistantMessageItem from './AssistantMessageItem';
import { MessageCopyButton } from './MessageActionButton';
import {
  chunkConsolidatedItemsForDisplay,
  type ConsolidatedItem,
  type ConversationTurn,
  COWORK_DETAIL_CONTENT_CLASS,
  COWORK_DETAIL_GUTTER_CLASS,
  formatTurnDuration,
  getContextCompactionMessageLabel,
  getToolResultDisplay,
  getToolResultLineCount,
  getTurnActivityFingerprint,
  getTurnAnswerStartIndex,
  getTurnEndTimestamp,
  getTurnStartTimestamp,
  getVisibleAssistantItems,
  hasText,
  isActivityConsolidatedItem,
  isContextCompactionMessage,
  type ToolGroupItem,
} from './messageDisplayUtils';
import ThinkingBlock from './ThinkingBlock';
import ToolCallGroup from './ToolCallGroup';

// ── ContextCompressionIcon ───────────────────────────────────────────────────

const ContextCompressionIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 34 34" fill="none" aria-hidden="true" {...props}>
    <path
      d="M6 5V24C6 26.2091 7.79086 28 10 28H22.5M28 29V10C28 7.79086 26.2091 6 24 6H11.5"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    />
    <path
      d="M11.5 13.5H21"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.5 19H17"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="6" cy="5" r="2" fill="currentColor" />
    <circle cx="28" cy="29" r="2" fill="currentColor" />
  </svg>
);

// ── ContextCompactionDivider ─────────────────────────────────────────────────

const ContextCompactionDivider: React.FC<{ label: string; active?: boolean }> = ({
  label,
  active = false,
}) => (
  <div
    className="flex w-full items-center gap-3 py-3 text-secondary"
    role={active ? 'status' : undefined}
    aria-live={active ? 'polite' : undefined}
  >
    <div className="h-px min-w-0 flex-1 bg-border" />
    <div className="flex max-w-[min(100%,360px)] flex-col items-center gap-1.5 bg-background px-2">
      <div className="inline-flex max-w-full items-center gap-2 text-[14px] font-normal leading-[23px] text-foreground/90">
        <ContextCompressionIcon className={`h-3.5 w-3.5 flex-shrink-0 text-foreground/70 ${active ? 'animate-pulse' : ''}`} />
        <span className="truncate">{label}</span>
      </div>
      {active && (
        <div className="context-compaction-progress w-44 max-w-full" aria-hidden="true" />
      )}
    </div>
    <div className="h-px min-w-0 flex-1 bg-border" />
  </div>
);

// ── TypingDots ───────────────────────────────────────────────────────────────

const ActivityIndicator: React.FC<{ fingerprint: string; hasContent: boolean; startTimestamp: number | null }> = ({
  fingerprint,
  hasContent,
  startTimestamp,
}) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const elapsed = startTimestamp == null ? null : Math.max(0, now - startTimestamp);
  const seconds = elapsed == null ? 0 : Math.floor(elapsed / 1000);
  const status = hasContent ? i18nService.t('coworkActivityRunning') : i18nService.t('coworkActivityThinkingNow');
  return (
    <div key={fingerprint} className="flex items-center gap-2 py-1 animate-fade-in" role="status" aria-live="polite">
      <span className="activity-indicator-dot h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
      <span className="shimmer-text min-w-0 truncate text-sm text-secondary">{status}</span>
      {seconds >= 1 && <span className="shrink-0 text-xs tabular-nums text-muted">{formatTurnDuration(seconds * 1000)}</span>}
    </div>
  );
};

const buildErrorModelLine = (detail: CoworkErrorDetail): string | null => {
  if (!detail.provider && !detail.model) return null;
  const parts: string[] = [];
  if (detail.model) {
    parts.push(`${i18nService.t('coworkErrorModelLabel')}: ${detail.model}`);
  }
  if (detail.provider) {
    parts.push(`${i18nService.t('coworkErrorProviderLabel')}: ${detail.provider}`);
  }
  return parts.join(' · ');
};

const isGenericCoworkErrorText = (value: string): boolean => {
  return /^(LLM request failed\.?|OpenClaw run failed|Task execution failed\.?)$/i.test(value.trim());
};

const resolveSystemErrorDisplayText = (
  rawContent: string,
  detail: CoworkErrorDetail | null,
): string => {
  const detailText = [
    detail?.providerErrorMessagePreview,
    detail?.rawErrorPreview,
    detail?.rawErrorMessage,
    detail?.httpCode,
    rawContent,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join('\n');
  const key = classifyErrorKey(detailText || rawContent);
  if (key) return i18nService.t(key);
  if (!isGenericCoworkErrorText(rawContent)) return rawContent;
  return detail?.providerErrorMessagePreview
    || detail?.rawErrorPreview
    || detail?.rawErrorMessage
    || rawContent;
};

const SystemErrorTechnicalDetail: React.FC<{ detail: CoworkErrorDetail }> = ({ detail }) => {
  const [expanded, setExpanded] = useState(false);
  const detailText = useMemo(() => formatCoworkErrorDetailText(detail), [detail]);
  if (!detailText) return null;

  return (
    <div className="mt-1.5 pl-6">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-1 rounded text-xs text-muted transition-colors hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-expanded={expanded}
      >
        {expanded
          ? <ChevronUpIcon className="h-3 w-3 flex-shrink-0" />
          : <ChevronDownIcon className="h-3 w-3 flex-shrink-0" />
        }
        <span>{i18nService.t('coworkErrorTechnicalDetails')}</span>
      </button>
      {expanded && (
        <div className="relative mt-1.5 rounded-md bg-surface-raised px-3 py-2">
          <div className="absolute right-1 top-1">
            <MessageCopyButton content={detailText} />
          </div>
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words pr-8 font-mono text-code text-secondary">
            {detailText}
          </pre>
        </div>
      )}
    </div>
  );
};

// ── AssistantTurnBlock ───────────────────────────────────────────────────────

const AssistantTurnBlock: React.FC<{
  turn: ConversationTurn;
  artifacts?: Artifact[];
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  localServiceDirectory?: string;
  onOpenLocalService?: (artifact: Artifact) => void;
  showTypingIndicator?: boolean;
  showCopyButtons?: boolean;
  alwaysShowLastAssistantMeta?: boolean;
  planConfirmationMessageId?: string | null;
  onConfirmPlan?: (messageId: string) => void;
  onAdjustPlan?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
  renderToolGroupOverride?: (group: ToolGroupItem) => React.ReactNode;
  hasRunningSubagents?: boolean;
  highlightQuery?: string;
  isStreamingTurn?: boolean;
}> = ({
  turn,
  artifacts,
  resolveLocalFilePath,
  mapDisplayText,
  localServiceDirectory,
  onOpenLocalService,
  showTypingIndicator = false,
  showCopyButtons = true,
  alwaysShowLastAssistantMeta = false,
  planConfirmationMessageId,
  onConfirmPlan,
  onAdjustPlan,
  onForkMessage,
  renderToolGroupOverride,
  hasRunningSubagents = false,
  highlightQuery,
  isStreamingTurn = false,
}) => {
  const [artifactCardsExpanded, setArtifactCardsExpanded] = useState(false);
  const [processExpanded, setProcessExpanded] = useState(false);
  const visibleAssistantItems = getVisibleAssistantItems(turn.assistantItems);

  const renderConsolidatedItem = (
    item: ConsolidatedItem,
    index: number,
    displayVariant: 'timeline' | 'row' = 'timeline',
    rowInitiallyExpanded = false,
  ): React.ReactNode => {
    if (item.type === 'assistant') {
      if (item.message.metadata?.isThinking) {
        return (
          <div key={item.message.id} data-cowork-message-id={item.message.id}>
            <ThinkingBlock
              message={item.message}
              mapDisplayText={mapDisplayText}
              variant={displayVariant === 'row' ? 'row' : 'default'}
              initiallyExpanded={rowInitiallyExpanded}
              highlightQuery={highlightQuery}
            />
          </div>
        );
      }
      const hasToolGroupAfter = visibleAssistantItems.slice(index + 1).some(next => next.type === 'tool_group');
      const isLastAssistant = showCopyButtons && !hasToolGroupAfter;
      return (
        <div key={item.message.id} data-cowork-message-id={item.message.id}>
          <AssistantMessageItem
            message={item.message}
            resolveLocalFilePath={resolveLocalFilePath}
            mapDisplayText={mapDisplayText}
            showCopyButton={isLastAssistant}
            alwaysShowMeta={alwaysShowLastAssistantMeta && isLastAssistant}
            turnMetadata={isLastAssistant ? (item.message.metadata as CoworkMessageMetadata) : undefined}
            planConfirmationMessageId={planConfirmationMessageId}
            onConfirmPlan={onConfirmPlan}
            onAdjustPlan={onAdjustPlan}
            onFork={isLastAssistant ? onForkMessage : undefined}
            afterContent={isLastAssistant ? renderArtifactCards() : undefined}
            highlightQuery={highlightQuery}
          />
        </div>
      );
    }
    if (item.type === 'tool_group') {
      const override = renderToolGroupOverride?.(item.group);
      if (override) {
        return <div key={`tool-${item.group.toolUse.id}`}>{override}</div>;
      }
      const next = visibleAssistantItems[index + 1];
      return (
        <ToolCallGroup
          key={`tool-${item.group.toolUse.id}`}
          group={item.group}
          isLastInSequence={!next || (next.type !== 'tool_group' && next.type !== 'tool_result')}
          mapDisplayText={mapDisplayText}
          variant={displayVariant}
        />
      );
    }
    if (item.type === 'system') {
      const systemMessage = renderSystemMessage(item.message);
      return systemMessage ? <div key={item.message.id}>{systemMessage}</div> : null;
    }
    return <div key={item.message.id}>{renderOrphanToolResult(item.message)}</div>;
  };
  const artifactCards = useMemo(
    () => artifacts
      ? dedupeArtifactsForDisplay(
          artifacts,
          { defaultProjectDirectory: localServiceDirectory },
        )
      : [],
    [artifacts, localServiceDirectory],
  );
  const visibleArtifactCards = useMemo(() => {
    return artifactCardsExpanded ? artifactCards : artifactCards.slice(0, 3);
  }, [artifactCards, artifactCardsExpanded]);
  const hiddenArtifactCardCount = Math.max(0, artifactCards.length - visibleArtifactCards.length);

  const renderArtifactCards = (): React.ReactNode => {
    if (artifactCards.length === 0) return null;
    return (
      <div className="mt-3 space-y-2">
        <div className="artifact-preview-card-group w-full overflow-hidden rounded-lg border border-border">
          <div className="divide-y divide-border">
            {visibleArtifactCards.map(artifact => (
              <ArtifactPreviewCard
                key={artifact.id}
                artifact={artifact}
                onOpenLocalService={onOpenLocalService}
              />
            ))}
          </div>
          {(hiddenArtifactCardCount > 0 || (artifactCardsExpanded && artifactCards.length > 3)) && (
            <div className="border-t border-border px-4 py-2 text-center">
              {hiddenArtifactCardCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setArtifactCardsExpanded(true)}
                  className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-secondary hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.035] transition-colors"
                >
                  <span>{i18nService.t('artifactPreviewCardShowMore').replace('{count}', String(hiddenArtifactCardCount))}</span>
                  <ChevronDownIcon className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setArtifactCardsExpanded(false)}
                  className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-secondary hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.035] transition-colors"
                >
                  <span>{i18nService.t('artifactPreviewCardShowLess')}</span>
                  <ChevronUpIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    setArtifactCardsExpanded(false);
    setProcessExpanded(false);
  }, [turn.id]);

  const renderSystemMessage = (message: CoworkMessage) => {
    const isError = typeof message.metadata?.error === 'string';
    const rawContent = hasText(message.content)
      ? message.content
      : (typeof message.metadata?.error === 'string' ? message.metadata.error : '');
    const errorDetail = parseCoworkErrorDetail(message.metadata?.errorDetail);
    const normalizedRawContent = isError
      ? resolveSystemErrorDisplayText(rawContent, errorDetail)
      : rawContent;
    const normalizedContent = getScheduledReminderDisplayText(normalizedRawContent) ?? normalizedRawContent;
    const content = mapDisplayText ? mapDisplayText(normalizedContent) : normalizedContent;
    if (!content.trim() && !isContextCompactionMessage(message)) return null;
    const errorModelLine = errorDetail ? buildErrorModelLine(errorDetail) : null;

    if (isContextCompactionMessage(message)) {
      const status = message.metadata?.status;
      return (
        <ContextCompactionDivider
          label={getContextCompactionMessageLabel(message, content)}
          active={status === ContextCompactionStatus.Running}
        />
      );
    }

    return (
      <div className="rounded-lg border border-border bg-background px-3 py-2">
        <div className="flex items-center gap-2">
          {isError
            ? <ExclamationTriangleIcon className="h-4 w-4 text-secondary flex-shrink-0" />
            : <InformationCircleIcon className="h-4 w-4 text-secondary flex-shrink-0" />
          }
          <div className="text-xs whitespace-pre-wrap text-secondary">
            {content}
          </div>
        </div>
        {isError && errorModelLine && (
          <div className="mt-1 pl-6 text-xs text-muted">{errorModelLine}</div>
        )}
        {isError && errorDetail && <SystemErrorTechnicalDetail detail={errorDetail} />}
      </div>
    );
  };

  const renderOrphanToolResult = (message: CoworkMessage) => {
    const toolResultDisplayRaw = getToolResultDisplay(message);
    const toolResultDisplay = mapDisplayText ? mapDisplayText(toolResultDisplayRaw) : toolResultDisplayRaw;
    const isToolError = Boolean(message.metadata?.isError || message.metadata?.error);
    const hasToolResultText = hasText(toolResultDisplay);
    const resultLineCount = hasToolResultText ? getToolResultLineCount(toolResultDisplay) : 0;
    const showNoDetailError = isToolError && !hasToolResultText;
    const fallbackText = showNoDetailError ? i18nService.t('coworkToolNoErrorDetail') : '';
    const displayText = hasToolResultText ? toolResultDisplay : fallbackText;
    return (
      <div className="py-1">
        <div className="flex items-start gap-2">
          <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
            isToolError ? 'bg-red-500' : 'bg-surface-raised'
          }`} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-secondary">
              {i18nService.t('coworkToolResult')}
            </div>
            {resultLineCount > 0 && (
              <div className="text-xs text-muted mt-0.5">
                {resultLineCount} {resultLineCount === 1 ? 'line' : 'lines'} of output
              </div>
            )}
            {resultLineCount === 0 && showNoDetailError && (
              <div className={`text-xs mt-0.5 ${
                isToolError
                  ? 'text-red-500/80'
                  : 'text-muted'
              }`}>
                {fallbackText}
              </div>
            )}
            {(hasToolResultText || showNoDetailError) && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-surface-raised max-h-64 overflow-y-auto">
                <pre className={`text-xs whitespace-pre-wrap break-words font-mono ${
                  isToolError
                    ? 'text-red-500'
                    : hasToolResultText
                      ? 'text-foreground'
                      : 'text-secondary italic'
                }`}>
                  {displayText}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderChunks = chunkConsolidatedItemsForDisplay(
    visibleAssistantItems,
    item => isActivityConsolidatedItem(item)
      && !(item.type === 'tool_group' && renderToolGroupOverride?.(item.group)),
  );
  const answerStartIndex = getTurnAnswerStartIndex(renderChunks);
  const processChunks = renderChunks.slice(0, answerStartIndex);
  const answerChunks = renderChunks.slice(answerStartIndex);
  const shouldFoldProcess = !isStreamingTurn && !hasRunningSubagents && processChunks.length > 0;
  const processStart = getTurnStartTimestamp(turn);
  const processEnd = getTurnEndTimestamp(turn);
  const processDuration = processStart != null && processEnd != null
    ? Math.max(0, processEnd - processStart)
    : null;
  const processLabel = processDuration != null && processDuration >= 1000
    ? i18nService.t('coworkTurnProcessDuration').replace('{duration}', formatTurnDuration(processDuration))
    : i18nService.t('coworkTurnProcess');
  const renderChunk = (chunk: (typeof renderChunks)[number], index: number): React.ReactNode => (
    chunk.kind === 'item'
      ? renderConsolidatedItem(chunk.item, chunk.index)
      : (
        <ActivityGroupBlock
          key={`activity-${chunk.entries[0].item.type}-${chunk.entries[0].index}`}
          entries={chunk.entries}
          isStreamingTail={showTypingIndicator && index === renderChunks.length - 1}
          renderEntry={(entry, options) => renderConsolidatedItem(
            entry.item,
            entry.index,
            'row',
            options?.initiallyExpanded,
          )}
        />
      )
  );

  return (
    <div className={`py-2 ${COWORK_DETAIL_GUTTER_CLASS}`}>
      <div className={COWORK_DETAIL_CONTENT_CLASS}>
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0 py-3 space-y-3">
            {shouldFoldProcess ? (
              <>
                <div className="py-1">
                  <button
                    type="button"
                    onClick={() => setProcessExpanded(value => !value)}
                    className="group flex max-w-full items-center gap-1.5 text-left"
                    aria-expanded={processExpanded}
                  >
                    <span className="min-w-0 truncate text-sm text-secondary transition-colors group-hover:text-foreground">{processLabel}</span>
                    <ChevronRightIcon className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-200 group-hover:text-secondary ${processExpanded ? 'rotate-90' : ''}`} />
                  </button>
                </div>
                {processExpanded && processChunks.map((chunk, index) => renderChunk(chunk, index))}
                {answerChunks.map((chunk, index) => renderChunk(chunk, answerStartIndex + index))}
              </>
            ) : (
              renderChunks.map(renderChunk)
            )}
            {!visibleAssistantItems.some(item => item.type === 'assistant' && !item.message.metadata?.isThinking)
              && renderArtifactCards()}
            {showTypingIndicator && (
              <ActivityIndicator
                fingerprint={getTurnActivityFingerprint(turn)}
                hasContent={visibleAssistantItems.length > 0}
                startTimestamp={getTurnStartTimestamp(turn)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export { ContextCompactionDivider };

export default AssistantTurnBlock;
