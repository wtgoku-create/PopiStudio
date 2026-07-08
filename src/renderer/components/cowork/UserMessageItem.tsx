import { PhotoIcon } from '@heroicons/react/24/outline';
import React, { useCallback, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import type { CoworkImageAttachment, CoworkMessage, CoworkMessageMetadata } from '../../types/cowork';
import type { Skill } from '../../types/skill';
import { formatMessageDateTime } from '../../utils/tokenFormat';
import { parseUserMessageForDisplay } from '../../utils/userMessageDisplay';
import AcademicCapIcon from '../icons/AcademicCapIcon';
import EditIcon from '../icons/EditIcon';
import PaperClipIcon from '../icons/PaperClipIcon';
import SkillIcon from '../icons/SkillIcon';
import MarkdownContent from '../MarkdownContent';
import ImagePreviewModal, { type ImagePreviewSource } from './ImagePreviewModal';
import { MessageCopyButton } from './MessageActionButton';
import {
  COWORK_DETAIL_CONTENT_CLASS,
  COWORK_DETAIL_GUTTER_CLASS,
  getMessageModelLabel,
  messageMetaClassName,
} from './messageDisplayUtils';

// ── ReEditButton ─────────────────────────────────────────────────────────────

const ReEditButton: React.FC<{
  visible: boolean;
  onClick: () => void;
}> = ({ visible, onClick }) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`p-1.5 rounded-md hover:bg-surface-raised transition-all duration-200 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      tabIndex={visible ? 0 : -1}
      title={i18nService.t('coworkReEdit')}
    >
      <EditIcon className="w-4 h-4 text-[var(--icon-secondary)]" />
    </button>
  );
};

// ── UserMessageSkillBadges ───────────────────────────────────────────────────

const UserMessageSkillBadges: React.FC<{ skills: Skill[] }> = ({ skills }) => {
  if (skills.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {skills.map(skill => (
        <div
          key={skill.id}
          className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-[13px] font-normal leading-none text-foreground"
          title={skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description, skill)}
        >
          <SkillIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 truncate">
            {skillService.getLocalizedSkillName(skill)}
          </span>
        </div>
      ))}
    </div>
  );
};

// ── UserMessageItem ──────────────────────────────────────────────────────────

const UserMessageKnowledgeBadges: React.FC<{
  bases: NonNullable<CoworkMessageMetadata['knowledgeBases']>;
  files: NonNullable<CoworkMessageMetadata['knowledgeFiles']>;
}> = ({ bases, files }) => {
  if (bases.length === 0 && files.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {bases.map(base => (
        <div
          key={`kb:${base.id}`}
          className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-[13px] font-normal leading-none text-foreground"
          title={i18nService.t('knowledgeBase')}
        >
          <AcademicCapIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 truncate">{base.name || base.id}</span>
        </div>
      ))}
      {files.map(file => (
        <div
          key={`knowledge:${file.id}`}
          className="inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-[13px] font-normal leading-none text-foreground"
          title={file.knowledgeBaseName || i18nService.t('knowledgeRecentFiles')}
        >
          <PaperClipIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 truncate">{file.title || file.id}</span>
        </div>
      ))}
    </div>
  );
};

const UserMessageItem: React.FC<{
  message: CoworkMessage;
  skills: Skill[];
  onReEdit?: (message: CoworkMessage) => void;
}> = React.memo(({ message, skills, onReEdit }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const modelLabel = getMessageModelLabel(message.metadata);
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

  const displayContent = useMemo(
    () => parseUserMessageForDisplay(message.content || ''),
    [message.content]
  );

  const messageSkillIds = (message.metadata as CoworkMessageMetadata)?.skillIds || [];
  const messageSkills = messageSkillIds
    .map(id => skills.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  const messageKnowledgeBases = ((message.metadata as CoworkMessageMetadata)?.knowledgeBases ?? [])
    .filter((base): base is { id: string; name: string } => Boolean(base?.id));
  const messageKnowledgeFiles = ((message.metadata as CoworkMessageMetadata)?.knowledgeFiles ?? [])
    .filter((file): file is { id: string; title: string; knowledgeBaseName?: string; fileType?: string } => Boolean(file?.id));
  const hasContextBadges = messageSkills.length > 0 || messageKnowledgeBases.length > 0 || messageKnowledgeFiles.length > 0;

  const imageAttachments = ((message.metadata as CoworkMessageMetadata)?.imageAttachments ?? []) as CoworkImageAttachment[];

  return (
    <div
      className={`py-2 ${COWORK_DETAIL_GUTTER_CLASS} focus:outline-none`}
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setIsHovered(true)}
      onBlur={handleBlur}
    >
      <div className={COWORK_DETAIL_CONTENT_CLASS}>
        <div>
          <div className="flex items-start gap-3 flex-row-reverse">
            <div className="w-full min-w-0 flex flex-col items-end">
              <div className="w-fit max-w-full rounded-2xl px-4 py-2.5 bg-surface text-foreground shadow-subtle">
                {hasContextBadges && (
                  <div className={(displayContent?.trim() || imageAttachments.length > 0) ? 'mb-2' : ''}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <UserMessageSkillBadges skills={messageSkills} />
                      <UserMessageKnowledgeBadges bases={messageKnowledgeBases} files={messageKnowledgeFiles} />
                    </div>
                  </div>
                )}
                {displayContent?.trim() && (
                  <MarkdownContent
                    content={displayContent}
                    className="max-w-none whitespace-pre-wrap break-words"
                    onImageClick={setExpandedImage}
                  />
                )}
                {imageAttachments.length > 0 && (
                  <div className={`flex flex-wrap gap-2 ${displayContent?.trim() ? 'mt-2' : ''}`}>
                    {imageAttachments.map((img, idx) => (
                      <div key={idx} className="relative group">
                        <img
                          src={`data:${img.mimeType};base64,${img.base64Data}`}
                          alt={img.name}
                          className="max-h-48 max-w-[16rem] rounded-lg object-contain cursor-pointer border border-border hover:border-primary transition-colors"
                          title={img.name}
                          onClick={() => setExpandedImage({
                            src: `data:${img.mimeType};base64,${img.base64Data}`,
                            alt: img.name,
                            name: img.name,
                          })}
                        />
                        <div className="absolute bottom-1 left-1 right-1 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/50 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity truncate pointer-events-none">
                          <PhotoIcon className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{img.name}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className={messageMetaClassName(isHovered, 'right')} aria-hidden={!isHovered}>
                <span>{formatMessageDateTime(message.timestamp)}</span>
                {modelLabel && <span>{modelLabel}</span>}
                <MessageCopyButton
                  content={message.content}
                  visible={isHovered}
                />
                {onReEdit && (
                  <ReEditButton
                    visible={isHovered}
                    onClick={() => onReEdit(message)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />
    </div>
  );
});

export default UserMessageItem;
