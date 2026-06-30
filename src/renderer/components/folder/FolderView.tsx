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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import type { FolderTreeEntry } from '../../../shared/folder/constants';
import { KnowledgeNavigationEvent } from '../../../shared/knowledge/constants';
import { agentService } from '../../services/agent';
import { getArtifactTypeFromExtension } from '../../services/artifactParser';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { RootState } from '../../store';
import type { Artifact, ArtifactType } from '../../types/artifact';
import { ArtifactTypeValue } from '../../types/artifact';
import ArtifactRenderer from '../artifacts/ArtifactRenderer';
import FolderViewTabs, { type FolderViewTab } from './FolderViewTabs';
import KnowledgeBaseFrame from './KnowledgeBaseFrame';

interface FolderTreeNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
  childCount?: number;
  children: string[];
  loaded: boolean;
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

const getFileExtension = (filePath: string): string => {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot === -1 ? '' : filePath.slice(lastDot).toLowerCase();
};

const CONTENT_PRELOAD_TYPES = new Set<ArtifactType>([
  ArtifactTypeValue.Image,
  ArtifactTypeValue.Svg,
  ArtifactTypeValue.Markdown,
  ArtifactTypeValue.Text,
  ArtifactTypeValue.Mermaid,
]);

const makeRootNode = (children: string[] = []): FolderTreeNode => ({
  id: ROOT_ID,
  name: 'root',
  path: '',
  isDirectory: true,
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
  size: 0,
  modifiedAt: 0,
  children: [],
  loaded: true,
});

const makeRootEntryId = (entryPath: string): string => `root:${entryPath}`;

const makeChildEntryId = (parentId: string, entryPath: string): string => `child:${parentId}:${entryPath}`;

const entryToNode = (entry: FolderTreeEntry, id = entry.id): FolderTreeNode => ({
  id,
  name: entry.name,
  path: entry.path,
  isDirectory: entry.isDirectory,
  size: entry.size,
  modifiedAt: entry.modifiedAt,
  childCount: entry.childCount,
  children: [],
  loaded: !entry.isDirectory || entry.childCount === 0,
});

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

const FolderView: React.FC = () => {
  const configWorkingDirectory = useSelector((state: RootState) => state.cowork.config.workingDirectory);
  const agents = useSelector((state: RootState) => state.agent.agents);
  const [nodes, setNodes] = useState<Record<string, FolderTreeNode>>(() => ({
    [ROOT_ID]: makeRootNode(),
  }));
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [expandedItems, setExpandedItems] = useState<string[]>([ROOT_ID]);
  const [previewNode, setPreviewNode] = useState<FolderTreeNode | null>(null);
  const [previewArtifact, setPreviewArtifact] = useState<Artifact | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<FolderViewTab>('files');

  useEffect(() => {
    void coworkService.loadConfig();
    void agentService.loadAgents();
  }, []);

  useEffect(() => {
    const handleOpenKnowledgeGraph = () => {
      setActiveTab('knowledge');
    };
    window.addEventListener(KnowledgeNavigationEvent.OpenGraph, handleOpenKnowledgeGraph);
    return () => {
      window.removeEventListener(KnowledgeNavigationEvent.OpenGraph, handleOpenKnowledgeGraph);
    };
  }, []);

  const rootEntries = useMemo(() => {
    const entries: FolderTreeEntry[] = [];
    const seenPaths = new Set<string>();
    const addEntry = (entry: Omit<FolderTreeEntry, 'id' | 'isDirectory' | 'size' | 'modifiedAt'>) => {
      const normalizedPath = entry.path.trim();
      if (!normalizedPath || seenPaths.has(normalizedPath)) return;
      seenPaths.add(normalizedPath);
      entries.push({
        ...entry,
        id: makeRootEntryId(normalizedPath),
        path: normalizedPath,
        isDirectory: true,
        size: 0,
        modifiedAt: 0,
        childCount: 1,
      });
    };

    if (configWorkingDirectory.trim()) {
      addEntry({
        name: i18nService.t('folderWorkspaceRoot'),
        path: configWorkingDirectory,
        childCount: 1,
      });
    }

    for (const agent of agents) {
      addEntry({
        name: agent.name,
        path: agent.workingDirectory,
        childCount: 1,
      });
    }

    return entries;
  }, [agents, configWorkingDirectory]);

  useEffect(() => {
    setNodes((current) => {
      const rootIds = rootEntries.map((entry) => entry.id);
      const nextNodes: Record<string, FolderTreeNode> = {
        [ROOT_ID]: makeRootNode(rootIds),
      };
      for (const entry of rootEntries) {
        nextNodes[entry.id] = current[entry.id] ?? entryToNode(entry);
      }
      return nextNodes;
    });
  }, [rootEntries]);

  useEffect(() => {
    if (rootEntries.length === 0) return;
    let disposed = false;

    const loadRootEntryMetadata = async () => {
      const result = await window.electron?.folder?.getEntries(rootEntries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        path: entry.path,
      })));
      if (disposed || !result?.success) return;
      const nextRootNodes = Object.fromEntries((result.entries ?? []).map((entry) => [entry.id, entryToNode(entry)]));
      setNodes((current) => ({
        ...current,
        ...nextRootNodes,
      }));
    };

    void loadRootEntryMetadata();
    return () => {
      disposed = true;
    };
  }, [rootEntries]);

  const loadChildren = useCallback(async (node: FolderTreeNode) => {
    if (!node.isDirectory || node.loaded || loadingIds.has(node.id)) return;
    setLoadingIds((current) => new Set(current).add(node.id));
    try {
      const result = await window.electron?.folder?.listChildren(node.path);
      if (!result?.success) {
        window.dispatchEvent(new CustomEvent('app:showToast', {
          detail: result?.error || i18nService.t('folderLoadFailed'),
        }));
        return;
      }
      const childNodes = (result.entries ?? []).map((entry) => entryToNode(
        entry,
        makeChildEntryId(node.id, entry.path),
      ));
      setNodes((current) => ({
        ...current,
        [node.id]: {
          ...current[node.id],
          size: childNodes.reduce((sum, child) => sum + child.size, 0),
          children: childNodes.map((child) => child.id),
          loaded: true,
        },
        ...Object.fromEntries(childNodes.map((child) => [child.id, child])),
      }));
    } finally {
      setLoadingIds((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
    }
  }, [loadingIds]);

  const previewFile = useCallback(async (node: FolderTreeNode) => {
    if (node.isDirectory) return;
    const artifactType = getArtifactTypeFromExtension(getFileExtension(node.path));
    setPreviewNode(node);
    setPreviewArtifact(null);
    setPreviewError(null);

    if (!artifactType) {
      setPreviewLoading(false);
      return;
    }

    const artifact: Artifact = {
      id: `folder-preview-${node.id}`,
      messageId: 'folder-preview',
      sessionId: 'folder',
      type: artifactType,
      title: node.name,
      content: '',
      fileName: node.name,
      filePath: node.path,
      createdAt: Date.now(),
    };

    if (!CONTENT_PRELOAD_TYPES.has(artifactType)) {
      setPreviewArtifact(artifact);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    try {
      if (artifactType === ArtifactTypeValue.Image) {
        const result = await window.electron?.dialog?.readFileAsDataUrl(node.path);
        if (!result?.success || !result.dataUrl) {
          setPreviewError(result?.error || i18nService.t('folderPreviewLoadFailed'));
          return;
        }
        setPreviewArtifact({ ...artifact, content: result.dataUrl });
        return;
      }

      const result = await window.electron?.dialog?.readTextFile(node.path);
      if (!result?.success || typeof result.content !== 'string') {
        setPreviewError(result?.error || i18nService.t('folderPreviewLoadFailed'));
        return;
      }
      setPreviewArtifact({ ...artifact, content: result.content });
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
    const isLoading = loadingIds.has(node.id);
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
            void loadChildren(node);
            toggleExpanded();
          } else {
            void previewFile(node);
          }
        }}
        onDoubleClick={() => {
          if (!node.isDirectory) {
            void openPath(node.path);
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
                  void loadChildren(node);
                  toggleExpanded();
                }}
              >
                <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${isLoading ? 'animate-spin opacity-60' : item.isExpanded() ? 'rotate-90' : ''}`} />
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
            {isLoading && <span className="text-xs text-muted">{i18nService.t('folderLoading')}</span>}
          </div>
          <div className="px-4 py-2.5 text-xs text-muted">{formatBytes(node.size)}</div>
          <div className="px-4 py-2.5 text-xs text-muted">{formatModifiedAt(node.modifiedAt)}</div>
        </div>
      </button>
    );
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-background">
      <div className="draggable flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex h-8 items-center gap-5">
          <h1 className="text-lg font-semibold text-foreground">
            {i18nService.t('folderAllFiles')}
          </h1>
          <FolderViewTabs activeTab={activeTab} onChange={setActiveTab} />
        </div>
        <div className="flex items-center gap-3">
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4">
        {activeTab === 'knowledge' ? (
          <KnowledgeBaseFrame />
        ) : (
        <div className="flex h-full gap-3 overflow-hidden">
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
            <div className="grid h-10 shrink-0 grid-cols-[1fr_140px_160px] items-center border-b border-border bg-surface text-xs text-secondary">
              <div className="px-6">{i18nService.t('folderColumnName')}</div>
              <div className="px-4">{i18nService.t('folderColumnSize')}</div>
              <div className="px-4">{i18nService.t('folderColumnModified')}</div>
            </div>
            <div {...tree.getContainerProps()} className="flex-1 overflow-y-auto py-2">
              {visibleItems.length === 0 ? (
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
                    onClick={() => void openPath(previewNode.path)}
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
                      onClick={() => void openPath(previewNode.path)}
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
