import {
  hotkeysCoreFeature,
  type ItemInstance,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import {
  ChevronRightIcon,
  DocumentIcon,
  FolderIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { CoworkArtifactResourceSession } from '../../../shared/cowork/artifacts';
import type { OpenKnowledgeGraphEventDetail } from '../../../shared/knowledge/constants';
import { agentService } from '../../services/agent';
import { loadDetectedFileArtifact } from '../../services/artifactDetection';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import type { Artifact } from '../../types/artifact';
import { getAgentDisplayNameById } from '../../utils/agentDisplay';
import ArtifactRenderer from '../artifacts/ArtifactRenderer';
import FolderViewTabs, { type FolderViewTab } from './FolderViewTabs';
import KnowledgeBaseFrame from './KnowledgeBaseFrame';

type FolderTreeNodeKind = 'root' | 'agent' | 'session' | 'artifact';

interface FolderTreeNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  kind: FolderTreeNodeKind;
  size: number;
  modifiedAt: number;
  childCount?: number;
  children: string[];
  loaded: boolean;
  agentId?: string;
  sessionId?: string;
  sessionCwd?: string;
  artifact?: Artifact;
}

interface FolderViewProps {
  knowledgeGraphTarget?: OpenKnowledgeGraphEventDetail | null;
  onKnowledgeGraphTargetConsumed?: () => void;
}

const ROOT_ID = '__folder-root__';

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
};

const formatModifiedAt = (timestamp: number): string => {
  if (!timestamp) return '-';
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
};

const makeRootNode = (children: string[] = []): FolderTreeNode => ({
  id: ROOT_ID,
  name: 'root',
  path: '',
  isDirectory: true,
  kind: 'root',
  size: 0,
  modifiedAt: 0,
  children,
  loaded: true,
});

const makeFallbackNode = (id: string): FolderTreeNode => ({
  id,
  name: id,
  path: '',
  isDirectory: false,
  kind: 'artifact',
  size: 0,
  modifiedAt: 0,
  children: [],
  loaded: true,
});

const makeAgentNodeId = (agentId: string): string => `agent:${agentId}`;
const makeSessionNodeId = (agentId: string, sessionId: string): string => `session:${agentId}:${sessionId}`;
const makeArtifactNodeId = (sessionId: string, artifactId: string): string => `artifact:${sessionId}:${artifactId}`;

const getArtifactDisplayName = (artifact: Artifact): string => (
  artifact.fileName || artifact.title || artifact.filePath || artifact.remoteUrl || artifact.url || artifact.id
);

const getArtifactSize = (artifact: Artifact): number => {
  if (artifact.preview?.size) return artifact.preview.size;
  if (artifact.content) return new Blob([artifact.content]).size;
  return 0;
};

const openPath = async (targetPath: string): Promise<void> => {
  const normalizedPath = targetPath.trim();
  if (!normalizedPath) return;
  const result = await window.electron?.shell?.openPath(normalizedPath);
  if (result && !result.success) {
    window.dispatchEvent(new CustomEvent('app:showToast', {
      detail: result.error || i18nService.t('showInFolderFailed'),
    }));
  }
};

const openArtifact = async (artifact: Artifact | undefined): Promise<void> => {
  if (!artifact) return;
  const targetPath = artifact.filePath?.trim();
  if (targetPath) {
    await openPath(targetPath);
    return;
  }
  const targetUrl = artifact.remoteUrl?.trim() || artifact.url?.trim();
  if (!targetUrl) return;
  const result = await window.electron?.shell?.openExternal(targetUrl);
  if (result && !result.success) {
    window.dispatchEvent(new CustomEvent('app:showToast', {
      detail: result.error || i18nService.t('showInFolderFailed'),
    }));
  }
};

const getNodeSecondaryText = (node: FolderTreeNode): string => {
  if (node.kind === 'agent' || node.kind === 'session') {
    return `${node.size} ${i18nService.t('folderResourceUnit')}`;
  }
  const type = node.artifact?.type ?? '-';
  return node.size > 0 ? `${type} · ${formatBytes(node.size)}` : type;
};

const FolderView: React.FC<FolderViewProps> = ({
  knowledgeGraphTarget = null,
  onKnowledgeGraphTargetConsumed,
}) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const artifactSnapshotVersion = useSelector((state: RootState) =>
    Object.entries(state.artifact.artifactsBySession)
      .map(([sessionId, artifacts]) => `${sessionId}:${artifacts.length}:${artifacts.map(artifact => artifact.id).join(',')}`)
      .join('|')
  );
  const sessionSnapshotVersion = useSelector((state: RootState) =>
    state.cowork.sessions
      .map((session) => `${session.id}:${session.agentId}:${session.updatedAt}`)
      .join('|')
  );
  const [resourceSessions, setResourceSessions] = useState<CoworkArtifactResourceSession[]>([]);
  const [isLoadingResources, setIsLoadingResources] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([ROOT_ID]);
  const [previewNode, setPreviewNode] = useState<FolderTreeNode | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FolderViewTab>('files');
  const didAutoExpandResourcesRef = useRef(false);

  useEffect(() => {
    void coworkService.loadConfig();
    void agentService.loadAgents();
  }, []);

  useEffect(() => {
    if (!knowledgeGraphTarget) return;
    setActiveTab('knowledge');
  }, [knowledgeGraphTarget]);

  useEffect(() => {
    let disposed = false;

    const loadResourceSessions = async () => {
      setIsLoadingResources(true);
      try {
        const result = await coworkService.listArtifactResources();
        if (disposed) return;
        if (!result.success) {
          window.dispatchEvent(new CustomEvent('app:showToast', {
            detail: result.error || i18nService.t('folderLoadFailed'),
          }));
          setResourceSessions([]);
          return;
        }
        setResourceSessions(result.sessions ?? []);
      } finally {
        if (!disposed) {
          setIsLoadingResources(false);
        }
      }
    };

    if (activeTab === 'files') {
      void loadResourceSessions();
    }
    return () => {
      disposed = true;
    };
  }, [activeTab, artifactSnapshotVersion, sessionSnapshotVersion]);

  useEffect(() => {
    if (activeTab !== 'files') return;
    if (didAutoExpandResourcesRef.current) return;
    if (resourceSessions.length === 0) return;

    didAutoExpandResourcesRef.current = true;
    setExpandedItems((current) => {
      const nextExpanded = new Set(current);
      nextExpanded.add(ROOT_ID);
      for (const session of resourceSessions) {
        nextExpanded.add(makeAgentNodeId(session.agentId));
        if (session.artifacts.length > 0) {
          nextExpanded.add(makeSessionNodeId(session.agentId, session.id));
        }
      }
      return Array.from(nextExpanded);
    });
  }, [activeTab, resourceSessions]);

  const nodes = useMemo<Record<string, FolderTreeNode>>(() => {
    const sessionsByAgentId = new Map<string, CoworkArtifactResourceSession[]>();
    for (const session of resourceSessions) {
      const existing = sessionsByAgentId.get(session.agentId) ?? [];
      existing.push(session);
      sessionsByAgentId.set(session.agentId, existing);
    }

    const nextNodes: Record<string, FolderTreeNode> = {};
    const rootChildren: string[] = [];
    const agentIds = Array.from(sessionsByAgentId.keys());

    for (const agentId of agentIds) {
      const sessions = sessionsByAgentId.get(agentId) ?? [];
      const agentNodeId = makeAgentNodeId(agentId);
      const sessionNodeIds = sessions.map((session) => makeSessionNodeId(agentId, session.id));
      rootChildren.push(agentNodeId);
      nextNodes[agentNodeId] = {
        id: agentNodeId,
        name: getAgentDisplayNameById(agentId, agents) || agentId,
        path: '',
        isDirectory: true,
        kind: 'agent',
        size: sessions.reduce((sum, session) => sum + session.artifacts.length, 0),
        modifiedAt: Math.max(...sessions.map((session) => session.updatedAt), 0),
        childCount: sessionNodeIds.length,
        children: sessionNodeIds,
        loaded: true,
        agentId,
      };

      for (const session of sessions) {
        const sessionNodeId = makeSessionNodeId(agentId, session.id);
        const artifactNodeIds = session.artifacts.map((artifact) => makeArtifactNodeId(session.id, artifact.id));
        nextNodes[sessionNodeId] = {
          id: sessionNodeId,
          name: session.title || i18nService.t('coworkNewSession'),
          path: session.cwd,
          isDirectory: true,
          kind: 'session',
          size: session.artifacts.length,
          modifiedAt: session.updatedAt || session.createdAt,
          childCount: artifactNodeIds.length,
          children: artifactNodeIds,
          loaded: true,
          agentId,
          sessionId: session.id,
          sessionCwd: session.cwd,
        };

        for (const artifact of session.artifacts) {
          const artifactNodeId = makeArtifactNodeId(session.id, artifact.id);
          nextNodes[artifactNodeId] = {
            id: artifactNodeId,
            name: getArtifactDisplayName(artifact),
            path: artifact.filePath || artifact.remoteUrl || artifact.url || '',
            isDirectory: false,
            kind: 'artifact',
            size: getArtifactSize(artifact),
            modifiedAt: artifact.createdAt,
            children: [],
            loaded: true,
            agentId,
            sessionId: session.id,
            sessionCwd: session.cwd,
            artifact,
          };
        }
      }
    }

    return {
      [ROOT_ID]: makeRootNode(rootChildren),
      ...nextNodes,
    };
  }, [agents, resourceSessions]);

  const previewResource = useCallback(async (node: FolderTreeNode) => {
    if (node.isDirectory || !node.artifact) return;
    const artifact = node.artifact;
    setPreviewNode(node);
    setPreviewArtifact(null);
    setPreviewError(null);

    if (!artifact.filePath || artifact.content) {
      setPreviewArtifact(artifact);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    try {
      const loaded = await loadDetectedFileArtifact(artifact, node.sessionCwd);
      if (!loaded) {
        setPreviewError(i18nService.t('folderPreviewLoadFailed'));
        return;
      }
      setPreviewArtifact(loaded);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : i18nService.t('folderPreviewLoadFailed'));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const tree = useTree<FolderTreeNode>({
    state: { expandedItems },
    setExpandedItems,
    rootItemId: ROOT_ID,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isDirectory,
    dataLoader: {
      getItem: (itemId) => nodes[itemId] ?? makeFallbackNode(itemId),
      getChildren: (itemId) => nodes[itemId]?.children ?? [],
    },
    indent: 18,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature],
  });

  tree.scheduleRebuildTree();
  const visibleItems = tree.getItems();

  const renderRow = (item: ItemInstance<FolderTreeNode>) => {
    const node = item.getItemData();
    const level = item.getItemMeta().level;
    const canExpand = node.isDirectory && (node.childCount ?? node.children.length) > 0;
    const rowProps = item.getProps();
    const toggleExpanded = () => {
      if (item.isExpanded()) {
        item.collapse();
      } else {
        item.expand();
      }
    };

    return (
      <button
        {...rowProps}
        key={item.getId()}
        type="button"
        onClick={(event) => {
          if (event.detail > 1) return;
          item.setFocused();
          if (node.isDirectory) {
            toggleExpanded();
          } else {
            void previewResource(node);
          }
        }}
        onDoubleClick={() => {
          if (!node.isDirectory) {
            void openArtifact(node.artifact);
          }
        }}
        className="group block w-full border-0 bg-transparent px-2 py-0.5 text-left text-sm outline-none"
      >
        <div className={`grid w-full grid-cols-[1fr_140px_160px] items-center rounded-md transition-colors ${
          item.isSelected() ? 'bg-surface-raised' : 'group-hover:bg-surface-raised'
        }`}
        >
          <div
            className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-foreground"
            style={{ paddingLeft: `${12 + level * 18}px` }}
          >
            {canExpand ? (
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted hover:bg-surface-raised"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleExpanded();
                }}
              >
                <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${item.isExpanded() ? 'rotate-90' : ''}`} />
              </span>
            ) : (
              <span className="h-4 w-4 shrink-0" />
            )}
            {node.isDirectory ? (
              <FolderIcon className="h-4 w-4 shrink-0 text-muted" />
            ) : (
              <DocumentIcon className="h-4 w-4 shrink-0 text-muted" />
            )}
            <span className="truncate">{node.name}</span>
          </div>
          <div className="px-4 py-2.5 text-xs text-muted">{getNodeSecondaryText(node)}</div>
          <div className="px-4 py-2.5 text-xs text-muted">{formatModifiedAt(node.modifiedAt)}</div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <div className="draggable flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex h-8 items-center gap-5">
          <FolderViewTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>
        <div className="flex items-center gap-3">
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        {activeTab === 'knowledge' ? (
          <KnowledgeBaseFrame
            graphTarget={knowledgeGraphTarget}
            onGraphTargetConsumed={onKnowledgeGraphTargetConsumed}
          />
        ) : (
        <div className="flex h-full gap-3 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
            <div className="grid h-10 shrink-0 grid-cols-[1fr_140px_160px] items-center border-b border-border bg-surface text-xs text-secondary">
              <div className="px-6">{i18nService.t('folderColumnName')}</div>
              <div className="px-4">{i18nService.t('folderColumnResource')}</div>
              <div className="px-4">{i18nService.t('folderColumnModified')}</div>
            </div>
            <div {...tree.getContainerProps()} className="flex-1 overflow-y-auto py-2">
              {isLoadingResources ? (
                <div className="px-6 py-8 text-sm text-secondary">{i18nService.t('folderLoading')}</div>
              ) : visibleItems.length === 0 ? (
                <div className="px-6 py-8 text-sm text-secondary">{i18nService.t('folderEmpty')}</div>
              ) : (
                visibleItems.map(renderRow)
              )}
            </div>
          </div>

          {previewNode && (
            <div className="flex w-[42%] min-w-[360px] max-w-[640px] flex-col overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface px-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{previewNode.name}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void openArtifact(previewNode.artifact)}
                    className="rounded px-2 py-1 text-xs text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                  >
                    {i18nService.t('artifactOpenWithApp')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewNode(null);
                      setPreviewArtifact(null);
                      setPreviewError(null);
                    }}
                    className="rounded px-2 py-1 text-xs text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
                    aria-label={i18nService.t('artifactCloseTab')}
                  >
                    ×
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {previewLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted">
                    {i18nService.t('artifactSourceLoading')}
                  </div>
                ) : previewError ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
                    {previewError}
                  </div>
                ) : previewArtifact ? (
                  <ArtifactRenderer artifact={previewArtifact} />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <div className="text-sm text-muted">{i18nService.t('artifactNoPreview')}</div>
                    <button
                      type="button"
                      onClick={() => void openArtifact(previewNode.artifact)}
                      className="rounded bg-primary px-3 py-1.5 text-xs text-white transition-colors hover:bg-primary/90"
                    >
                      {i18nService.t('artifactOpenWithApp')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

export default FolderView;
