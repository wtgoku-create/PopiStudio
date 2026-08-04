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

const flushText = (
  nodes: React.ReactNode[],
  buffer: string[],
  keyPrefix: string,
): void => {
  if (buffer.length === 0) return;
  const text = buffer.join('\n');
  buffer.length = 0;
  if (!text.trim()) return;
  nodes.push(
    <div
      key={`${keyPrefix}-${nodes.length}`}
      className="whitespace-pre-wrap break-words text-foreground/90"
    >
      {text}
    </div>
  );
};

const renderUserMessageParts = (
  content: string,
  onImageClick?: (image: { src: string; alt?: string | null }) => void,
): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const textBuffer: string[] = [];

  content.split('\n').forEach((line, index) => {
    if (!MARKDOWN_IMAGE_LINE_RE.test(line)) {
      textBuffer.push(line);
      return;
    }

    flushText(nodes, textBuffer, `text-${index}`);
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

  flushText(nodes, textBuffer, 'text-tail');
  return nodes;
};

interface UserMessageContentProps {
  content: string;
  promptDocument?: CoworkPromptDocument;
  className?: string;
  onImageClick?: (image: { src: string; alt?: string | null }) => void;
}

const UserMessageContent: React.FC<UserMessageContentProps> = ({
  content,
  promptDocument,
  className = '',
  onImageClick,
}) => {
  return (
    <div className={`min-w-0 max-w-full text-[15px] leading-[23px] ${className}`}>
      {promptDocument ? (
        <div className="whitespace-pre-wrap break-words text-foreground/90">
          {promptDocument.segments.map((segment, index) => {
            if (segment.kind === CoworkPromptSegmentKind.Text) {
              return <React.Fragment key={`text-${index}`}>{segment.text}</React.Fragment>;
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
      ) : renderUserMessageParts(content, onImageClick)}
    </div>
  );
};

export default UserMessageContent;
