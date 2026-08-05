import React, { useCallback, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import { formatMessageDateTime } from '../../utils/tokenFormat';
import MessageForkIcon from '../icons/MessageForkIcon';
import MarkdownContent from '../MarkdownContent';
import ImagePreviewModal, { type ImagePreviewSource } from './ImagePreviewModal';
import { MessageActionButton, MessageCopyButton } from './MessageActionButton';
import {
  getMessageModelLabel,
  MEDIA_TOKEN_DISPLAY_RE,
  messageMetaClassName,
} from './messageDisplayUtils';
import ProposedPlanBlock from './ProposedPlanBlock';
import { parseProposedPlanBlock } from './proposedPlanParser';

export { MessageCopyButton as CopyButton } from './MessageActionButton';

// ── AssistantMessageItem ─────────────────────────────────────────────────────

const AssistantMessageItem: React.FC<{
  message: CoworkMessage;
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showCopyButton?: boolean;
  alwaysShowMeta?: boolean;
  turnMetadata?: CoworkMessageMetadata | null;
  planConfirmationMessageId?: string | null;
  onConfirmPlan?: (messageId: string) => void;
  onAdjustPlan?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
}> = ({
  message,
  resolveLocalFilePath,
  mapDisplayText,
  showCopyButton = false,
  alwaysShowMeta = false,
  turnMetadata,
  planConfirmationMessageId,
  onConfirmPlan,
  onAdjustPlan,
  onFork,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const rawContent = mapDisplayText ? mapDisplayText(message.content) : message.content;
  const parsedPlan = parseProposedPlanBlock(rawContent);
  const displayContent = parsedPlan.visibleText.replace(MEDIA_TOKEN_DISPLAY_RE, '').trimEnd();
  const copyContent = rawContent.replace(MEDIA_TOKEN_DISPLAY_RE, '').trimEnd();
  const showPlanConfirmationActions = planConfirmationMessageId === message.id;
  const modelLabel = getMessageModelLabel(turnMetadata);
  const metaVisible = alwaysShowMeta || isHovered;
  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsHovered(false);
  }, []);
  const handleMouseLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (document.activeElement instanceof HTMLElement && event.currentTarget.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    setIsHovered(false);
  }, []);

  return (
    <div
      className="relative focus:outline-none"
      tabIndex={showCopyButton ? 0 : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setIsHovered(true)}
      onBlur={handleBlur}
    >
      <div className="text-foreground">
        <div className="space-y-3">
          {displayContent && (
            <MarkdownContent
              content={displayContent}
              className="prose dark:prose-invert max-w-none"
              resolveLocalFilePath={resolveLocalFilePath}
              showRevealInFolderAction
              onImageClick={setExpandedImage}
            />
          )}
          {parsedPlan.planText && (
            <ProposedPlanBlock
              content={parsedPlan.planText}
              resolveLocalFilePath={resolveLocalFilePath}
              onImageClick={setExpandedImage}
              showConfirmationActions={showPlanConfirmationActions}
              onConfirmExecution={showPlanConfirmationActions ? () => onConfirmPlan?.(message.id) : undefined}
              onAdjustPlan={showPlanConfirmationActions ? () => onAdjustPlan?.(message.id) : undefined}
            />
          )}
        </div>
      </div>
      {showCopyButton && (
        <div className={messageMetaClassName(metaVisible)} aria-hidden={!metaVisible}>
          <span>{formatMessageDateTime(message.timestamp)}</span>
          {modelLabel && <span>{modelLabel}</span>}
          {onFork && (
            <MessageActionButton
              label={i18nService.t('coworkForkFromMessage')}
              visible={metaVisible}
              onClick={(event) => {
                event.stopPropagation();
                onFork(message.id);
              }}
            >
              <MessageForkIcon className="h-4 w-4" />
            </MessageActionButton>
          )}
          <MessageCopyButton
            content={copyContent}
            visible={metaVisible}
          />
        </div>
      )}
      <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />
    </div>
  );
};

export default AssistantMessageItem;
