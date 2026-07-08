import React, { useCallback, useState } from 'react';

import type { CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import { formatMessageDateTime } from '../../utils/tokenFormat';
import MarkdownContent from '../MarkdownContent';
import ImagePreviewModal, { type ImagePreviewSource } from './ImagePreviewModal';
import { MessageCopyButton } from './MessageActionButton';
import {
  getMessageModelLabel,
  MEDIA_TOKEN_DISPLAY_RE,
  messageMetaClassName,
} from './messageDisplayUtils';

export { MessageCopyButton as CopyButton } from './MessageActionButton';

// ── AssistantMessageItem ─────────────────────────────────────────────────────

const AssistantMessageItem: React.FC<{
  message: CoworkMessage;
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  mapDisplayText?: (value: string) => string;
  showCopyButton?: boolean;
  turnMetadata?: CoworkMessageMetadata | null;
}> = ({
  message,
  resolveLocalFilePath,
  mapDisplayText,
  showCopyButton = false,
  turnMetadata,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const rawContent = mapDisplayText ? mapDisplayText(message.content) : message.content;
  const displayContent = rawContent.replace(MEDIA_TOKEN_DISPLAY_RE, '').trimEnd();
  const modelLabel = getMessageModelLabel(turnMetadata);
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
        <MarkdownContent
          content={displayContent}
          className="prose dark:prose-invert max-w-none"
          resolveLocalFilePath={resolveLocalFilePath}
          showRevealInFolderAction
          onImageClick={setExpandedImage}
        />
      </div>
      {showCopyButton && (
        <div className={messageMetaClassName(isHovered)} aria-hidden={!isHovered}>
          <span>{formatMessageDateTime(message.timestamp)}</span>
          {modelLabel && <span>{modelLabel}</span>}
          <MessageCopyButton
            content={displayContent}
            visible={isHovered}
          />
        </div>
      )}
      <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />
    </div>
  );
};

export default AssistantMessageItem;
