import { ExclamationTriangleIcon, PauseCircleIcon, PlayCircleIcon } from '@heroicons/react/24/outline';
import { ArrowUpIcon, FolderIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/solid';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import {
  OpenClawSessionReasoningLevel,
  OpenClawSessionThinkingLevel,
} from '../../../common/openclawSession';
import {
  type CoworkBrowserAnnotationBatch,
  type CoworkBrowserAnnotationMessageBatch,
  normalizeBrowserAnnotationBatches,
} from '../../../shared/cowork/browserAnnotations';
import {
  type CoworkGoal,
  CoworkGoalStatus,
  formatCoworkGoalUsage,
} from '../../../shared/cowork/goal';
import type { CoworkSelectedTextSnippet } from '../../../shared/cowork/selectedText';
import { CoworkSteerStatus } from '../../../shared/cowork/steer';
import { KnowledgeSkill, type RemoteKnowledgeBase } from '../../../shared/knowledge/constants';
import sendIconUrl from '../../assets/agent-avatars/Send.png';
import { configService } from '../../services/config';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { knowledgeService } from '../../services/knowledge';
import { skillService } from '../../services/skill';
import { RootState } from '../../store';
import { selectDraftPrompts } from '../../store/selectors/coworkSelectors';
import {
  addDraftAttachment,
  addPendingSteer,
  clearDraftAttachments,
  clearDraftBrowserAnnotationBatches,
  clearDraftSelectedTextSnippets,
  COWORK_STEER_QUEUE_LIMIT,
  type DraftAttachment,
  removeDraftSelectedTextSnippet,
  removePendingSteer,
  removeRejectedSteer,
  setDraftAttachments,
  setDraftBrowserAnnotationBatches,
  setDraftPrompt,
  setDraftSelectedTextSnippets,
  setSteerDraft,
  updateCurrentSessionModelOverride,
} from '../../store/slices/coworkSlice';
import type { Model } from '../../store/slices/modelSlice';
import { setSelectedModel } from '../../store/slices/modelSlice';
import { setSkills, toggleActiveSkill } from '../../store/slices/skillSlice';
import { CoworkImageAttachment } from '../../types/cowork';
import { Skill } from '../../types/skill';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import { getCompactFolderName } from '../../utils/path';
import AcademicCapIcon from '../icons/AcademicCapIcon';
import ChevronRightIcon from '../icons/ChevronRightIcon';
import EditIcon from '../icons/EditIcon';
import GoalIcon from '../icons/GoalIcon';
import PaperClipIcon from '../icons/PaperClipIcon';
import PromptAddIcon from '../icons/PromptAddIcon';
import SkillIcon from '../icons/SkillIcon';
import TaskPauseIcon from '../icons/TaskPauseIcon';
import XMarkIcon from '../icons/XMarkIcon';
import ModelSelector from '../ModelSelector';
import { ActiveSkillBadge, SkillsPopover } from '../skills';
import { resolveAgentModelSelection, resolveEffectiveModel, useAgentSelectedModel } from './agentModelSelection';
import AttachmentCard from './AttachmentCard';
import BrowserAnnotationAttachmentBadge from './BrowserAnnotationAttachmentBadge';
import { getClipboardAttachmentFiles } from './clipboardAttachments';
import FolderSelectorPopover from './FolderSelectorPopover';
import { buildSelectedSkillRoutingPrompt } from './selectedSkillRoutingPrompt';
import SelectedTextSnippetBadge from './SelectedTextSnippetBadge';

// CoworkAttachment is aliased from the Redux-persisted DraftAttachment type
// so that attachment state survives view switches (cowork ↔ skills, etc.)
type CoworkAttachment = DraftAttachment;
type GoalInputMode = 'start' | 'set';

const getGoalStatusLabel = (goal: CoworkGoal): string => {
  switch (goal.status) {
    case CoworkGoalStatus.Active:
      return i18nService.t('coworkGoalStatusActive');
    case CoworkGoalStatus.Paused:
      return i18nService.t('coworkGoalStatusPaused');
    case CoworkGoalStatus.Blocked:
      return i18nService.t('coworkGoalStatusBlocked');
    case CoworkGoalStatus.UsageLimited:
      return i18nService.t('coworkGoalStatusUsageLimited');
    case CoworkGoalStatus.BudgetLimited:
      return i18nService.t('coworkGoalStatusBudgetLimited');
    case CoworkGoalStatus.Complete:
      return i18nService.t('coworkGoalStatusComplete');
  }
};

const getGoalSummary = (goal: CoworkGoal): string => {
  const usage = formatCoworkGoalUsage(goal);
  return [getGoalStatusLabel(goal), usage].filter(Boolean).join(' · ');
};

export interface CoworkPromptSubmitOptions {
  knowledgeBases?: Array<{ id: string; name: string }>;
  knowledgeFiles?: Array<{ id: string; title: string; knowledgeBaseName?: string; fileType?: string }>;
  selectedTextSnippets?: CoworkSelectedTextSnippet[];
  browserAnnotations?: CoworkBrowserAnnotationMessageBatch[];
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tiff', '.tif', '.ico', '.avif']);

const isImagePath = (filePath: string): boolean => {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
};

const isImageMimeType = (mimeType: string): boolean => {
  return mimeType.startsWith('image/');
};

const extractBase64FromDataUrl = (dataUrl: string): { mimeType: string; base64Data: string } | null => {
  const match = /^data:(.+);base64,(.*)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], base64Data: match[2] };
};

interface ParsedBase64Paste {
  fileName: string;
  mimeType: string;
  base64Data: string;
}

const MIN_PASTED_BASE64_CHARS = 4096;

const getBase64FileType = (base64Data: string): { fileName: string; mimeType: string } => {
  if (base64Data.startsWith('iVBORw0KGgo')) {
    return { fileName: 'pasted-base64.png', mimeType: 'image/png' };
  }
  if (base64Data.startsWith('/9j/')) {
    return { fileName: 'pasted-base64.jpg', mimeType: 'image/jpeg' };
  }
  if (base64Data.startsWith('R0lGOD')) {
    return { fileName: 'pasted-base64.gif', mimeType: 'image/gif' };
  }
  if (base64Data.startsWith('UklGR')) {
    return { fileName: 'pasted-base64.webp', mimeType: 'image/webp' };
  }
  if (base64Data.startsWith('JVBERi0')) {
    return { fileName: 'pasted-base64.pdf', mimeType: 'application/pdf' };
  }
  if (base64Data.startsWith('UEsDB')) {
    return { fileName: 'pasted-base64.zip', mimeType: 'application/zip' };
  }
  return { fileName: 'pasted-base64.bin', mimeType: 'application/octet-stream' };
};

const getExtensionForMimeType = (mimeType: string): string => {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'application/pdf':
      return 'pdf';
    case 'application/zip':
      return 'zip';
    default:
      return 'bin';
  }
};

const parsePastedBase64File = (text: string): ParsedBase64Paste | null => {
  const trimmed = text.trim();
  const dataUrlMatch = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1].trim().toLowerCase();
    const base64Data = dataUrlMatch[2].replace(/\s+/g, '');
    if (base64Data.length < MIN_PASTED_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data)) {
      return null;
    }
    return {
      fileName: `pasted-base64.${getExtensionForMimeType(mimeType)}`,
      mimeType,
      base64Data,
    };
  }

  const base64Data = trimmed.replace(/\s+/g, '');
  if (base64Data.length < MIN_PASTED_BASE64_CHARS) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data)) return null;
  const fileType = getBase64FileType(base64Data);
  return { ...fileType, base64Data };
};

const getFileNameFromPath = (path: string): string => {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

const SEND_SHORTCUT_OPTIONS = [
  { value: 'Enter', label: 'Enter', labelMac: 'Enter' },
  { value: 'Shift+Enter', label: 'Shift+Enter', labelMac: 'Shift+Enter' },
  { value: 'Ctrl+Enter', label: 'Ctrl+Enter', labelMac: 'Cmd+Enter' },
  { value: 'Alt+Enter', label: 'Alt+Enter', labelMac: 'Option+Enter' },
] as const;

const isMacPlatform = navigator.platform.includes('Mac');

const ContextLabelMaxLength = {
  Folder: 12,
  DefaultFolder: 30,
} as const;

const truncateDisplayText = (value: string, maxLength: number): string => {
  const trimmed = value.trim();
  const characters = Array.from(trimmed);
  if (characters.length <= maxLength) return trimmed;
  return `${characters.slice(0, maxLength).join('')}...`;
};

const getSendShortcutLabel = (value: string): string => {
  const option = SEND_SHORTCUT_OPTIONS.find(o => o.value === value);
  if (!option) return value;
  return isMacPlatform ? option.labelMac : option.label;
};

const SendButtonIcon: React.FC<{ className: string }> = ({ className }) => (
  <span
    aria-hidden="true"
    className={`inline-block shrink-0 bg-current ${className}`}
    style={{
      WebkitMaskImage: `url("${sendIconUrl}")`,
      WebkitMaskPosition: 'center',
      WebkitMaskRepeat: 'no-repeat',
      WebkitMaskSize: 'contain',
      maskImage: `url("${sendIconUrl}")`,
      maskPosition: 'center',
      maskRepeat: 'no-repeat',
      maskSize: 'contain',
    }}
  />
);

const SteerQueueStatusIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({ className, ...props }) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.45"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M3.75 3.5v6.7c0 .86.7 1.55 1.55 1.55h6.45" />
    <path d="m10.15 10.1 1.65 1.65-1.65 1.65" />
    <path d="M5.75 5.6h4" />
    <path d="M5.75 7.9h3" />
  </svg>
);

const SteerQueueIcon: React.FC<React.SVGProps<SVGSVGElement>> = ({ className, ...props }) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="M3.5 3.5v3.25c0 1.52 1.23 2.75 2.75 2.75h6" />
    <path d="m10.25 7.75 1.75 1.75-1.75 1.75" />
  </svg>
);

export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 设置图片附件（用于重新编辑消息时还原图片） */
  setImageAttachments: (images: CoworkImageAttachment[]) => void;
  /** 设置已选文本片段 */
  setSelectedTextSnippets: (snippets: CoworkSelectedTextSnippet[]) => void;
  /** 设置浏览器注释附件 */
  setBrowserAnnotationBatches: (batches: CoworkBrowserAnnotationBatch[]) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

interface CoworkPromptInputProps {
  onSubmit: (prompt: string, skillPrompt?: string, imageAttachments?: CoworkImageAttachment[], options?: CoworkPromptSubmitOptions) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  size?: 'normal' | 'large' | 'compact';
  workingDirectory?: string;
  onWorkingDirectoryChange?: (workingDirectory: string) => void;
  showFolderSelector?: boolean;
  showModelSelector?: boolean;
  showAgentSelector?: boolean;
  showReadOnlyContext?: boolean;
  readOnlyContextTrailingText?: string;
  onManageSkills?: () => void;
  sessionId?: string;
  goal?: CoworkGoal | null;
  onGoalCommand?: (command: string) => boolean | void | Promise<boolean | void>;
  steerPreviewPortalTarget?: HTMLElement | null;
  goalStatusBarPortalTarget?: HTMLElement | null;
  goalStatusBarAttached?: boolean;
  canSteer?: boolean;
  contextUsageControl?: React.ReactNode;
  /** When true, hides attachment/skill buttons but keeps the input box visible (disabled) */
  remoteManaged?: boolean;
}

const EMPTY_ATTACHMENTS: CoworkAttachment[] = [];
const EMPTY_SELECTED_TEXT_SNIPPETS: CoworkSelectedTextSnippet[] = [];
const EMPTY_BROWSER_ANNOTATION_BATCHES: CoworkBrowserAnnotationBatch[] = [];

const CoworkPromptInput = React.forwardRef<CoworkPromptInputRef, CoworkPromptInputProps>(
  (props, ref) => {
    const {
      onSubmit,
      onStop,
      isStreaming = false,
      placeholder = 'Enter your task...',
      disabled = false,
      size = 'normal',
      workingDirectory = '',
      onWorkingDirectoryChange,
      showFolderSelector = false,
      showModelSelector = false,
      showAgentSelector = false,
      showReadOnlyContext = false,
      readOnlyContextTrailingText,
      onManageSkills,
      sessionId,
      goal,
      onGoalCommand,
      steerPreviewPortalTarget,
      goalStatusBarPortalTarget,
      goalStatusBarAttached = true,
      canSteer = false,
      contextUsageControl,
      remoteManaged = false,
    } = props;
    const dispatch = useDispatch();
    const draftKey = sessionId || '__home__';
    const draftPrompt = useSelector((state: RootState) => selectDraftPrompts(state)[draftKey] || '');
    const steerDraft = useSelector((state: RootState) => (
      sessionId ? state.cowork.steerDrafts[sessionId] || '' : ''
    ));
    const attachments = useSelector((state: RootState) => state.cowork.draftAttachments[draftKey] || EMPTY_ATTACHMENTS) as CoworkAttachment[];
    const selectedTextSnippets = useSelector((state: RootState) => state.cowork.draftSelectedTextSnippets[draftKey] || EMPTY_SELECTED_TEXT_SNIPPETS);
    const browserAnnotationBatches = useSelector(
      (state: RootState) => (
        state.cowork.draftBrowserAnnotationBatches[draftKey]
        || EMPTY_BROWSER_ANNOTATION_BATCHES
      ),
    );
    const pendingSteers = useSelector((state: RootState) => (
      sessionId ? state.cowork.pendingSteers[sessionId] || [] : []
    ));
    const rejectedSteers = useSelector((state: RootState) => (
      sessionId ? state.cowork.rejectedSteers[sessionId] || [] : []
    ));
    const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
    const agents = useSelector((state: RootState) => state.agent.agents);
    const coworkAgentEngine = useSelector((state: RootState) => state.cowork.config.agentEngine);
    const availableModels = useSelector((state: RootState) => state.model.availableModels);
    const currentSession = useSelector((state: RootState) => state.cowork.currentSession);
    const [value, setValue] = useState(draftPrompt);
    const [steerValue, setSteerValue] = useState(steerDraft);
    const [steerInputActive, setSteerInputActive] = useState(false);
    const [goalInputActive, setGoalInputActive] = useState(false);
    const [goalInputMode, setGoalInputMode] = useState<GoalInputMode>('start');
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [showFolderMenu, setShowFolderMenu] = useState(false);
    const [showSkillsPopover, setShowSkillsPopover] = useState(false);
    const [showKnowledgeSubmenu, setShowKnowledgeSubmenu] = useState(false);
    const [isDraggingFiles, setIsDraggingFiles] = useState(false);
    const [isAddingFile, setIsAddingFile] = useState(false);
    const [imageVisionHint, setImageVisionHint] = useState(false);
    const [isPatchingModel, setIsPatchingModel] = useState(false);
    const [isLoadingKnowledgeBases, setIsLoadingKnowledgeBases] = useState(false);
    const [knowledgeBases, setKnowledgeBases] = useState<RemoteKnowledgeBase[]>([]);
    const [selectedKnowledgeBaseIds, setSelectedKnowledgeBaseIds] = useState<string[]>([]);

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const addMenuButtonRef = useRef<HTMLButtonElement>(null);
    const folderButtonRef = useRef<HTMLButtonElement>(null);
    const addMenuRef = useRef<HTMLDivElement>(null);
    const knowledgeMenuItemRef = useRef<HTMLButtonElement>(null);
    const skillMenuItemRef = useRef<HTMLButtonElement>(null);
    const dragDepthRef = useRef(0);
    const modelPatchRequestIdRef = useRef(0);
    const skillSubmenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const knowledgeSubmenuCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const goalInputBaselineRef = useRef<string | null>(null);
    const goalInputReturnDraftRef = useRef<string | null>(null);

  // 暴露方法给父组件
  React.useImperativeHandle(ref, () => ({
    setValue: (newValue: string) => {
      setValue(newValue);
      // 触发自动调整高度
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.style.height = 'auto';
          textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
        }
      });
    },
    setImageAttachments: (images: CoworkImageAttachment[]) => {
      const newAttachments: CoworkAttachment[] = images.map((img, idx) => ({
        path: `inline:${img.name}:reedit-${Date.now()}-${idx}`,
        name: img.name,
        isImage: true,
        dataUrl: `data:${img.mimeType};base64,${img.base64Data}`,
      }));
      dispatch(setDraftAttachments({ draftKey, attachments: newAttachments }));
    },
    setSelectedTextSnippets: (snippets: CoworkSelectedTextSnippet[]) => {
      dispatch(setDraftSelectedTextSnippets({ draftKey, snippets }));
    },
    setBrowserAnnotationBatches: (batches: CoworkBrowserAnnotationBatch[]) => {
      dispatch(setDraftBrowserAnnotationBatches({ draftKey, batches }));
    },
    focus: () => {
      textareaRef.current?.focus();
    },
  }));

  const activeSkillIds = useSelector((state: RootState) => state.skill.activeSkillIds);
  const skills = useSelector((state: RootState) => state.skill.skills);
  const hasActiveSkills = activeSkillIds.some(id => skills.some(skill => skill.id === id));
  const selectedKnowledgeBases = selectedKnowledgeBaseIds
    .map(id => knowledgeBases.find(base => base.id === id))
    .filter((base): base is RemoteKnowledgeBase => Boolean(base));
  const hasSelectedKnowledge = selectedKnowledgeBases.length > 0;
  const hasContextBadges = hasActiveSkills || hasSelectedKnowledge;
  const modelTargetAgentId = currentSession && currentSession.id === sessionId
    ? currentSession.agentId
    : currentAgentId;
  const currentAgent = agents.find((agent) => agent.id === modelTargetAgentId);
  const currentAgentSelectedModel = useAgentSelectedModel(modelTargetAgentId, currentAgent?.model ?? '');
  const {
    selectedModel: agentSelectedModel,
    hasInvalidExplicitModel: agentModelIsInvalid,
  } = resolveAgentModelSelection({
    sessionModel: currentSession && currentSession.id === sessionId ? currentSession.modelOverride : '',
    agentModel: currentAgent?.model ?? '',
    availableModels,
    fallbackModel: currentAgentSelectedModel,
    engine: coworkAgentEngine,
  });

  const isLarge = size === 'large';
  const isCompact = size === 'compact';
  const useHomeContextLayout = isLarge && showAgentSelector;
  const useCompactSendButton = isCompact || (isLarge && (useHomeContextLayout || showReadOnlyContext));
  const minHeight = isCompact
    ? 32
    : isLarge
    ? useHomeContextLayout
      ? hasContextBadges ? 36 : 52
      : hasContextBadges ? 44 : 60
    : 24;
  const maxHeight = isLarge ? 200 : 200;

  const effectiveSelectedModel = resolveEffectiveModel({
    sessionId,
    agentSelectedModel,
    globalSelectedModel: currentAgentSelectedModel,
  });
  const modelSupportsImage = !!effectiveSelectedModel?.supportsImage;
  // Load skills on mount
  useEffect(() => {
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    };
    loadSkills();
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      dispatch(setSkills(loadedSkills));
    });
    return () => {
      unsubscribe();
    };
  }, [dispatch]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)}px`;
    }
  }, [value, steerValue, steerInputActive, minHeight, maxHeight]);

  useEffect(() => {
    const handleFocusInput = (event: Event) => {
      const detail = (event as CustomEvent<{ clear?: boolean; text?: string }>).detail;
      const shouldClear = detail?.clear ?? true;
      if (detail?.text !== undefined) {
        setValue(detail.text);
        dispatch(clearDraftAttachments(draftKey));
        setImageVisionHint(false);
      } else if (shouldClear) {
        setValue('');
        dispatch(clearDraftAttachments(draftKey));
        setImageVisionHint(false);
      }
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
      });
    };
    window.addEventListener('cowork:focus-input', handleFocusInput);
    return () => {
      window.removeEventListener('cowork:focus-input', handleFocusInput);
    };
  }, [dispatch, draftKey]);

  useEffect(() => {
    if (!showAddMenu) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!addMenuButtonRef.current?.contains(target) && !addMenuRef.current?.contains(target)) {
        setShowAddMenu(false);
        setShowSkillsPopover(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowAddMenu(false);
        setShowSkillsPopover(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
      document.removeEventListener('keydown', handleEscape, true);
    };
  }, [showAddMenu]);

  useEffect(() => {
    if (!showAddMenu) {
      setShowSkillsPopover(false);
      setShowKnowledgeSubmenu(false);
      if (skillSubmenuCloseTimerRef.current) {
        clearTimeout(skillSubmenuCloseTimerRef.current);
        skillSubmenuCloseTimerRef.current = null;
      }
      if (knowledgeSubmenuCloseTimerRef.current) {
        clearTimeout(knowledgeSubmenuCloseTimerRef.current);
        knowledgeSubmenuCloseTimerRef.current = null;
      }
    }
  }, [showAddMenu]);

  useEffect(() => {
    modelPatchRequestIdRef.current += 1;
    setIsPatchingModel(false);
  }, [sessionId]);

  // Sync value from draft when sessionId changes
  useEffect(() => {
    setValue(draftPrompt);
    setSteerValue(steerDraft);
    setSteerInputActive(false);
    setGoalInputActive(false);
    setGoalInputMode('start');
    goalInputBaselineRef.current = null;
    goalInputReturnDraftRef.current = null;
    // Re-derive imageVisionHint from the new session's draft attachments
    const hasImageWithoutVision = !modelSupportsImage && attachments.some(a => a.isImage || isImagePath(a.path));
    setImageVisionHint(hasImageWithoutVision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]); // intentionally omit other deps to only trigger on session switch

  useEffect(() => {
    if (value !== draftPrompt) {
      const timer = setTimeout(() => {
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: value }));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [value, draftPrompt, dispatch, draftKey]);

  useEffect(() => {
    if (!sessionId || steerValue === steerDraft) return undefined;
    const timer = setTimeout(() => {
      dispatch(setSteerDraft({ sessionId, draft: steerValue }));
    }, 300);
    return () => clearTimeout(timer);
  }, [dispatch, sessionId, steerDraft, steerValue]);

  const resetGoalInput = useCallback((restoreDraft = false) => {
    const restoredDraft = restoreDraft ? goalInputReturnDraftRef.current : null;
    goalInputBaselineRef.current = null;
    goalInputReturnDraftRef.current = null;
    setGoalInputActive(false);
    setGoalInputMode('start');
    if (restoredDraft !== null) {
      setValue(restoredDraft);
      dispatch(setDraftPrompt({ sessionId: draftKey, draft: restoredDraft }));
    }
  }, [dispatch, draftKey]);

  const handleSubmit = useCallback(async () => {
    const activeValue = steerInputActive ? steerValue : value;
    const trimmedValue = activeValue.trim();
    if (goalInputActive) {
      if (!trimmedValue || disabled || isPatchingModel) return;
      if (goalInputMode === 'set' && goalInputBaselineRef.current !== null && trimmedValue === goalInputBaselineRef.current) {
        resetGoalInput(true);
        return;
      }
      const goalCommand = `/goal ${goalInputMode} ${trimmedValue}`;
      if (sessionId && onGoalCommand) {
        const accepted = await Promise.resolve(onGoalCommand(goalCommand))
          .then(result => result !== false)
          .catch((error) => {
            console.warn('[CoworkGoal] failed to submit goal command from prompt input.', error);
            return false;
          });
        if (!accepted) return;
        resetGoalInput(false);
        setValue('');
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
        return;
      }
      const result = await onSubmit(goalCommand);
      if (result === false) return;
      resetGoalInput(false);
      setValue('');
      dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
      return;
    }
    if (
      (
        !trimmedValue
        && (!isStreaming || !steerInputActive)
        && attachments.length === 0
        && selectedTextSnippets.length === 0
        && browserAnnotationBatches.length === 0
      )
      || disabled
      || isPatchingModel
    ) return;
    if (isStreaming && !sessionId) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkSteerNoActiveTurn'),
      }));
      return;
    }
    if (isStreaming && remoteManaged) {
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkSessionStillRunning'),
      }));
      return;
    }
    if (isStreaming && sessionId && steerInputActive && canSteer) {
      if (!trimmedValue) return;
      const clientSteerId = `steer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const accepted = await coworkService.submitSteer({
        sessionId,
        text: trimmedValue,
        clientSteerId,
      });
      if (!accepted) return;
      setSteerValue('');
      setSteerInputActive(false);
      dispatch(setSteerDraft({ sessionId, draft: '' }));
      return;
    }
    if (isStreaming && sessionId) {
      if (
        !trimmedValue
        && attachments.length === 0
        && selectedTextSnippets.length === 0
        && browserAnnotationBatches.length === 0
      ) return;
      if (pendingSteers.length >= COWORK_STEER_QUEUE_LIMIT) {
        window.dispatchEvent(new CustomEvent('app:showToast', {
          detail: i18nService.t('coworkSteerQueueFull'),
        }));
        return;
      }
      const queuedSteerId = `steer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      dispatch(addPendingSteer({
        id: queuedSteerId,
        sessionId,
        text: trimmedValue,
        attachments: attachments.length > 0
          ? attachments.map(attachment => ({
            path: attachment.path,
            name: attachment.name,
            isImage: attachment.isImage,
            isDirectory: attachment.isDirectory,
            ...(attachment.path.startsWith('inline:') && attachment.dataUrl ? { dataUrl: attachment.dataUrl } : {}),
          }))
          : undefined,
        browserAnnotations: normalizeBrowserAnnotationBatches(browserAnnotationBatches),
        status: CoworkSteerStatus.Pending,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
      if (steerInputActive) {
        setSteerValue('');
        setSteerInputActive(false);
        dispatch(setSteerDraft({ sessionId, draft: '' }));
      } else {
        setValue('');
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
      }
      dispatch(clearDraftAttachments(draftKey));
      dispatch(clearDraftSelectedTextSnippets(draftKey));
      dispatch(clearDraftBrowserAnnotationBatches(draftKey));
      setImageVisionHint(false);
      return;
    }
    // setShowFolderRequiredWarning(false);

    // Get selected skill routing metadata. OpenClaw loads SKILL.md files
    // natively, so do not inline full skill bodies here.
    const knowledgeBases = selectedKnowledgeBases.map(base => ({ id: base.id, name: base.name }));
    const hasSelectedKnowledgeBases = knowledgeBases.length > 0;
    const effectiveActiveSkillIds = hasSelectedKnowledgeBases && !activeSkillIds.includes(KnowledgeSkill.Base)
      ? [...activeSkillIds, KnowledgeSkill.Base]
      : activeSkillIds;
    const activeSkills = effectiveActiveSkillIds
      .map(id => skills.find(s => s.id === id))
      .filter((s): s is Skill => s !== undefined);
    const skillPrompt = buildSelectedSkillRoutingPrompt(activeSkills);

    // Extract image attachments (with base64 data) for vision-capable models
    console.log('[CoworkPromptInput] handleSubmit: attachment diagnosis', {
      totalAttachments: attachments.length,
      modelSupportsImage,
      effectiveModelId: effectiveSelectedModel?.id ?? null,
      attachmentDetails: attachments.map(a => ({
        path: a.path,
        name: a.name,
        isImage: a.isImage,
        hasDataUrl: !!a.dataUrl,
        dataUrlLength: a.dataUrl?.length ?? 0,
      })),
    });
    const imageAtts: CoworkImageAttachment[] = [];
    for (const attachment of attachments) {
      if (attachment.isImage && attachment.dataUrl) {
        const extracted = extractBase64FromDataUrl(attachment.dataUrl);
        if (extracted) {
          imageAtts.push({
            name: attachment.name,
            mimeType: extracted.mimeType,
            base64Data: extracted.base64Data,
          });
        } else {
          console.warn('[CoworkPromptInput] handleSubmit: extractBase64FromDataUrl returned null', {
            name: attachment.name,
            dataUrlPrefix: attachment.dataUrl.slice(0, 60),
          });
        }
      } else if (attachment.isImage && modelSupportsImage && !attachment.path.startsWith('inline:')) {
        try {
          const result = await window.electron.dialog.readFileAsDataUrl(attachment.path);
          if (result.success && result.dataUrl) {
            const extracted = extractBase64FromDataUrl(result.dataUrl);
            if (extracted) {
              imageAtts.push({
                name: attachment.name,
                mimeType: extracted.mimeType,
                base64Data: extracted.base64Data,
              });
              continue;
            }
          }
          console.warn('[CoworkPromptInput] handleSubmit: image path could not be read as vision input', {
            path: attachment.path,
            name: attachment.name,
            success: result.success,
            error: result.error,
          });
        } catch (error) {
          console.error('[CoworkPromptInput] handleSubmit: failed to read image path as vision input:', error);
        }
      } else if (attachment.isImage) {
        console.warn('[CoworkPromptInput] handleSubmit: image attachment missing dataUrl', {
          path: attachment.path,
          name: attachment.name,
          isImage: attachment.isImage,
          hasDataUrl: !!attachment.dataUrl,
        });
      }
    }

    // Build prompt with ALL attachments that have real file paths (both regular files and images).
    // Image attachments also need their file paths in the prompt so the model knows
    // where the original files are located (e.g., for skills like seedream that need --image <path>).
    // Note: inline/clipboard images have pseudo-paths starting with 'inline:' and are excluded.
    // Note: image attachments that already carry base64 data are excluded — their content
    // is delivered via the attachments parameter of chat.send. Including the file path
    // would trigger OpenClaw's Native-image detection, which rejects paths outside allowed
    // directories and can drop the base64 image during sanitization (macOS-only bug).
    const attachmentLines = attachments
      .filter((a) => !a.path.startsWith('inline:') && !(a.isImage && a.dataUrl))
      .map((attachment) => `${i18nService.t('inputFileLabel')}: ${attachment.path}`)
      .join('\n');
    const finalPrompt = trimmedValue
      ? (attachmentLines ? `${trimmedValue}\n\n${attachmentLines}` : trimmedValue)
      : attachmentLines;

    if (imageAtts.length > 0) {
      console.log('[CoworkPromptInput] handleSubmit: passing imageAtts to onSubmit', {
        count: imageAtts.length,
        names: imageAtts.map(a => a.name),
        base64Lengths: imageAtts.map(a => a.base64Data.length),
      });
    } else if (attachments.some(a => a.isImage || isImagePath(a.path))) {
      console.warn('[CoworkPromptInput] handleSubmit: has image-like attachments but imageAtts is EMPTY — images will NOT be sent as base64', {
        imageAttachments: attachments.filter(a => a.isImage || isImagePath(a.path)).map(a => ({
          path: a.path,
          isImage: a.isImage,
          hasDataUrl: !!a.dataUrl,
        })),
      });
    }
    const normalizedBrowserAnnotations = normalizeBrowserAnnotationBatches(browserAnnotationBatches);
    const submitOptions: CoworkPromptSubmitOptions | undefined =
      hasSelectedKnowledgeBases
      || selectedTextSnippets.length > 0
      || normalizedBrowserAnnotations.length > 0
      ? {
        ...(hasSelectedKnowledgeBases ? { knowledgeBases } : {}),
        ...(selectedTextSnippets.length > 0 ? { selectedTextSnippets } : {}),
        ...(normalizedBrowserAnnotations.length > 0 ? { browserAnnotations: normalizedBrowserAnnotations } : {}),
      }
      : undefined;
    const result = await onSubmit(finalPrompt, skillPrompt, imageAtts.length > 0 ? imageAtts : undefined, submitOptions);
    if (result === false) return;
    setValue('');
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
    dispatch(clearDraftAttachments(draftKey));
    dispatch(clearDraftSelectedTextSnippets(draftKey));
    dispatch(clearDraftBrowserAnnotationBatches(draftKey));
    setImageVisionHint(false);
  }, [value, steerInputActive, steerValue, goalInputActive, goalInputMode, resetGoalInput, isStreaming, disabled, isPatchingModel, sessionId, onGoalCommand, remoteManaged, canSteer, attachments, selectedTextSnippets, browserAnnotationBatches, pendingSteers.length, dispatch, draftKey, onSubmit, activeSkillIds, skills, effectiveSelectedModel?.id, modelSupportsImage, selectedKnowledgeBaseIds, selectedKnowledgeBases]);

  const handleSelectSkill = useCallback((skill: Skill) => {
    dispatch(toggleActiveSkill(skill.id));
  }, [dispatch]);

  const handleManageSkills = useCallback(() => {
    if (onManageSkills) {
      onManageSkills();
    }
  }, [onManageSkills]);

  const handleOpenAddMenu = useCallback(() => {
    setShowSkillsPopover(false);
    setShowKnowledgeSubmenu(false);
    setShowAddMenu(prev => !prev);
  }, []);

  const handleOpenSkillsPopover = useCallback(() => {
    if (skillSubmenuCloseTimerRef.current) {
      clearTimeout(skillSubmenuCloseTimerRef.current);
      skillSubmenuCloseTimerRef.current = null;
    }
    setShowKnowledgeSubmenu(false);
    setShowAddMenu(true);
    setShowSkillsPopover(true);
  }, []);

  const cancelCloseSkillsPopover = useCallback(() => {
    if (skillSubmenuCloseTimerRef.current) {
      clearTimeout(skillSubmenuCloseTimerRef.current);
      skillSubmenuCloseTimerRef.current = null;
    }
  }, []);

  const cancelCloseKnowledgeSubmenu = useCallback(() => {
    if (knowledgeSubmenuCloseTimerRef.current) {
      clearTimeout(knowledgeSubmenuCloseTimerRef.current);
      knowledgeSubmenuCloseTimerRef.current = null;
    }
  }, []);

  const handleCloseSkillsPopover = useCallback(() => {
    if (skillSubmenuCloseTimerRef.current) {
      clearTimeout(skillSubmenuCloseTimerRef.current);
      skillSubmenuCloseTimerRef.current = null;
    }
    setShowSkillsPopover(false);
  }, []);

  const handleCloseKnowledgeSubmenu = useCallback(() => {
    if (knowledgeSubmenuCloseTimerRef.current) {
      clearTimeout(knowledgeSubmenuCloseTimerRef.current);
      knowledgeSubmenuCloseTimerRef.current = null;
    }
    setShowKnowledgeSubmenu(false);
  }, []);

  const scheduleCloseSkillsPopover = useCallback(() => {
    if (skillSubmenuCloseTimerRef.current) {
      clearTimeout(skillSubmenuCloseTimerRef.current);
    }
    skillSubmenuCloseTimerRef.current = setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement && addMenuRef.current?.contains(activeElement)) {
        skillSubmenuCloseTimerRef.current = null;
        return;
      }
      setShowSkillsPopover(false);
      skillSubmenuCloseTimerRef.current = null;
    }, 120);
  }, []);

  const scheduleCloseKnowledgeSubmenu = useCallback(() => {
    if (knowledgeSubmenuCloseTimerRef.current) {
      clearTimeout(knowledgeSubmenuCloseTimerRef.current);
    }
    knowledgeSubmenuCloseTimerRef.current = setTimeout(() => {
      const activeElement = document.activeElement;
      if (activeElement && addMenuRef.current?.contains(activeElement)) {
        knowledgeSubmenuCloseTimerRef.current = null;
        return;
      }
      setShowKnowledgeSubmenu(false);
      knowledgeSubmenuCloseTimerRef.current = null;
    }, 120);
  }, []);

  const loadKnowledgeBases = useCallback(async () => {
    if (isLoadingKnowledgeBases) return;
    setIsLoadingKnowledgeBases(true);
    try {
      const basesResult = await knowledgeService.listBases();
      if (basesResult.success && basesResult.data) {
        const nextKnowledgeBases = basesResult.data;
        const nextKnowledgeBaseIds = new Set(nextKnowledgeBases.map(base => base.id));
        setKnowledgeBases(nextKnowledgeBases);
        setSelectedKnowledgeBaseIds(current => current.filter(id => nextKnowledgeBaseIds.has(id)));
      } else {
        setKnowledgeBases([]);
        setSelectedKnowledgeBaseIds([]);
      }
    } catch (error) {
      setKnowledgeBases([]);
      setSelectedKnowledgeBaseIds([]);
    } finally {
      setIsLoadingKnowledgeBases(false);
    }
  }, [isLoadingKnowledgeBases]);

  const handleOpenKnowledgeSubmenu = useCallback(() => {
    if (knowledgeSubmenuCloseTimerRef.current) {
      clearTimeout(knowledgeSubmenuCloseTimerRef.current);
      knowledgeSubmenuCloseTimerRef.current = null;
    }
    setShowSkillsPopover(false);
    setShowAddMenu(true);
    setShowKnowledgeSubmenu(true);
    if (knowledgeBases.length === 0) {
      void loadKnowledgeBases();
    }
  }, [knowledgeBases.length, loadKnowledgeBases]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const isComposing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (event.key !== 'Enter' || isComposing) return;

    // Use synced state (kept up-to-date via config-updated event) so that
    // changes made in the Settings panel are reflected immediately without
    // requiring a configService read at event time.
    const sendKey = currentSendShortcut;

    let isSendCombo = false;
    switch (sendKey) {
      case 'Enter':
        isSendCombo = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        break;
      case 'Shift+Enter':
        isSendCombo = event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        break;
      case 'Ctrl+Enter':
        isSendCombo = isMacPlatform
          ? event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
          : event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
        break;
      case 'Alt+Enter':
        isSendCombo = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        break;
      default:
        // Unknown config value — fall back to bare Enter so the user can always send
        isSendCombo = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        break;
    }

    if (isSendCombo && isStreaming && !streamingSubmitCanRun) {
      event.preventDefault();
      window.dispatchEvent(new CustomEvent('app:showToast', {
        detail: i18nService.t('coworkSessionStillRunning'),
      }));
    } else if (isSendCombo && !disabled && !isPatchingModel) {
      event.preventDefault();
      handleSubmit();
    } else {
      // Any non-send Enter combo inserts a newline.
      // Shift+Enter inserts newline natively; for other combos use execCommand.
      if (!event.shiftKey) {
        event.preventDefault();
        document.execCommand('insertText', false, '\n');
      }
    }
  };

  const handleStopClick = () => {
    if (onStop) {
      onStop();
    }
  };

  const handleToggleSteerInput = useCallback(() => {
    if (!sessionId || remoteManaged || disabled || !isStreaming) return;
    if (goalInputActive) {
      resetGoalInput(true);
    }
    const nextActive = !steerInputActive;
    setSteerInputActive(nextActive);
    if (nextActive) {
      const nextSteerValue = steerDraft || value;
      setSteerValue(nextSteerValue);
      if (!steerDraft && value) {
        dispatch(setSteerDraft({ sessionId, draft: nextSteerValue }));
        setValue('');
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: '' }));
      }
    }
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [disabled, dispatch, draftKey, goalInputActive, isStreaming, remoteManaged, resetGoalInput, sessionId, steerDraft, steerInputActive, value]);

  const handleEnableGoalInput = useCallback((mode: GoalInputMode = 'start', initialValue?: string) => {
    if (disabled || remoteManaged || isPatchingModel) return;
    if (!onGoalCommand && sessionId) return;
    setShowAddMenu(false);
    handleCloseSkillsPopover();
    if (steerInputActive) {
      setSteerInputActive(false);
      if (sessionId) {
        dispatch(setSteerDraft({ sessionId, draft: steerValue }));
      }
    }
    goalInputReturnDraftRef.current = value;
    goalInputBaselineRef.current = mode === 'set' && initialValue !== undefined ? initialValue : null;
    setGoalInputMode(mode);
    setGoalInputActive(true);
    setValue(initialValue ?? '');
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: initialValue ?? '' }));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [disabled, dispatch, draftKey, handleCloseSkillsPopover, isPatchingModel, onGoalCommand, remoteManaged, sessionId, steerInputActive, steerValue, value]);

  const handleGoalCommandClick = useCallback((command: string) => {
    if (disabled || remoteManaged || isPatchingModel || !onGoalCommand) return;
    void Promise.resolve(onGoalCommand(command)).catch((error) => {
      console.warn('[CoworkGoal] failed to submit goal status command from prompt input.', error);
    });
  }, [disabled, isPatchingModel, onGoalCommand, remoteManaged]);

  const containerClass = isCompact
    ? 'relative rounded-2xl border border-border bg-surface shadow-subtle'
    : isLarge
    ? useHomeContextLayout
      ? 'relative rounded-2xl'
      : `relative rounded-2xl border border-border bg-surface ${showReadOnlyContext ? '' : 'shadow-card'}`
    : 'relative flex items-end gap-2 p-3 rounded-xl border border-border bg-surface';

  const textareaClass = isCompact
    ? `w-full resize-none bg-transparent px-4 pb-1.5 pt-2 text-[14px] leading-[21px] text-foreground placeholder:dark:text-foregroundSecondary/60 placeholder:text-secondary/60 focus:outline-none min-h-[${minHeight}px] max-h-[${maxHeight}px]`
    : isLarge
    ? `w-full resize-none bg-transparent px-4 pb-2 text-foreground placeholder:dark:text-foregroundSecondary/60 placeholder:text-secondary/60 focus:outline-none min-h-[${minHeight}px] max-h-[${maxHeight}px] ${
      useHomeContextLayout
        ? `${hasContextBadges ? 'pt-2' : 'pt-3'} text-[14px] leading-[22px]`
        : `${hasContextBadges ? 'pt-2' : 'pt-2.5'} text-[15px] leading-[23px]`
    }`
    : 'flex-1 resize-none bg-transparent text-foreground placeholder:placeholder:text-secondary focus:outline-none text-sm leading-relaxed min-h-[24px] max-h-[200px]';

  const truncatePath = (path: string, maxLength: number = ContextLabelMaxLength.DefaultFolder): string => {
    if (!path) return i18nService.t('noFolderSelected');
    const folderName = getCompactFolderName(path) || i18nService.t('noFolderSelected');
    return truncateDisplayText(folderName, maxLength);
  };

  const hasWorkingDirectory = workingDirectory.trim().length > 0;

  const handleOpenWorkingDirectory = useCallback(async () => {
    const path = workingDirectory.trim();
    if (!path) return;

    try {
      const result = await window.electron.shell.openPath(path);
      if (!result?.success) {
        console.error('[CoworkPromptInput] failed to open folder:', result?.error);
      }
    } catch (error) {
      console.error('[CoworkPromptInput] failed to open folder:', error);
    }
  }, [workingDirectory]);

  const handleWorkingDirectoryControlClick = useCallback(() => {
    if (showFolderSelector && onWorkingDirectoryChange) {
      setShowFolderMenu((current) => !current);
      return;
    }
    void handleOpenWorkingDirectory();
  }, [handleOpenWorkingDirectory, onWorkingDirectoryChange, showFolderSelector]);

  const handleSelectWorkingDirectory = useCallback((path: string) => {
    onWorkingDirectoryChange?.(path);
    setShowFolderMenu(false);
  }, [onWorkingDirectoryChange]);

  const addAttachment = useCallback((filePath: string, options?: { isImage?: boolean; isDirectory?: boolean; dataUrl?: string }) => {
    if (!filePath) return;
    dispatch(addDraftAttachment({
      draftKey,
      attachment: {
        path: filePath,
        name: getFileNameFromPath(filePath),
        isImage: options?.isImage,
        isDirectory: options?.isDirectory,
        dataUrl: options?.dataUrl,
      },
    }));
  }, [dispatch, draftKey]);

  const addImageAttachmentFromDataUrl = useCallback((name: string, dataUrl: string) => {
    // Use the dataUrl as the unique key (no file path for inline images)
    const pseudoPath = `inline:${name}:${Date.now()}`;
    dispatch(addDraftAttachment({
      draftKey,
      attachment: {
        path: pseudoPath,
        name,
        isImage: true,
        dataUrl,
      },
    }));
  }, [dispatch, draftKey]);

  const fileToDataUrl = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        resolve(result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read file'));
          return;
        }
        const commaIndex = result.indexOf(',');
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }, []);

  const getNativeFilePath = useCallback((file: File): string | null => {
    const maybePath = (file as File & { path?: string }).path;
    if (typeof maybePath === 'string' && maybePath.trim()) {
      return maybePath;
    }
    return null;
  }, []);

  const saveInlineFile = useCallback(async (file: File): Promise<string | null> => {
    try {
      const dataBase64 = await fileToBase64(file);
      if (!dataBase64) {
        return null;
      }
      const result = await window.electron.dialog.saveInlineFile({
        dataBase64,
        fileName: file.name,
        mimeType: file.type,
        cwd: workingDirectory,
      });
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('Failed to save inline file:', error);
      return null;
    }
  }, [fileToBase64, workingDirectory]);

  const savePastedBase64File = useCallback(async (parsed: ParsedBase64Paste): Promise<string | null> => {
    try {
      const result = await window.electron.dialog.saveInlineFile({
        dataBase64: parsed.base64Data,
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        cwd: workingDirectory,
      });
      if (result.success && result.path) {
        return result.path;
      }
      console.warn('[CoworkPromptInput] pasted base64 saveInlineFile failed', {
        fileName: parsed.fileName,
        mimeType: parsed.mimeType,
        error: result.error,
      });
      return null;
    } catch (error) {
      console.error('[CoworkPromptInput] failed to save pasted base64 file:', error);
      return null;
    }
  }, [workingDirectory]);

  const handleIncomingFiles = useCallback(async (fileList: FileList | File[]) => {
    if (disabled || isStreaming) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    let hasImageWithoutVision = false;
    for (const file of files) {
      const nativePath = getNativeFilePath(file);

      // Check if this is an image file and model supports images
      const fileIsImage = nativePath
        ? isImagePath(nativePath)
        : isImageMimeType(file.type);

      console.log('[CoworkPromptInput] handleIncomingFiles: processing file', {
        name: file.name,
        type: file.type,
        size: file.size,
        nativePath,
        fileIsImage,
        modelSupportsImage,
        effectiveModelId: effectiveSelectedModel?.id ?? null,
        effectiveModelSupportsImage: effectiveSelectedModel?.supportsImage ?? null,
      });

      if (fileIsImage) {
        if (modelSupportsImage) {
          // For images on vision-capable models, read as data URL
          if (nativePath) {
            try {
              const result = await window.electron.dialog.readFileAsDataUrl(nativePath);
              if (result.success && result.dataUrl) {
                console.log('[CoworkPromptInput] handleIncomingFiles: native image read OK', { nativePath, dataUrlLength: result.dataUrl.length });
                addAttachment(nativePath, { isImage: true, dataUrl: result.dataUrl });
                continue;
              }
              console.warn('[CoworkPromptInput] handleIncomingFiles: readFileAsDataUrl returned falsy', { nativePath, success: result.success });
            } catch (error) {
              console.error('Failed to read image as data URL:', error);
            }
            // Fallback: add as regular file attachment
            console.warn('[CoworkPromptInput] handleIncomingFiles: native image fallback to path-only (no dataUrl)', { nativePath });
            addAttachment(nativePath);
          } else {
            // No native path (clipboard/drag from browser):
            // 1. Read as dataUrl for preview + base64 vision
            // 2. Save to disk so the agent can access the file in later turns
            let dataUrl: string | null = null;
            try {
              dataUrl = await fileToDataUrl(file);
              console.log('[CoworkPromptInput] handleIncomingFiles: clipboard fileToDataUrl OK', { dataUrlLength: dataUrl?.length ?? 0 });
            } catch (error) {
              console.error('[CoworkPromptInput] handleIncomingFiles: clipboard fileToDataUrl FAILED:', error);
            }

            const stagedPath = await saveInlineFile(file);
            console.log('[CoworkPromptInput] handleIncomingFiles: clipboard saveInlineFile result', { stagedPath, hasDataUrl: !!dataUrl });

            if (stagedPath) {
              addAttachment(stagedPath, {
                isImage: true,
                dataUrl: dataUrl ?? undefined,
              });
            } else if (dataUrl) {
              console.warn('Clipboard image saved only in memory (disk save failed)');
              addImageAttachmentFromDataUrl(file.name, dataUrl);
            } else {
              console.error('Failed to process clipboard image: both dataUrl and disk save failed');
            }
          }
          continue;
        }
        // Model doesn't support image input — add as file path and show hint
        console.warn('[CoworkPromptInput] handleIncomingFiles: image skipped vision path because modelSupportsImage=false', {
          fileName: file.name,
          effectiveModelId: effectiveSelectedModel?.id ?? null,
          effectiveModelSupportsImage: effectiveSelectedModel?.supportsImage ?? null,
        });
        hasImageWithoutVision = true;
      }

      // Non-image file or model doesn't support images: use original flow
      if (nativePath) {
        addAttachment(nativePath);
        continue;
      }

      const stagedPath = await saveInlineFile(file);
      if (stagedPath) {
        addAttachment(stagedPath);
      }
    }
    if (hasImageWithoutVision) {
      setImageVisionHint(true);
    }
  }, [addAttachment, addImageAttachmentFromDataUrl, disabled, effectiveSelectedModel, fileToDataUrl, getNativeFilePath, isStreaming, modelSupportsImage, saveInlineFile]);

  const handleAddFile = useCallback(async () => {
    if (isAddingFile || disabled || isStreaming) return;
    setShowAddMenu(false);
    handleCloseSkillsPopover();
    setIsAddingFile(true);
    try {
      const result = await window.electron.dialog.selectFiles({
        title: i18nService.t('coworkAddFile'),
      });
      if (!result.success || result.paths.length === 0) return;
      let hasImageWithoutVision = false;
      for (const filePath of result.paths) {
        if (isImagePath(filePath)) {
          if (modelSupportsImage) {
            try {
              const readResult = await window.electron.dialog.readFileAsDataUrl(filePath);
              if (readResult.success && readResult.dataUrl) {
                console.log('[CoworkPromptInput] handleAddFile: image read OK', { filePath, dataUrlLength: readResult.dataUrl.length });
                addAttachment(filePath, { isImage: true, dataUrl: readResult.dataUrl });
                continue;
              }
              console.warn('[CoworkPromptInput] handleAddFile: readFileAsDataUrl returned falsy', { filePath });
            } catch (error) {
              console.error('Failed to read image as data URL:', error);
            }
          } else {
            console.warn('[CoworkPromptInput] handleAddFile: image skipped vision path because modelSupportsImage=false', {
              filePath,
              effectiveModelId: effectiveSelectedModel?.id ?? null,
            });
            hasImageWithoutVision = true;
          }
        }
        addAttachment(filePath);
      }
      if (hasImageWithoutVision) {
        setImageVisionHint(true);

      }
    } catch (error) {
      console.error('Failed to select file:', error);
    } finally {
      setIsAddingFile(false);
    }
  }, [addAttachment, effectiveSelectedModel, handleCloseSkillsPopover, isAddingFile, disabled, isStreaming, modelSupportsImage]);

  const handleRemoveAttachment = useCallback((path: string) => {
    dispatch(setDraftAttachments({
      draftKey,
      attachments: attachments.filter((attachment) => attachment.path !== path),
    }));
  }, [attachments, dispatch, draftKey]);

  const handleClearBrowserAnnotations = useCallback(() => {
    for (const batch of browserAnnotationBatches) {
      void window.electron?.artifact?.deleteBrowserAnnotationBatchAssets?.({
        draftKey,
        batchId: batch.id,
      });
    }
    dispatch(clearDraftBrowserAnnotationBatches(draftKey));
  }, [browserAnnotationBatches, dispatch, draftKey]);

  const hasFileTransfer = (dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    if (dataTransfer.files.length > 0) return true;
    return Array.from(dataTransfer.types).includes('Files');
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    if (!disabled && !isStreaming) {
      setIsDraggingFiles(true);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = disabled || isStreaming ? 'none' : 'copy';
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFiles(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (disabled || isStreaming) return;
    void handleIncomingFiles(event.dataTransfer.files);
  };

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    const files = getClipboardAttachmentFiles(event.clipboardData);
    if (files.length > 0) {
      if (isStreaming) return;
      event.preventDefault();
      void handleIncomingFiles(files);
      return;
    }

    const pastedText = event.clipboardData.getData('text/plain');
    const parsedBase64 = parsePastedBase64File(pastedText);
    if (!parsedBase64) return;

    event.preventDefault();
    void (async () => {
      const stagedPath = await savePastedBase64File(parsedBase64);
      if (!stagedPath) {
        await window.electron.dialog.showMessageBox({
          type: 'warning',
          message: i18nService.t('coworkPastedBase64SaveFailed'),
        });
        return;
      }

      addAttachment(stagedPath, {
        isImage: isImageMimeType(parsedBase64.mimeType),
      });
    })();
  }, [addAttachment, disabled, handleIncomingFiles, isStreaming, savePastedBase64File]);

  const activeTextareaValue = steerInputActive ? steerValue : value;
  const goalCommandCanRunWhileStreaming = goalInputActive && !!sessionId && !!onGoalCommand;
  const followUpCanQueueWhileStreaming = !!sessionId && !remoteManaged;
  const streamingSubmitCanRun = goalCommandCanRunWhileStreaming || followUpCanQueueWhileStreaming;
  const canSubmit = !disabled
    && !isPatchingModel
    && !agentModelIsInvalid
    && (
      goalInputActive
        ? !!value.trim()
        : steerInputActive
        ? !!steerValue.trim()
        : (!!value.trim() || attachments.length > 0 || browserAnnotationBatches.length > 0)
    );
  const enhancedContainerClass = isDraggingFiles
    ? `${containerClass} ring-2 ring-primary/50 border-primary/60`
    : containerClass;

  const [currentSendShortcut, setCurrentSendShortcut] = useState(
    () => configService.getConfig().shortcuts?.sendMessage ?? 'Enter'
  );
  const sendButtonTitle = `${isStreaming ? i18nService.t('coworkSteerSubmit') : i18nService.t('sendMessage')} (${getSendShortcutLabel(currentSendShortcut)})`;
  const stopButtonLabel = i18nService.t('stop');
  // Sync when config is updated elsewhere (e.g. Settings panel)
  useEffect(() => {
    const syncFromConfig = () => {
      const latest = configService.getConfig().shortcuts?.sendMessage ?? 'Enter';
      setCurrentSendShortcut(latest);
    };
    window.addEventListener('config-updated', syncFromConfig);
    return () => window.removeEventListener('config-updated', syncFromConfig);
  }, []);

  const largeModelSelector = showModelSelector ? (
    <div className="flex flex-col items-start gap-1">
      <ModelSelector
        compact={useHomeContextLayout}
        dropdownDirection="up"
        alignDropdownToTriggerEnd={useHomeContextLayout}
        disabled={isPatchingModel}
        value={agentModelIsInvalid && currentSession?.modelOverride
          ? { id: '__invalid__', name: currentSession.modelOverride.split('/').pop() || currentSession.modelOverride } as Model
          : agentSelectedModel}
        onChange={async (nextModel) => {
          if (isPatchingModel) return;
          if (!nextModel) return;
          const modelRef = toOpenClawModelRef(nextModel);
          const supportsThinking = nextModel.supportsThinking === true;
          if (sessionId) {
            const requestId = modelPatchRequestIdRef.current + 1;
            modelPatchRequestIdRef.current = requestId;
            const previousModelOverride = currentSession?.id === sessionId
              ? currentSession.modelOverride
              : '';

            setIsPatchingModel(true);
            dispatch(updateCurrentSessionModelOverride({ sessionId, modelOverride: modelRef }));

            try {
              const patchedSession = await coworkService.patchSession(sessionId, {
                model: modelRef,
                thinkingLevel: supportsThinking
                  ? OpenClawSessionThinkingLevel.Medium
                  : OpenClawSessionThinkingLevel.Off,
                reasoningLevel: supportsThinking
                  ? OpenClawSessionReasoningLevel.Stream
                  : OpenClawSessionReasoningLevel.Off,
              });
              if (requestId !== modelPatchRequestIdRef.current) return;

              if (!patchedSession) {
                dispatch(updateCurrentSessionModelOverride({
                  sessionId,
                  modelOverride: previousModelOverride,
                }));
                window.dispatchEvent(new CustomEvent('app:showToast', {
                  detail: i18nService.t('coworkModelSwitchFailed'),
                }));
                return;
              }
              void coworkService.refreshContextUsage(sessionId, { notifyCompaction: false });
            } catch {
              if (requestId === modelPatchRequestIdRef.current) {
                dispatch(updateCurrentSessionModelOverride({
                  sessionId,
                  modelOverride: previousModelOverride,
                }));
                window.dispatchEvent(new CustomEvent('app:showToast', {
                  detail: i18nService.t('coworkModelSwitchFailed'),
                }));
              }
            } finally {
              if (requestId === modelPatchRequestIdRef.current) {
                setIsPatchingModel(false);
              }
            }
            return;
          }
          dispatch(setSelectedModel({ agentId: modelTargetAgentId, model: nextModel }));
        }}
      />
      {agentModelIsInvalid && (
        <span className="max-w-60 text-[11px] leading-4 text-red-500">
          {i18nService.t('agentModelInvalidHint')}
        </span>
      )}
    </div>
  ) : null;

  const largeWorkingDirectoryControl = (showFolderSelector || showReadOnlyContext) ? (
    <div className="relative min-w-0 shrink">
      <button
        ref={folderButtonRef}
        type="button"
        onClick={handleWorkingDirectoryControlClick}
        disabled={showReadOnlyContext && !hasWorkingDirectory}
        className={`flex h-[34px] max-w-[220px] min-w-0 shrink items-center gap-1.5 rounded-lg border px-2 text-[13px] transition-colors ${
          showFolderMenu
            ? 'border-[#70a8ff] bg-surface-raised text-foreground'
            : showReadOnlyContext && !hasWorkingDirectory
              ? 'cursor-default border-transparent text-secondary opacity-60'
              : 'border-transparent text-secondary hover:border-[#70a8ff] hover:bg-surface-raised hover:text-foreground'
        }`}
        title={workingDirectory || i18nService.t('noFolderSelected')}
        aria-label={showFolderSelector ? i18nService.t('folderSelect') : i18nService.t('coworkOpenFolder')}
        aria-haspopup={showFolderSelector ? 'menu' : undefined}
        aria-expanded={showFolderSelector ? showFolderMenu : undefined}
      >
        <FolderIcon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">
          {truncatePath(workingDirectory, ContextLabelMaxLength.Folder)}
        </span>
      </button>
      {showFolderSelector && onWorkingDirectoryChange && (
        <FolderSelectorPopover
          isOpen={showFolderMenu}
          onClose={() => setShowFolderMenu(false)}
          onSelectFolder={handleSelectWorkingDirectory}
          anchorRef={folderButtonRef}
          portal
          placement="top"
        />
      )}
    </div>
  ) : null;

  const renderKnowledgeSubmenu = () => (
    <div
      className="absolute bottom-0 left-[calc(100%-1px)] z-50 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-popover"
      role="menu"
      onMouseEnter={cancelCloseKnowledgeSubmenu}
      onMouseLeave={scheduleCloseKnowledgeSubmenu}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">{i18nService.t('knowledgeBase')}</span>
      </div>
      <div className="max-h-[260px] min-h-[180px] overflow-y-auto py-1">
        {isLoadingKnowledgeBases && (
          <div className="px-3 py-3 text-sm text-secondary">{i18nService.t('folderLoading')}</div>
        )}
        {!isLoadingKnowledgeBases && knowledgeBases.length === 0 && (
          <div className="px-3 py-3 text-sm text-secondary">{i18nService.t('knowledgeBaseEmpty')}</div>
        )}
        {!isLoadingKnowledgeBases && knowledgeBases.length > 0 && (
          <div className="py-1">
            {knowledgeBases.map((base) => {
              const selected = selectedKnowledgeBaseIds.includes(base.id);
              return (
                <label
                  key={base.id}
                  className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left hover:bg-surface-raised ${
                    selected ? 'text-primary' : 'text-foreground'
                  }`}
                  role="menuitemcheckbox"
                  aria-checked={selected}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      setSelectedKnowledgeBaseIds((current) => (
                        current.includes(base.id)
                          ? current.filter(id => id !== base.id)
                          : [...current, base.id]
                      ));
                    }}
                    className="h-4 w-4 shrink-0 rounded border-border accent-primary"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{base.name}</span>
                  <span className="shrink-0 truncate text-xs text-secondary">
                    {base.documentCount !== undefined
                      ? `${base.documentCount} ${i18nService.t('knowledgeBaseDocuments')}`
                      : base.description || base.id}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const addMenuAction = !remoteManaged ? (
    <div className="relative">
      <button
        ref={addMenuButtonRef}
        type="button"
        onClick={handleOpenAddMenu}
        className="flex h-[34px] w-[34px] items-center justify-center rounded-lg text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
        title={i18nService.t('add')}
        aria-label={i18nService.t('add')}
        aria-haspopup="menu"
        aria-expanded={showAddMenu || showSkillsPopover}
        disabled={disabled}
      >
        <PromptAddIcon className="h-5 w-5" />
      </button>

      {showAddMenu && (
        <div
          ref={addMenuRef}
          className="absolute bottom-full left-0 z-50 mb-2 w-48 rounded-xl border border-border bg-surface py-1 shadow-popover"
          role="menu"
          onMouseEnter={cancelCloseSkillsPopover}
          onMouseLeave={scheduleCloseSkillsPopover}
        >
          <button
            type="button"
            onClick={handleAddFile}
            onMouseEnter={() => {
              handleCloseSkillsPopover();
              handleCloseKnowledgeSubmenu();
            }}
            onFocus={() => {
              handleCloseSkillsPopover();
              handleCloseKnowledgeSubmenu();
            }}
            disabled={disabled || isStreaming || isAddingFile}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-50"
            role="menuitem"
          >
            <PaperClipIcon className="h-5 w-5 shrink-0 text-secondary" />
            <span className="min-w-0 truncate">{i18nService.t('coworkAddFile')}</span>
          </button>
          <button
            ref={knowledgeMenuItemRef}
            type="button"
            onClick={handleOpenKnowledgeSubmenu}
            onMouseEnter={handleOpenKnowledgeSubmenu}
            onFocus={handleOpenKnowledgeSubmenu}
            disabled={disabled || isStreaming}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              showKnowledgeSubmenu || selectedKnowledgeBaseIds.length > 0
                ? 'bg-surface-raised text-primary'
                : 'text-foreground hover:bg-surface-raised'
            }`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={showKnowledgeSubmenu}
          >
            <AcademicCapIcon className="h-5 w-5 shrink-0 text-secondary" />
            <span className="min-w-0 flex-1 truncate">{i18nService.t('knowledgeBase')}</span>
            {selectedKnowledgeBases.length > 0 && (
              <span className="max-w-[72px] truncate text-xs text-secondary">
                {selectedKnowledgeBases.length}
              </span>
            )}
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-secondary" />
          </button>
          <button
            ref={skillMenuItemRef}
            type="button"
            onClick={handleOpenSkillsPopover}
            onMouseEnter={handleOpenSkillsPopover}
            onFocus={handleOpenSkillsPopover}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition-colors ${
              showSkillsPopover ? 'bg-surface-raised' : 'hover:bg-surface-raised'
            }`}
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={showSkillsPopover}
          >
            <SkillIcon className="h-5 w-5 shrink-0 text-secondary" />
            <span className="min-w-0 flex-1 truncate">{i18nService.t('useSkill')}</span>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-secondary" />
          </button>
          <button
            type="button"
            onClick={() => handleEnableGoalInput(goal ? 'set' : 'start', goal?.objective)}
            onMouseEnter={() => {
              handleCloseSkillsPopover();
              handleCloseKnowledgeSubmenu();
            }}
            onFocus={() => {
              handleCloseSkillsPopover();
              handleCloseKnowledgeSubmenu();
            }}
            disabled={disabled || isPatchingModel || (!!sessionId && !onGoalCommand)}
            className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              goalInputActive ? 'bg-surface-raised text-foreground' : 'text-foreground hover:bg-surface-raised'
            }`}
            role="menuitem"
          >
            <GoalIcon className="h-5 w-5 shrink-0 text-secondary" />
            <span className="shrink-0 text-foreground">{i18nService.t('coworkGoal')}</span>
            {goal?.objective && (
              <span className="min-w-0 flex-1 truncate text-secondary">
                {goal.objective}
              </span>
            )}
          </button>

          <SkillsPopover
            isOpen={showSkillsPopover}
            onClose={() => setShowSkillsPopover(false)}
            onSelectSkill={handleSelectSkill}
            onManageSkills={handleManageSkills}
            anchorRef={skillMenuItemRef as React.RefObject<HTMLElement>}
            asSubmenu
            autoFocusSearch={false}
            onMouseEnter={cancelCloseSkillsPopover}
            onMouseLeave={scheduleCloseSkillsPopover}
          />
          {showKnowledgeSubmenu && renderKnowledgeSubmenu()}
        </div>
      )}
    </div>
  ) : null;

  const largeInputActions = !remoteManaged ? (
    <div className="flex items-center gap-2">
      {addMenuAction}
    </div>
  ) : null;
  const largeSendButtonSizeClass = useCompactSendButton ? 'h-7 w-7' : 'h-8 w-8';
  const largeSendIconSizeClass = useCompactSendButton ? 'h-4 w-4' : 'h-[18px] w-[18px]';
  const canUseSubmitButton = canSubmit && (!isStreaming || streamingSubmitCanRun);

  const largeSubmitButton = (
    <button
      type="button"
      onClick={handleSubmit}
      disabled={!canUseSubmitButton}
      className={`flex ${largeSendButtonSizeClass} items-center justify-center rounded-full transition-all ${
        canUseSubmitButton
          ? 'bg-neutral-950 text-white shadow-subtle hover:bg-neutral-800 active:scale-95 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200'
          : 'cursor-not-allowed bg-neutral-300 text-white dark:bg-neutral-700 dark:text-neutral-500'
      }`}
      aria-label={isStreaming ? i18nService.t('coworkSteerSubmit') : i18nService.t('sendMessage')}
      title={sendButtonTitle}
    >
      <SendButtonIcon className={largeSendIconSizeClass} />
    </button>
  );
  const largeSendButton = isStreaming ? (
    <button
      type="button"
      onClick={handleStopClick}
      className="flex h-[34px] w-[34px] items-center justify-center rounded-full transition-all hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/40"
      aria-label={stopButtonLabel}
      title={stopButtonLabel}
    >
      <TaskPauseIcon className="h-[34px] w-[34px]" aria-hidden="true" />
    </button>
  ) : largeSubmitButton;

  const handleSubmitQueuedFollowUp = useCallback((steerId: string) => {
    if (!sessionId) return;
    if (isStreaming) {
      void coworkService.interruptForQueuedFollowUp(sessionId, steerId);
      return;
    }
    void coworkService.submitQueuedFollowUp(sessionId, steerId);
  }, [isStreaming, sessionId]);

  const handleEditQueuedFollowUp = useCallback((steerId: string, text: string, source: 'pending' | 'rejected') => {
    if (!sessionId) return;
    if (source === 'rejected') {
      dispatch(removeRejectedSteer({ sessionId, steerId }));
    } else {
      dispatch(removePendingSteer({ sessionId, steerId }));
    }
    setValue(text);
    dispatch(setDraftPrompt({ sessionId: draftKey, draft: text }));
    const steer = [...pendingSteers, ...rejectedSteers].find(item => item.id === steerId);
    dispatch(setDraftAttachments({ draftKey, attachments: steer?.attachments ?? [] }));
    dispatch(setDraftBrowserAnnotationBatches({ draftKey, batches: steer?.browserAnnotations ?? [] }));
    setSteerInputActive(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [dispatch, draftKey, pendingSteers, rejectedSteers, sessionId]);

  const handleDeleteQueuedFollowUp = useCallback((steerId: string, source: 'pending' | 'rejected') => {
    if (!sessionId) return;
    if (source === 'rejected') {
      dispatch(removeRejectedSteer({ sessionId, steerId }));
      return;
    }
    dispatch(removePendingSteer({ sessionId, steerId }));
  }, [dispatch, sessionId]);

  const steerPreviewItems = [
    ...pendingSteers.map(steer => ({ steer, source: 'pending' as const })),
    ...rejectedSteers.map(steer => ({ steer, source: 'rejected' as const })),
  ];

  const shouldUseExternalSteerPreview = steerPreviewPortalTarget !== undefined;
  const queuedFollowUpNode = steerPreviewItems.length > 0 ? (
    <div className={shouldUseExternalSteerPreview
      ? `${isCompact ? 'mx-3' : 'mx-5'} max-h-[156px] overflow-y-auto rounded-t-2xl rounded-b-none border border-border bg-surface-raised/60`
      : `${isLarge || isCompact ? 'px-4 pt-3' : 'px-1 pb-2'}`
    }>
      {steerPreviewItems.map(({ steer, source }, index) => {
        const isRejected = source === 'rejected';
        const displayText = steer.text || steer.attachments?.map(attachment => attachment.name).join(', ') || i18nService.t('coworkSteerAttachmentOnly');
        const title = isRejected && steer.error
          ? `${i18nService.t('coworkSteerRejected')}: ${steer.error}`
          : `${i18nService.t('coworkSteerQueued')}: ${displayText}`;
        return (
        <div
          key={steer.id}
          role="status"
          title={title}
          aria-label={title}
          className={`flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-xs ${
            shouldUseExternalSteerPreview
              ? index > 0 ? 'border-t border-border' : ''
              : `${index > 0 ? 'mt-1.5' : ''} rounded-lg border border-border bg-surface-raised/70`
          } ${isRejected ? 'text-warning' : 'text-secondary'}`}
        >
            {isRejected
              ? <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-warning" />
              : <SteerQueueStatusIcon className="h-4 w-4 shrink-0" />}
          <span className={`shrink-0 font-medium ${isRejected ? 'text-warning' : 'text-foreground'}`}>
            {isRejected ? i18nService.t('coworkSteerRejected') : i18nService.t('coworkSteerQueued')}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {displayText}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {!isRejected && (
                <button
                  type="button"
                  onClick={() => handleSubmitQueuedFollowUp(steer.id)}
                  disabled={remoteManaged}
                className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-secondary transition-colors hover:bg-surface hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                title={i18nService.t('coworkSteerInterruptTooltip')}
                aria-label={i18nService.t('coworkSteerInterruptTooltip')}
              >
                <SteerQueueIcon className="h-3.5 w-3.5" />
                <span>{i18nService.t('coworkSteer')}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleEditQueuedFollowUp(steer.id, steer.text, source)}
              className="rounded-md p-1 text-secondary transition-colors hover:bg-surface hover:text-foreground"
              title={i18nService.t('edit')}
              aria-label={i18nService.t('edit')}
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleDeleteQueuedFollowUp(steer.id, source)}
              className="rounded-md p-1 text-secondary transition-colors hover:bg-surface hover:text-foreground"
              title={i18nService.t('delete')}
              aria-label={i18nService.t('delete')}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        );
      })}
    </div>
  ) : null;
  const queuedFollowUpList = queuedFollowUpNode
    ? steerPreviewPortalTarget
      ? createPortal(queuedFollowUpNode, steerPreviewPortalTarget)
      : shouldUseExternalSteerPreview ? null : queuedFollowUpNode
    : null;
  const goalActionsDisabled = disabled || remoteManaged || isPatchingModel || !onGoalCommand;
  const shouldUseExternalGoalStatusBar = goalStatusBarPortalTarget !== undefined;
  const sessionGoalStatusBarNode = goal && !goalInputActive ? (() => {
    const summary = getGoalSummary(goal);
    const detail = goal.lastStatusNote
      ? `${summary}: ${goal.objective} - ${goal.lastStatusNote}`
      : `${summary}: ${goal.objective}`;
    const canTogglePause = goal.status !== CoworkGoalStatus.Complete;
    const pauseCommand = goal.status === CoworkGoalStatus.Active ? '/goal pause' : '/goal resume';
    const pauseLabel = goal.status === CoworkGoalStatus.Active
      ? i18nService.t('coworkGoalPause')
      : i18nService.t('coworkGoalResume');

    return (
      <div className={shouldUseExternalGoalStatusBar ? '' : `${isCompact ? 'px-3 pt-2' : 'px-4 pt-3'}`}>
        <div
          role="status"
          title={detail}
          aria-label={detail}
          className={`flex min-w-0 items-center gap-2 border border-border bg-surface-raised/60 px-2.5 py-1.5 text-xs text-secondary ${
            shouldUseExternalGoalStatusBar
              ? `${isCompact ? 'mx-3' : 'mx-5'} ${goalStatusBarAttached ? 'rounded-t-2xl rounded-b-none border-b-0' : 'rounded-xl'}`
              : 'rounded-xl shadow-subtle'
          }`}
        >
          <GoalIcon className={`h-4 w-4 shrink-0 ${
            goal.status === CoworkGoalStatus.Active
              ? 'text-primary'
              : goal.status === CoworkGoalStatus.Complete
                ? 'text-green-600 dark:text-green-400'
                : 'text-warning'
          }`} />
          <span className="shrink-0 font-semibold text-foreground">{summary}</span>
          <span className="min-w-0 flex-1 truncate">{goal.objective}</span>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => handleEnableGoalInput('set', goal.objective)}
              disabled={goalActionsDisabled}
              className="rounded-md p-1 text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title={i18nService.t('coworkGoalEdit')}
              aria-label={i18nService.t('coworkGoalEdit')}
            >
              <EditIcon className="h-3.5 w-3.5" />
            </button>
            {canTogglePause && (
              <button
                type="button"
                onClick={() => handleGoalCommandClick(pauseCommand)}
                disabled={goalActionsDisabled}
                className="rounded-md p-1 text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                title={pauseLabel}
                aria-label={pauseLabel}
              >
                {goal.status === CoworkGoalStatus.Active
                  ? <PauseCircleIcon className="h-3.5 w-3.5" />
                  : <PlayCircleIcon className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleGoalCommandClick('/goal clear')}
              disabled={goalActionsDisabled}
              className="rounded-md p-1 text-secondary transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title={i18nService.t('coworkGoalClear')}
              aria-label={i18nService.t('coworkGoalClear')}
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  })() : null;
  const sessionGoalStatusBar = sessionGoalStatusBarNode
    ? goalStatusBarPortalTarget
      ? createPortal(sessionGoalStatusBarNode, goalStatusBarPortalTarget)
      : shouldUseExternalGoalStatusBar ? null : sessionGoalStatusBarNode
    : null;

  const activeKnowledgeBadges = hasSelectedKnowledge ? (
    <div className="flex items-center gap-1.5 flex-wrap">
      {selectedKnowledgeBases.map(base => (
        <button
          type="button"
          key={`kb:${base.id}`}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedKnowledgeBaseIds(current => current.filter(id => id !== base.id));
          }}
          className="group inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-[13px] font-normal leading-none text-foreground transition-all hover:bg-primary/15 hover:ring-1 hover:ring-primary/30"
          title={i18nService.t('knowledgeBase')}
        >
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center rounded-sm transition-colors group-hover:bg-primary/15">
            <AcademicCapIcon className="h-3.5 w-3.5 text-primary transition-opacity group-hover:opacity-0" />
            <XMarkIcon className="absolute h-3 w-3 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </span>
          <span className="min-w-0 truncate">{base.name}</span>
        </button>
      ))}
    </div>
  ) : null;

  const attachmentPreviewContent = attachments.length > 0 ? (
    <div className="flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <AttachmentCard
          key={attachment.path}
          attachment={attachment}
          onRemove={handleRemoveAttachment}
        />
      ))}
    </div>
  ) : null;

  const largeAttachmentPreview = attachmentPreviewContent ? (
    <div className={`${isCompact ? 'max-h-[88px] px-3 pb-1 pt-2' : 'max-h-[156px] px-4 pb-1 pt-3'} overflow-y-auto`}>
      {attachmentPreviewContent}
    </div>
  ) : null;

  const selectedTextSnippetPreview = selectedTextSnippets.length > 0 ? (
    <div className={`${isCompact ? 'px-3 pt-2' : 'px-4 pt-3'}`}>
      <SelectedTextSnippetBadge
        snippets={selectedTextSnippets}
        onClear={() => dispatch(clearDraftSelectedTextSnippets(draftKey))}
        onRemove={(snippetId) => dispatch(removeDraftSelectedTextSnippet({ draftKey, snippetId }))}
      />
    </div>
  ) : null;

  const browserAnnotationPreview = browserAnnotationBatches.length > 0 ? (
    <div className={`${isCompact ? 'px-3 pt-2' : 'px-4 pt-3'}`}>
      <BrowserAnnotationAttachmentBadge
        draftKey={draftKey}
        batches={browserAnnotationBatches}
        onClear={handleClearBrowserAnnotations}
      />
    </div>
  ) : null;

  const compactAttachmentPreview = attachmentPreviewContent ? (
    <div className="mb-2 max-h-[136px] overflow-y-auto">
      {attachmentPreviewContent}
    </div>
  ) : null;

  const activeContextRow = isLarge && hasContextBadges ? (
    <div
      className="flex cursor-text flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-4"
      onClick={() => {
        if (!disabled) textareaRef.current?.focus();
      }}
    >
      {hasActiveSkills && <ActiveSkillBadge />}
      {activeKnowledgeBadges}
    </div>
  ) : null;
  const steerModeBadge = steerInputActive ? (
    <button
      type="button"
      onClick={handleToggleSteerInput}
      className={`inline-flex h-7 max-w-[180px] items-center gap-1.5 rounded-md px-2.5 text-[13px] font-normal leading-none transition-all ${
        steerInputActive
          ? 'bg-primary-muted text-primary hover:bg-primary/15 hover:ring-1 hover:ring-primary/30'
          : 'text-secondary hover:bg-surface-raised hover:text-primary'
      }`}
      title={steerInputActive ? i18nService.t('coworkSteerExit') : i18nService.t('coworkSteer')}
      aria-label={steerInputActive ? i18nService.t('coworkSteerExit') : i18nService.t('coworkSteer')}
    >
      <SteerQueueIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{i18nService.t('coworkSteer')}</span>
      {steerInputActive && <XMarkIcon className="h-3 w-3 shrink-0" />}
    </button>
  ) : null;
  const goalModeBadge = goalInputActive ? (
    <button
      type="button"
      onClick={() => resetGoalInput(true)}
      className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-md bg-primary-muted px-2.5 text-[13px] font-normal leading-none text-primary transition-all hover:bg-primary/15 hover:ring-1 hover:ring-primary/30"
      title={i18nService.t('coworkGoalClearInputMode')}
      aria-label={i18nService.t('coworkGoalClearInputMode')}
    >
      <GoalIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 truncate">{i18nService.t('coworkGoal')}</span>
      <XMarkIcon className="h-3 w-3 shrink-0" />
    </button>
  ) : null;
  const activeModeRow = isLarge && (steerModeBadge || goalModeBadge) ? (
    <div
      className={`flex cursor-text flex-wrap items-center gap-x-2 gap-y-1 px-4 ${hasContextBadges ? 'pt-2' : 'pt-4'}`}
      onClick={() => {
        if (!disabled) textareaRef.current?.focus();
      }}
    >
      {steerModeBadge}
      {goalModeBadge}
    </div>
  ) : null;
  const textareaPlaceholder = goalInputActive
    ? i18nService.t('coworkGoalInputPlaceholder')
    : steerInputActive ? i18nService.t('coworkSteerPlaceholder') : placeholder;

  const readOnlyContextRow = isLarge && showReadOnlyContext && !useHomeContextLayout ? (
    <div className="my-2 grid min-h-7 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-4">
      <div aria-hidden="true" />
      {readOnlyContextTrailingText && (
        <span className="pointer-events-none min-w-0 max-w-full select-none truncate text-center text-[13px] text-muted opacity-85">
          {readOnlyContextTrailingText}
        </span>
      )}
      <div aria-hidden="true" />
    </div>
  ) : null;

  return (
    <div className="relative">
      {queuedFollowUpList}
      {sessionGoalStatusBar}
      {!isLarge && !isCompact && compactAttachmentPreview}
      {!isLarge && !isCompact && selectedTextSnippetPreview}
      {!isLarge && !isCompact && browserAnnotationPreview}
      {imageVisionHint && (
        <div className="mb-2 flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">
          <ExclamationTriangleIcon className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
          <span>
            {i18nService.t('imageVisionHint')}
          </span>
          <button
            type="button"
            onClick={() => setImageVisionHint(false)}
            className="ml-auto flex-shrink-0 rounded-full p-0.5 hover:bg-amber-200/50 dark:hover:bg-amber-800/50"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </div>
      )}
      <div
        className={enhancedContainerClass}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[inherit] bg-primary/10 text-xs font-medium text-primary">
            {i18nService.t('coworkDropFileHint')}
          </div>
        )}
        {isLarge || isCompact ? (
          useHomeContextLayout ? (
            <>
              <div className="relative z-10 rounded-2xl border border-border bg-surface shadow-card">
                {largeAttachmentPreview}
                {selectedTextSnippetPreview}
                {browserAnnotationPreview}
                {activeContextRow}
                {activeModeRow}
                <textarea
                  ref={textareaRef}
                  value={activeTextareaValue}
                  onChange={(e) => {
                    if (steerInputActive) {
                      setSteerValue(e.target.value);
                    } else {
                      setValue(e.target.value);
                    }
                  }}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={textareaPlaceholder}
                  disabled={disabled}
                  rows={2}
                  className={textareaClass}
                  style={{ minHeight: `${minHeight}px` }}
                />
                <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-1">
                  <div className="flex min-w-0 items-center gap-2">
                    {largeInputActions}
                    {largeWorkingDirectoryControl}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {contextUsageControl}
                    {largeModelSelector}
                    {largeSendButton}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {largeAttachmentPreview}
              {selectedTextSnippetPreview}
              {browserAnnotationPreview}
              {activeContextRow}
              {activeModeRow}
              <textarea
                ref={textareaRef}
                value={activeTextareaValue}
                onChange={(e) => {
                  if (steerInputActive) {
                    setSteerValue(e.target.value);
                  } else {
                    setValue(e.target.value);
                  }
                }}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={textareaPlaceholder}
                disabled={disabled}
                rows={2}
                className={textareaClass}
                style={{ minHeight: `${minHeight}px` }}
              />
              <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-1.5">
                <div className="flex min-w-0 items-center">
                  {largeInputActions}
                  {largeWorkingDirectoryControl}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {contextUsageControl}
                  {largeModelSelector}
                  {largeSendButton}
                </div>
              </div>
            </>
          )
        ) : (
          <>
            {compactAttachmentPreview}
            {selectedTextSnippetPreview}
            {browserAnnotationPreview}
            <textarea
              ref={textareaRef}
              value={activeTextareaValue}
              onChange={(e) => {
                if (steerInputActive) {
                  setSteerValue(e.target.value);
                } else {
                  setValue(e.target.value);
                }
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={textareaPlaceholder}
              disabled={disabled}
              rows={1}
              className={textareaClass}
            />

            {!remoteManaged && (
              <div className="flex items-center gap-1">
                {largeInputActions}
              </div>
            )}

            {isStreaming ? (
              <div className="flex flex-shrink-0 items-center gap-3">
                {contextUsageControl}
                <button
                  type="button"
                  onClick={handleStopClick}
                  className="flex h-[34px] w-[34px] items-center justify-center rounded-full transition-all hover:opacity-90 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  aria-label={stopButtonLabel}
                  title={stopButtonLabel}
                >
                  <TaskPauseIcon className="h-[34px] w-[34px]" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="flex flex-shrink-0 items-center gap-3">
                {contextUsageControl}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canUseSubmitButton}
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full transition-all ${
                    canUseSubmitButton
                      ? 'bg-neutral-950 text-white shadow-subtle hover:bg-neutral-800 active:scale-95 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200'
                      : 'cursor-not-allowed bg-neutral-300 text-white dark:bg-neutral-700 dark:text-neutral-500'
                  }`}
                  aria-label={i18nService.t('sendMessage')}
                  title={sendButtonTitle}
                >
                  <ArrowUpIcon className="h-[17px] w-[17px]" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {readOnlyContextRow}
    </div>
  );
  }
);

CoworkPromptInput.displayName = 'CoworkPromptInput';

export default CoworkPromptInput;
