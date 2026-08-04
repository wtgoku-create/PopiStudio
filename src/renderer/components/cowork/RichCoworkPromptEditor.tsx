import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import {
  $applyNodeReplacement,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_HIGH,
  DecoratorNode,
  type EditorState,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from 'lexical';
import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';

import {
  type CoworkPromptDocument,
  CoworkPromptDocumentVersion,
  CoworkPromptResourceSource,
  CoworkPromptResourceTransport,
  CoworkPromptSegmentKind,
  type CoworkPromptSkill,
  getCoworkPromptDocumentText,
} from '../../../shared/cowork/promptDocument';
import type { DraftAttachment } from '../../store/slices/coworkSlice';
import CoworkResourceChip from './CoworkResourceChip';
import CoworkSkillChip from './CoworkSkillChip';

export interface RichCoworkPromptEditorRef {
  focus: () => void;
  setText: (text: string) => void;
  setDocument: (document: CoworkPromptDocument) => void;
  setConfiguredSkills: (skills: CoworkPromptSkill[]) => void;
  getDocument: () => CoworkPromptDocument;
  replaceTextAroundCaret: (beforeCount: number, afterCount: number, replacement: string) => boolean;
  insertAttachment: (attachment: DraftAttachment) => void;
  insertSkill: (skill: CoworkPromptSkill) => void;
}

interface RichCoworkPromptEditorProps {
  value: string;
  attachments: DraftAttachment[];
  placeholder: string;
  disabled?: boolean;
  className?: string;
  minHeight?: number;
  maxHeight?: number;
  autoFocus?: boolean;
  onChange: (value: string, caretIndex: number) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onPaste: (event: React.ClipboardEvent<HTMLElement>) => void;
  onRemoveAttachment: (path: string) => void;
}

interface SerializedCoworkAttachmentNode extends SerializedLexicalNode {
  attachment: DraftAttachment;
}

interface SerializedCoworkSkillNode extends SerializedLexicalNode {
  skill: CoworkPromptSkill;
}

const CoworkAttachmentNodeType = 'cowork-attachment';
const CoworkSkillNodeType = 'cowork-skill';
const RichCoworkPromptEditorKey = `${CoworkAttachmentNodeType}:${CoworkSkillNodeType}:${Date.now()}`;
const ProgrammaticEditorUpdateTag = 'cowork-rich-editor-programmatic';
const RichCoworkPromptEditorEvent = {
  RemoveAttachment: 'cowork:remove-rich-attachment',
  RemoveSkill: 'cowork:remove-rich-skill',
} as const;

const dispatchRemoveAttachment = (path: string) => {
  window.dispatchEvent(new CustomEvent(RichCoworkPromptEditorEvent.RemoveAttachment, {
    detail: { path },
  }));
};

const dispatchRemoveSkill = (nodeKey: NodeKey) => {
  window.dispatchEvent(new CustomEvent(RichCoworkPromptEditorEvent.RemoveSkill, {
    detail: { nodeKey },
  }));
};

class CoworkAttachmentNode extends DecoratorNode<React.ReactNode> {
  __attachment: DraftAttachment;

  static getType(): string {
    return CoworkAttachmentNodeType;
  }

  static clone(node: CoworkAttachmentNode): CoworkAttachmentNode {
    return new CoworkAttachmentNode(node.__attachment, node.__key);
  }

  static importJSON(serializedNode: SerializedLexicalNode & Record<string, unknown>): CoworkAttachmentNode {
    return new CoworkAttachmentNode(serializedNode.attachment as DraftAttachment);
  }

  constructor(attachment: DraftAttachment, key?: NodeKey) {
    super(key);
    this.__attachment = attachment;
  }

  exportJSON(): SerializedCoworkAttachmentNode {
    return {
      ...super.exportJSON(),
      type: CoworkAttachmentNodeType,
      version: 1,
      attachment: this.__attachment,
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'inline-block align-middle leading-none';
    return element;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactNode {
    return (
      <CoworkResourceChip
        name={this.__attachment.name}
        path={this.__attachment.path}
        onRemove={() => dispatchRemoveAttachment(this.__attachment.path)}
      />
    );
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  getTextContent(): string {
    return '';
  }

  getPath(): string {
    return this.__attachment.path;
  }

  getAttachment(): DraftAttachment {
    return this.__attachment;
  }
}

class CoworkSkillNode extends DecoratorNode<React.ReactNode> {
  __skill: CoworkPromptSkill;

  static getType(): string {
    return CoworkSkillNodeType;
  }

  static clone(node: CoworkSkillNode): CoworkSkillNode {
    return new CoworkSkillNode(node.__skill, node.__key);
  }

  static importJSON(serializedNode: SerializedLexicalNode & Record<string, unknown>): CoworkSkillNode {
    return new CoworkSkillNode(serializedNode.skill as CoworkPromptSkill);
  }

  constructor(skill: CoworkPromptSkill, key?: NodeKey) {
    super(key);
    this.__skill = skill;
  }

  exportJSON(): SerializedCoworkSkillNode {
    return {
      ...super.exportJSON(),
      type: CoworkSkillNodeType,
      version: 1,
      skill: this.__skill,
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = 'inline-block align-middle leading-none';
    return element;
  }

  updateDOM(): false {
    return false;
  }

  decorate(): React.ReactNode {
    return (
      <CoworkSkillChip
        name={this.__skill.name}
        description={this.__skill.description}
        onRemove={() => dispatchRemoveSkill(this.getKey())}
      />
    );
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): true {
    return true;
  }

  getTextContent(): string {
    return '';
  }

  getSkill(): CoworkPromptSkill {
    return this.__skill;
  }
}

const $createCoworkAttachmentNode = (attachment: DraftAttachment): CoworkAttachmentNode => {
  return $applyNodeReplacement(new CoworkAttachmentNode(attachment));
};

const $createCoworkSkillNode = (skill: CoworkPromptSkill): CoworkSkillNode => {
  return $applyNodeReplacement(new CoworkSkillNode(skill));
};

const $isCoworkAttachmentNode = (node: LexicalNode | null | undefined): node is CoworkAttachmentNode => {
  return node instanceof CoworkAttachmentNode;
};

const $isCoworkSkillNode = (node: LexicalNode | null | undefined): node is CoworkSkillNode => {
  return node instanceof CoworkSkillNode;
};

const $isCoworkInlineNode = (node: LexicalNode | null | undefined): node is CoworkAttachmentNode | CoworkSkillNode => (
  $isCoworkAttachmentNode(node) || $isCoworkSkillNode(node)
);

const $getAttachmentNodes = (): CoworkAttachmentNode[] => {
  const result: CoworkAttachmentNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isCoworkAttachmentNode(node)) {
      result.push(node);
      return;
    }
    if ($isElementNode(node)) {
      node.getChildren().forEach(visit);
    }
  };
  $getRoot().getChildren().forEach(visit);
  return result;
};

const $getSkillNodes = (): CoworkSkillNode[] => {
  const result: CoworkSkillNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isCoworkSkillNode(node)) {
      result.push(node);
      return;
    }
    if ($isElementNode(node)) node.getChildren().forEach(visit);
  };
  $getRoot().getChildren().forEach(visit);
  return result;
};

const $getPlainTextCaretIndex = (): number => {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return $getRoot().getTextContent().length;
  }

  const anchorNode = selection.anchor.getNode();
  const anchorKey = anchorNode.getKey();
  let index = 0;
  let found = false;

  const visit = (node: LexicalNode) => {
    if (found || $isCoworkInlineNode(node)) return;
    if ($isTextNode(node)) {
      if (node.getKey() === anchorKey) {
        index += selection.anchor.offset;
        found = true;
        return;
      }
      index += node.getTextContent().length;
      return;
    }
    if ($isElementNode(node)) {
      node.getChildren().forEach(visit);
    }
  };

  $getRoot().getChildren().forEach(visit);
  return found ? index : $getRoot().getTextContent().length;
};

const $setRootText = (text: string) => {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  if (text) {
    paragraph.append($createTextNode(text));
  }
  root.append(paragraph);
  paragraph.selectEnd();
};

const getResourceId = (attachment: DraftAttachment): string => (
  `${attachment.source ?? CoworkPromptResourceSource.Upload}:${attachment.path}`
);

const $getPromptDocument = (): CoworkPromptDocument => {
  const segments: CoworkPromptDocument['segments'] = [];
  const resources = new Map<string, CoworkPromptDocument['resources'][number]>();
  const skills = new Map<string, CoworkPromptSkill>();
  const appendText = (text: string) => {
    if (!text) return;
    const previous = segments[segments.length - 1];
    if (previous?.kind === CoworkPromptSegmentKind.Text) {
      previous.text += text;
    } else {
      segments.push({ kind: CoworkPromptSegmentKind.Text, text });
    }
  };
  const visit = (node: LexicalNode) => {
    if ($isCoworkAttachmentNode(node)) {
      const attachment = node.getAttachment();
      const resourceId = getResourceId(attachment);
      resources.set(resourceId, {
        id: resourceId,
        name: attachment.name,
        path: attachment.path,
        source: attachment.source ?? CoworkPromptResourceSource.Upload,
        transport: CoworkPromptResourceTransport.Reference,
      });
      segments.push({ kind: CoworkPromptSegmentKind.Resource, resourceId });
      return;
    }
    if ($isCoworkSkillNode(node)) {
      const skill = node.getSkill();
      skills.set(skill.id, skill);
      segments.push({ kind: CoworkPromptSegmentKind.Skill, skillId: skill.id });
      return;
    }
    if ($isTextNode(node)) {
      appendText(node.getTextContent());
      return;
    }
    if ($isElementNode(node)) {
      node.getChildren().forEach(visit);
      return;
    }
    appendText(node.getTextContent());
  };

  $getRoot().getChildren().forEach((node, index) => {
    if (index > 0) appendText('\n');
    visit(node);
  });
  return {
    version: CoworkPromptDocumentVersion.V1,
    segments,
    resources: Array.from(resources.values()),
    skills: Array.from(skills.values()),
  };
};

const $setRootDocument = (document: CoworkPromptDocument) => {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  const resourcesById = new Map(document.resources.map(resource => [resource.id, resource]));
  const skillsById = new Map((document.skills ?? []).map(skill => [skill.id, skill]));
  for (const segment of document.segments) {
    if (segment.kind === CoworkPromptSegmentKind.Text) {
      if (segment.text) paragraph.append($createTextNode(segment.text));
      continue;
    }
    if (segment.kind === CoworkPromptSegmentKind.Resource) {
      const resource = resourcesById.get(segment.resourceId);
      if (!resource) continue;
      paragraph.append($createCoworkAttachmentNode({
        path: resource.path,
        name: resource.name,
        source: resource.source,
      }));
      continue;
    }
    const skill = skillsById.get(segment.skillId);
    if (skill) paragraph.append($createCoworkSkillNode(skill));
  }
  root.append(paragraph);
  paragraph.selectEnd();
};

const $insertAttachmentAtSelection = (attachment: DraftAttachment) => {
  const existing = $getAttachmentNodes().some(node => node.getPath() === attachment.path);
  if (existing) return;

  const node = $createCoworkAttachmentNode(attachment);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.insertNodes([node, $createTextNode(' ')]);
    return;
  }

  const root = $getRoot();
  const lastChild = root.getLastChild();
  const paragraph = $isElementNode(lastChild) ? lastChild : $createParagraphNode();
  if (!lastChild) root.append(paragraph);
  paragraph.append(node, $createTextNode(' '));
  paragraph.selectEnd();
};

const $insertSkillAtSelection = (skill: CoworkPromptSkill): CoworkSkillNode => {
  const node = $createCoworkSkillNode(skill);
  const selection = $getSelection();
  if ($isRangeSelection(selection)) {
    selection.insertNodes([node, $createTextNode(' ')]);
    return node;
  }

  const root = $getRoot();
  const lastChild = root.getLastChild();
  const paragraph = $isElementNode(lastChild) ? lastChild : $createParagraphNode();
  if (!lastChild) root.append(paragraph);
  paragraph.append(node, $createTextNode(' '));
  paragraph.selectEnd();
  return node;
};

const $getInlineNodeForKeyboardDelete = (direction: 'backward' | 'forward'): CoworkAttachmentNode | CoworkSkillNode | null => {
  const selection = $getSelection();
  if ($isNodeSelection(selection)) {
    return selection.getNodes().find($isCoworkInlineNode) ?? null;
  }
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;

  const anchorNode = selection.anchor.getNode();
  const anchorOffset = selection.anchor.offset;
  let candidate: LexicalNode | null = null;

  if ($isTextNode(anchorNode)) {
    if (direction === 'backward' && anchorOffset === 0) {
      candidate = anchorNode.getPreviousSibling();
    } else if (direction === 'forward' && anchorOffset === anchorNode.getTextContentSize()) {
      candidate = anchorNode.getNextSibling();
    }
  } else if ($isElementNode(anchorNode)) {
    candidate = direction === 'backward'
      ? anchorNode.getChildAtIndex(anchorOffset - 1)
      : anchorNode.getChildAtIndex(anchorOffset);
  }

  return $isCoworkInlineNode(candidate) ? candidate : null;
};

const InlineNodeKeyboardDeletePlugin: React.FC<{
  removedAttachmentPathsRef: React.MutableRefObject<Set<string>>;
  onRemoveAttachment: (path: string) => void;
}> = ({ removedAttachmentPathsRef, onRemoveAttachment }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const register = (command: typeof KEY_BACKSPACE_COMMAND | typeof KEY_DELETE_COMMAND, direction: 'backward' | 'forward') => (
      editor.registerCommand(command, () => {
        const node = $getInlineNodeForKeyboardDelete(direction);
        if (!node) return false;

        const path = $isCoworkAttachmentNode(node) ? node.getPath() : undefined;
        if (path) removedAttachmentPathsRef.current.add(path);
        node.remove();
        if (path) queueMicrotask(() => onRemoveAttachment(path));
        return true;
      }, COMMAND_PRIORITY_HIGH)
    );

    const unregisterBackspace = register(KEY_BACKSPACE_COMMAND, 'backward');
    const unregisterDelete = register(KEY_DELETE_COMMAND, 'forward');
    return () => {
      unregisterBackspace();
      unregisterDelete();
    };
  }, [editor, onRemoveAttachment, removedAttachmentPathsRef]);

  return null;
};

const EditorBridgePlugin = React.forwardRef<RichCoworkPromptEditorRef, {
  value: string;
  attachments: DraftAttachment[];
  editorTextRef: React.MutableRefObject<string>;
  renderedAttachmentPathsRef: React.MutableRefObject<Set<string>>;
  removedAttachmentPathsRef: React.MutableRefObject<Set<string>>;
  onRemoveAttachment: (path: string) => void;
}>(({
  value,
  attachments,
  editorTextRef,
  renderedAttachmentPathsRef,
  removedAttachmentPathsRef,
  onRemoveAttachment,
}, ref) => {
  const [editor] = useLexicalComposerContext();
  const configuredSkillGeneratedNodeKeysRef = useRef<Set<NodeKey>>(new Set());

  const $appendConfiguredSkills = (skills: CoworkPromptSkill[]) => {
    if (skills.length === 0) return;
    const root = $getRoot();
    const lastChild = root.getLastChild();
    const paragraph = $isElementNode(lastChild) ? lastChild : $createParagraphNode();
    if (!lastChild) root.append(paragraph);

    const generatedNodeKeys = configuredSkillGeneratedNodeKeysRef.current;
    const paragraphLastChild = paragraph.getLastChild();
    if (paragraphLastChild && !/\s$/.test(paragraphLastChild.getTextContent())) {
      const leadingSeparator = $createTextNode(' ');
      paragraph.append(leadingSeparator);
      generatedNodeKeys.add(leadingSeparator.getKey());
    }
    skills.forEach((skill) => {
      const node = $createCoworkSkillNode(skill);
      paragraph.append(node);
      generatedNodeKeys.add(node.getKey());
    });
    const trailingSeparator = $createTextNode(' ');
    paragraph.append(trailingSeparator);
    generatedNodeKeys.add(trailingSeparator.getKey());
    paragraph.selectEnd();
  };

  useImperativeHandle(ref, () => ({
    focus: () => {
      editor.focus();
    },
    setText: (text: string) => {
      editorTextRef.current = text;
      editor.update(() => $setRootText(text), { tag: ProgrammaticEditorUpdateTag });
    },
    setDocument: (document: CoworkPromptDocument) => {
      configuredSkillGeneratedNodeKeysRef.current.clear();
      editorTextRef.current = getCoworkPromptDocumentText(document);
      editor.update(() => $setRootDocument(document), { tag: ProgrammaticEditorUpdateTag });
    },
    setConfiguredSkills: (skills: CoworkPromptSkill[]) => {
      editor.update(() => {
        const generatedNodeKeys = configuredSkillGeneratedNodeKeysRef.current;
        Array.from(generatedNodeKeys).forEach(nodeKey => $getNodeByKey(nodeKey)?.remove());
        generatedNodeKeys.clear();
        $appendConfiguredSkills(skills);
      }, { tag: ProgrammaticEditorUpdateTag });
    },
    getDocument: () => editor.getEditorState().read(() => $getPromptDocument()),
    replaceTextAroundCaret: (beforeCount: number, afterCount: number, replacement: string) => {
      let replaced = false;
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;

        const anchorNode = selection.anchor.getNode();
        const anchorOffset = selection.anchor.offset;
        if (
          !$isTextNode(anchorNode)
          || anchorOffset < beforeCount
          || anchorOffset + afterCount > anchorNode.getTextContentSize()
        ) {
          return;
        }

        selection.setTextNodeRange(
          anchorNode,
          anchorOffset - beforeCount,
          anchorNode,
          anchorOffset + afterCount,
        );
        selection.insertText(replacement);
        replaced = true;
      });
      return replaced;
    },
    insertAttachment: (attachment: DraftAttachment) => {
      editor.update(() => $insertAttachmentAtSelection(attachment));
      editor.focus();
    },
    insertSkill: (skill: CoworkPromptSkill) => {
      editor.update(() => $insertSkillAtSelection(skill));
      editor.focus();
    },
  }), [editor, editorTextRef]);

  useEffect(() => {
    if (value === editorTextRef.current) return;
    editorTextRef.current = value;
    editor.update(() => $setRootText(value), { tag: ProgrammaticEditorUpdateTag });
  }, [editor, editorTextRef, value]);

  useEffect(() => {
    editor.update(() => {
      const attachmentPaths = new Set(attachments.map(attachment => attachment.path));
      const existingNodes = $getAttachmentNodes();
      const existingPaths = new Set(existingNodes.map(node => node.getPath()));
      for (const node of existingNodes) {
        if (!attachmentPaths.has(node.getPath())) {
          node.remove();
        }
      }
      for (const attachment of attachments) {
        if (
          !attachment.hideInEditor
          && !existingPaths.has(attachment.path)
          && !removedAttachmentPathsRef.current.has(attachment.path)
        ) {
          $insertAttachmentAtSelection(attachment);
        }
      }
      renderedAttachmentPathsRef.current = new Set($getAttachmentNodes().map(node => node.getPath()));
    }, { tag: ProgrammaticEditorUpdateTag });
  }, [attachments, editor, renderedAttachmentPathsRef, removedAttachmentPathsRef]);

  useEffect(() => {
    const handleRemove = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string }>).detail;
      if (detail?.path) {
        onRemoveAttachment(detail.path);
      }
    };
    window.addEventListener(RichCoworkPromptEditorEvent.RemoveAttachment, handleRemove);
    return () => {
      window.removeEventListener(RichCoworkPromptEditorEvent.RemoveAttachment, handleRemove);
    };
  }, [onRemoveAttachment]);

  useEffect(() => {
    const handleRemove = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeKey?: NodeKey }>).detail;
      if (!detail?.nodeKey) return;
      editor.update(() => {
        $getSkillNodes()
          .filter(node => node.getKey() === detail.nodeKey)
          .forEach(node => node.remove());
      });
    };
    window.addEventListener(RichCoworkPromptEditorEvent.RemoveSkill, handleRemove);
    return () => window.removeEventListener(RichCoworkPromptEditorEvent.RemoveSkill, handleRemove);
  }, [editor]);

  return null;
});
EditorBridgePlugin.displayName = 'EditorBridgePlugin';

const ChangePlugin: React.FC<{
  attachments: DraftAttachment[];
  editorTextRef: React.MutableRefObject<string>;
  renderedAttachmentPathsRef: React.MutableRefObject<Set<string>>;
  removedAttachmentPathsRef: React.MutableRefObject<Set<string>>;
  onChange: (value: string, caretIndex: number) => void;
  onRemoveAttachment: (path: string) => void;
}> = ({
  attachments,
  editorTextRef,
  renderedAttachmentPathsRef,
  removedAttachmentPathsRef,
  onChange,
  onRemoveAttachment,
}) => {
  const handleChange = useCallback((editorState: EditorState, _editor: unknown, tags: Set<string>) => {
    const removedPaths: string[] = [];
    editorState.read(() => {
      const nextValue = $getRoot().getTextContent();
      const currentAttachmentPaths = new Set($getAttachmentNodes().map(node => node.getPath()));
      if (tags.has(ProgrammaticEditorUpdateTag)) {
        renderedAttachmentPathsRef.current = currentAttachmentPaths;
        editorTextRef.current = nextValue;
        return;
      }
      for (const attachment of attachments) {
        if (
          !attachment.hideInEditor
          && renderedAttachmentPathsRef.current.has(attachment.path)
          && !currentAttachmentPaths.has(attachment.path)
          && !removedAttachmentPathsRef.current.has(attachment.path)
        ) {
          removedAttachmentPathsRef.current.add(attachment.path);
          removedPaths.push(attachment.path);
        }
      }
      renderedAttachmentPathsRef.current = currentAttachmentPaths;
      editorTextRef.current = nextValue;
      onChange(nextValue, $getPlainTextCaretIndex());
    });
    removedPaths.forEach(onRemoveAttachment);
  }, [
    attachments,
    editorTextRef,
    onChange,
    onRemoveAttachment,
    renderedAttachmentPathsRef,
    removedAttachmentPathsRef,
  ]);

  return <OnChangePlugin onChange={handleChange} ignoreSelectionChange />;
};

const RichCoworkPromptEditor = React.forwardRef<RichCoworkPromptEditorRef, RichCoworkPromptEditorProps>((props, ref) => {
  const {
    value,
    attachments,
    placeholder,
    disabled = false,
    className = '',
    minHeight = 48,
    maxHeight = 200,
    autoFocus = false,
    onChange,
    onKeyDown,
    onPaste,
    onRemoveAttachment,
  } = props;
  const editorTextRef = useRef(value);
  const renderedAttachmentPathsRef = useRef<Set<string>>(new Set());
  const removedAttachmentPathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const attachmentPaths = new Set(attachments.map(attachment => attachment.path));
    for (const path of removedAttachmentPathsRef.current) {
      if (!attachmentPaths.has(path)) {
        removedAttachmentPathsRef.current.delete(path);
      }
    }
  }, [attachments]);

  const initialConfig = useMemo(() => ({
    namespace: 'RichCoworkPromptEditor',
    nodes: [CoworkAttachmentNode, CoworkSkillNode],
    editable: !disabled,
    onError(error: Error) {
      console.error('[RichCoworkPromptEditor] editor failed:', error);
    },
    editorState: () => $setRootText(value),
    theme: {
      paragraph: 'm-0 min-h-[inherit]',
    },
  }), [disabled, value]);

  return (
    <LexicalComposer key={RichCoworkPromptEditorKey} initialConfig={initialConfig}>
      <EditorBridgePlugin
        ref={ref}
        value={value}
        attachments={attachments}
        editorTextRef={editorTextRef}
        renderedAttachmentPathsRef={renderedAttachmentPathsRef}
        removedAttachmentPathsRef={removedAttachmentPathsRef}
        onRemoveAttachment={onRemoveAttachment}
      />
      <EditableStatePlugin disabled={disabled} />
      <InlineNodeKeyboardDeletePlugin
        removedAttachmentPathsRef={removedAttachmentPathsRef}
        onRemoveAttachment={onRemoveAttachment}
      />
      <div className="relative">
        <RichTextPlugin
          contentEditable={(
            <ContentEditable
              className={className}
              style={{
                minHeight,
                maxHeight,
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
              aria-placeholder={placeholder}
              placeholder={<span />}
              onKeyDownCapture={onKeyDown}
              onPaste={onPaste}
              spellCheck
            />
          )}
          placeholder={(
            <div className="pointer-events-none absolute left-4 top-2.5 select-none text-secondary/60 dark:text-foregroundSecondary/60">
              {placeholder}
            </div>
          )}
          ErrorBoundary={LexicalErrorBoundary}
        />
      </div>
      <HistoryPlugin />
      <ChangePlugin
        attachments={attachments}
        editorTextRef={editorTextRef}
        renderedAttachmentPathsRef={renderedAttachmentPathsRef}
        removedAttachmentPathsRef={removedAttachmentPathsRef}
        onChange={onChange}
        onRemoveAttachment={onRemoveAttachment}
      />
      {autoFocus && <AutoFocusPlugin />}
    </LexicalComposer>
  );
});
RichCoworkPromptEditor.displayName = 'RichCoworkPromptEditor';

const EditableStatePlugin: React.FC<{ disabled: boolean }> = ({ disabled }) => {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  return null;
};

export default RichCoworkPromptEditor;
