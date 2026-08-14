import { CheckIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { selectIsStreaming } from '../../store/selectors/coworkSelectors';
import DiffView, { extractDiffFromToolInput } from './DiffView';
import {
  formatToolInput,
  getLargeToolResultSummary,
  getToolDisplayName,
  getToolInputSummary,
  getToolResultCollapsedDisplay,
  getToolResultDisplay,
  getToolResultLineCountSummary,
  getToolStepDisplay,
  hasText,
  isBashLikeToolName,
  isCronToolName,
  isTodoWriteToolName,
  type ParsedTodoItem,
  parseTodoWriteItems,
  type TodoStatus,
  type ToolGroupItem,
  truncatePreview,
} from './messageDisplayUtils';

const ToolRunningElapsed: React.FC<{ startTimestamp: number }> = ({ startTimestamp }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);
  const elapsedSeconds = Math.max(0, Math.floor((now - startTimestamp) / 1000));
  if (elapsedSeconds < 2) return null;
  return <span className="tabular-nums"> · {elapsedSeconds}s</span>;
};

// ── TodoWriteInputView ───────────────────────────────────────────────────────

const TodoWriteInputView: React.FC<{ items: ParsedTodoItem[] }> = ({ items }) => {
  const getStatusCheckboxClass = (status: TodoStatus): string => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/10 border-green-500 text-green-500';
      case 'in_progress':
        return 'bg-transparent border-blue-500';
      case 'pending':
      case 'unknown':
      default:
        return 'bg-transparent border-border';
    }
  };

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div
          key={`todo-item-${index}`}
          className="flex items-start gap-2"
        >
          <span className={`mt-0.5 h-4 w-4 rounded-[4px] border flex-shrink-0 inline-flex items-center justify-center ${getStatusCheckboxClass(item.status)}`}>
            {item.status === 'completed' && <CheckIcon className="h-3 w-3 stroke-[2.5]" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className={`text-xs whitespace-pre-wrap break-words leading-5 ${
              item.status === 'completed'
                ? 'text-muted'
                : 'text-foreground'
            }`}>
              {item.primaryText}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

// ── ToolCallGroup ────────────────────────────────────────────────────────────

const ToolCallGroup: React.FC<{
  group: ToolGroupItem;
  isLastInSequence?: boolean;
  mapDisplayText?: (value: string) => string;
  footer?: React.ReactNode;
  variant?: 'timeline' | 'row';
  initiallyExpanded?: boolean;
}> = ({
  group,
  isLastInSequence = true,
  mapDisplayText,
  footer,
  variant = 'timeline',
  initiallyExpanded = false,
}) => {
  const { toolUse, toolResult } = group;
  const rawToolName = typeof toolUse.metadata?.toolName === 'string' ? toolUse.metadata.toolName : 'Tool';
  const toolName = getToolDisplayName(rawToolName);
  const toolInput = toolUse.metadata?.toolInput;
  const isCronTool = isCronToolName(rawToolName);
  const isTodoWriteTool = isTodoWriteToolName(rawToolName);
  const todoItems = isTodoWriteTool ? parseTodoWriteItems(toolInput) : null;
  const mapText = mapDisplayText ?? ((value: string) => value);
  const toolInputDisplayRaw = formatToolInput(rawToolName, toolInput);
  const toolInputDisplay = toolInputDisplayRaw ? mapText(toolInputDisplayRaw) : null;
  const toolInputSummaryRaw = getToolInputSummary(rawToolName, toolInput) ?? toolInputDisplayRaw;
  const toolInputSummary = toolInputSummaryRaw ? mapText(toolInputSummaryRaw) : null;
  const isSessionStreaming = useSelector(selectIsStreaming);
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const collapsedToolResult = useMemo(
    () => toolResult ? getToolResultCollapsedDisplay(toolResult) : null,
    [toolResult],
  );
  const toolResultDisplayRaw = useMemo(
    () => toolResult && isExpanded ? getToolResultDisplay(toolResult) : '',
    [isExpanded, toolResult],
  );
  const toolResultDisplay = toolResultDisplayRaw ? mapText(toolResultDisplayRaw) : '';
  const hasExpandedToolResultText = hasText(toolResultDisplay);
  const hasToolResultText = isExpanded
    ? hasExpandedToolResultText
    : Boolean(collapsedToolResult?.hasText);
  const isToolError = Boolean(toolResult?.metadata?.isError || toolResult?.metadata?.error);
  const showNoDetailError = isToolError && !hasToolResultText;
  const toolResultFallback = showNoDetailError ? i18nService.t('coworkToolNoErrorDetail') : '';
  const displayToolResult = hasExpandedToolResultText ? toolResultDisplay : toolResultFallback;
  const collapsedToolResultPreview = collapsedToolResult?.text
    ? mapText(collapsedToolResult.text)
    : '';
  const toolResultSummary = (() => {
    if (!collapsedToolResult?.hasText) return null;
    if (isCronTool && hasText(collapsedToolResultPreview)) {
      return truncatePreview(collapsedToolResultPreview.replace(/\s+/g, ' '));
    }
    if (collapsedToolResult.isLarge && collapsedToolResult.sizeLabel) {
      return getLargeToolResultSummary(collapsedToolResult.sizeLabel);
    }
    return getToolResultLineCountSummary(collapsedToolResult.lineCount);
  })();

  const isBashTool = isBashLikeToolName(rawToolName);

  const diffDataList = useMemo(
    () => extractDiffFromToolInput(rawToolName, toolInput as Record<string, unknown> | undefined),
    [rawToolName, toolInput],
  );
  const isEditWithDiff = diffDataList !== null && diffDataList.length > 0;
  const rowStep = variant === 'row'
    ? getToolStepDisplay(rawToolName, toolInput as Record<string, unknown> | undefined)
    : null;

  return (
    <div className={`relative ${variant === 'timeline' ? 'py-1' : ''}`}>
      {variant === 'timeline' && !isLastInSequence && (
        <div className="absolute left-[3.5px] top-[14px] bottom-[-8px] w-px bg-border" />
      )}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex gap-2 text-left group relative z-10 transition-colors ${variant === 'row' ? 'items-center px-4 py-2 hover:bg-surface-raised/40' : 'items-start'}`}
      >
        <span className={`${variant === 'row' ? 'w-1.5 h-1.5' : 'mt-1.5 w-2 h-2'} rounded-full flex-shrink-0 ${
          !toolResult
            ? 'bg-blue-500 animate-pulse'
            : isToolError
              ? 'bg-red-500'
              : variant === 'row'
                ? 'hidden'
                : 'bg-green-500'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium ${variant === 'row' ? 'text-xs text-foreground/90 flex-shrink-0' : 'text-sm text-secondary'} ${!toolResult && isSessionStreaming ? 'shimmer-text' : ''}`}>
              {toolName}
            </span>
            {variant === 'row' && rowStep?.summary && (
              <span className="min-w-0 truncate text-xs text-secondary">
                {rowStep.summary}
              </span>
            )}
            {variant === 'row' && !toolResult && isSessionStreaming && typeof toolUse.timestamp === 'number' && (
              <span className="text-xs text-muted flex-shrink-0">
                <ToolRunningElapsed startTimestamp={toolUse.timestamp} />
              </span>
            )}
            {variant === 'timeline' && toolInputSummary && (
              <code className="text-xs text-muted font-mono truncate max-w-full">
                {toolInputSummary}
              </code>
            )}
          </div>
          {variant === 'timeline' && toolResult && !isTodoWriteTool && (hasToolResultText || showNoDetailError) && (
            <div className={`text-xs mt-0.5 ${
              hasToolResultText
                ? 'text-muted'
                : showNoDetailError
                  ? 'text-red-500/80'
                  : 'text-muted'
              }`}>
              {hasToolResultText
                ? toolResultSummary
                : toolResultFallback}
            </div>
          )}
          {!toolResult && (
            <div className="text-xs text-muted mt-0.5">
              {i18nService.t('coworkToolRunning')}
            </div>
          )}
        </div>
        {variant === 'row' && (
          <ChevronRightIcon
            className={`h-3 w-3 text-muted flex-shrink-0 transition-transform duration-200 ${
              isExpanded ? 'rotate-90' : ''
            }`}
          />
        )}
      </button>
      {footer && (
        <div className={variant === 'row' ? 'px-4 pb-3' : 'ml-4 mt-2'}>
          {footer}
        </div>
      )}
      {isExpanded && (
        <div className={`${variant === 'row' ? 'activity-row-detail px-4 pb-3' : 'ml-4 mt-2'}`}>
          {isBashTool ? (
            <div className="rounded-lg overflow-hidden border border-border">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-surfaceInset">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <span className="ml-2 text-[10px] text-secondary font-medium">Terminal</span>
              </div>
              <div className="bg-surface-inset px-3 py-3 max-h-72 overflow-y-auto font-mono text-xs">
                {toolInputDisplay && (
                  <div className="text-foreground">
                    <span className="text-primary select-none">$ </span>
                    <span className="whitespace-pre-wrap break-words">{toolInputDisplay}</span>
                  </div>
                )}
                {toolResult && (hasExpandedToolResultText || showNoDetailError) && (
                  <div className={`mt-1.5 whitespace-pre-wrap break-words ${
                    isToolError
                      ? 'text-red-400'
                      : hasExpandedToolResultText
                        ? 'text-secondary'
                        : 'text-muted italic'
                  }`}>
                    {displayToolResult}
                  </div>
                )}
                {!toolResult && (
                  <div className="text-muted mt-1.5 italic">
                    {i18nService.t('coworkToolRunning')}
                  </div>
                )}
              </div>
            </div>
          ) : isTodoWriteTool && todoItems ? (
            <TodoWriteInputView items={todoItems} />
          ) : isEditWithDiff && diffDataList ? (
            <div className="space-y-2">
              {diffDataList.map((diff, idx) => (
                <DiffView
                  key={idx}
                  oldStr={diff.oldStr}
                  newStr={diff.newStr}
                  filePath={diff.filePath}
                />
              ))}
              {toolResult && (hasExpandedToolResultText || showNoDetailError) && (
                <div>
                  <div className="text-[10px] font-medium dark:text-claude-darkTextSecondary/70 text-claude-textSecondary/70 uppercase tracking-wider mb-1">
                    {i18nService.t('coworkToolResult')}
                  </div>
                  <div className="max-h-32 overflow-y-auto">
                    <pre className={`text-xs whitespace-pre-wrap break-words font-mono ${
                      isToolError
                        ? 'text-red-500'
                        : hasExpandedToolResultText
                          ? 'dark:text-claude-darkText text-claude-text'
                          : 'dark:text-claude-darkTextSecondary text-claude-textSecondary italic'
                    }`}>
                      {displayToolResult}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {toolInputDisplay && (
                <div>
                  <div className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1">
                    {i18nService.t('coworkToolInput')}
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <pre className="text-xs text-foreground whitespace-pre-wrap break-words font-mono">
                      {toolInputDisplay}
                    </pre>
                  </div>
                </div>
              )}
              {toolResult && (hasExpandedToolResultText || showNoDetailError) && (
                <div>
                  <div className="text-[10px] font-medium text-muted uppercase tracking-wider mb-1">
                    {i18nService.t('coworkToolResult')}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <pre className={`text-xs whitespace-pre-wrap break-words font-mono ${
                      isToolError
                        ? 'text-red-500'
                        : hasExpandedToolResultText
                          ? 'text-foreground'
                          : 'text-secondary italic'
                    }`}>
                      {displayToolResult}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallGroup;
