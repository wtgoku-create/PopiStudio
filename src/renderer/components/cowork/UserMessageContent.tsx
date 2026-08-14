import React from 'react';

import {
  type CoworkPromptDocument,
  CoworkPromptSegmentKind,
} from '../../../shared/cowork/promptDocument';
import MarkdownContent from '../MarkdownContent';
import CoworkResourceChip from './CoworkResourceChip';
import CoworkSkillChip from './CoworkSkillChip';

const MARKDOWN_IMAGE_LINE_RE = /^\s*!\[[^\]]*\]\((?:file|localfile|https?|data|blob):[^)]+\)\s*$/i;
const USER_MESSAGE_IMAGE_CLASS_NAME = 'my-2 h-32 w-32 shrink-0 rounded-lg border border-border object-cover';
const USER_MESSAGE_TEXT_CLASS_NAME = 'whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground/90';

const highlightUserText = (value: string, query?: string): React.ReactNode => {
  const normalized = query?.trim();
  if (!normalized) return value;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.split(new RegExp(`(${escaped})`, 'gi')).map((part, index) => (
    part.toLocaleLowerCase() === normalized.toLocaleLowerCase()
      ? <mark key={`${part}-${index}`} className="cowork-search-highlight">{part}</mark>
      : part
  ));
};

const flushText = (
  nodes: React.ReactNode[],
  buffer: string[],
  keyPrefix: string,
  highlightQuery?: string,
): void => {
  if (buffer.length === 0) return;
  const text = buffer.join('\n');
  buffer.length = 0;
  if (!text.trim()) return;
  nodes.push(
    <div
      key={`${keyPrefix}-${nodes.length}`}
      className={USER_MESSAGE_TEXT_CLASS_NAME}
    >
      {highlightUserText(text, highlightQuery)}
    </div>
  );
};

const renderUserMessageParts = (
  content: string,
  onImageClick?: (image: { src: string; alt?: string | null }) => void,
  highlightQuery?: string,
): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const textBuffer: string[] = [];

  content.split('\n').forEach((line, index) => {
    if (!MARKDOWN_IMAGE_LINE_RE.test(line)) {
      textBuffer.push(line);
      return;
    }

    flushText(nodes, textBuffer, `text-${index}`, highlightQuery);
    nodes.push(
      <MarkdownContent
        key={`image-${index}`}
        content={line.trim()}
        spacing="compact"
        className="max-w-none"
        imageClassName={USER_MESSAGE_IMAGE_CLASS_NAME}
        onImageClick={onImageClick}
      />
    );
  });

  flushText(nodes, textBuffer, 'text-tail', highlightQuery);
  return nodes;
};

interface UserMessageContentProps {
  content: string;
  promptDocument?: CoworkPromptDocument;
  className?: string;
  onImageClick?: (image: { src: string; alt?: string | null }) => void;
  highlightQuery?: string;
}

const UserMessageContent: React.FC<UserMessageContentProps> = ({
  content,
  promptDocument,
  className = '',
  onImageClick,
  highlightQuery,
}) => {
  return (
    <div className={`min-w-0 max-w-full text-[15px] leading-[23px] ${className}`}>
      {promptDocument ? (
        <div className={USER_MESSAGE_TEXT_CLASS_NAME}>
          {promptDocument.segments.map((segment, index) => {
            if (segment.kind === CoworkPromptSegmentKind.Text) {
              return <React.Fragment key={`text-${index}`}><MarkdownContent content={segment.text} highlightQuery={highlightQuery} /></React.Fragment>;
            }
            if (segment.kind === CoworkPromptSegmentKind.Resource) {
              const resource = promptDocument.resources.find(item => item.id === segment.resourceId);
              if (!resource) return null;
              return (
                <CoworkResourceChip
                  key={`resource-${segment.resourceId}-${index}`}
                  name={resource.name}
                  path={resource.path}
                />
              );
            }
            const skill = promptDocument.skills?.find(item => item.id === segment.skillId);
            if (!skill) return null;
            return (
              <CoworkSkillChip
                key={`skill-${segment.skillId}-${index}`}
                name={skill.name}
                path={skill.location}
                description={skill.description}
              />
            );
          })}
        </div>
      ) : renderUserMessageParts(content, onImageClick, highlightQuery)}
    </div>
  );
};

export default UserMessageContent;
