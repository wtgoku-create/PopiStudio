export interface PopiTVCanvasNodeSummary {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface PopiTVCanvasEdgeSummary {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface PopiTVCanvasSnapshot {
  sessionId?: string | null;
  workflowId: string | null;
  workflowName: string | null;
  nodeCount: number;
  edgeCount: number;
  isRunning: boolean;
  currentNodeIds: string[];
  hasUnsavedChanges: boolean;
  nodes?: PopiTVCanvasNodeSummary[];
  edges?: PopiTVCanvasEdgeSummary[];
}

interface StoredSnapshot {
  snapshot: PopiTVCanvasSnapshot;
  receivedAt: number;
}

const snapshotsBySessionId = new Map<string, StoredSnapshot>();

const formatDataSummary = (data?: Record<string, unknown>): string => {
  if (!data || Object.keys(data).length === 0) return '';

  return Object.entries(data)
    .slice(0, 6)
    .map(([key, value]) => {
      if (typeof value === 'string') return `${key}=${JSON.stringify(value)}`;
      return `${key}=${JSON.stringify(value)}`;
    })
    .join(', ');
};

export const setPopiTVCanvasSnapshot = (
  sessionId: string,
  snapshot: PopiTVCanvasSnapshot,
): void => {
  snapshotsBySessionId.set(sessionId, {
    snapshot,
    receivedAt: Date.now(),
  });
};

export const clearPopiTVCanvasSnapshot = (sessionId: string): void => {
  snapshotsBySessionId.delete(sessionId);
};

export const buildPopiTVCanvasContextPrompt = (sessionId?: string): string => {
  if (!sessionId) {
    return [
      '<popitv_canvas_context>',
      'snapshot_status: pending_session',
      'The PopiTV canvas will open after this session is created.',
      'Do not claim you inspected or modified the canvas until a snapshot is available.',
      '</popitv_canvas_context>',
    ].join('\n');
  }

  const stored = snapshotsBySessionId.get(sessionId);
  if (!stored) {
    return [
      '<popitv_canvas_context>',
      `session_id: ${sessionId}`,
      'snapshot_status: unavailable',
      'No live canvas snapshot has been received yet.',
      'Do not claim you inspected or modified the canvas until a snapshot is available.',
      '</popitv_canvas_context>',
    ].join('\n');
  }

  const { snapshot, receivedAt } = stored;
  const nodes = snapshot.nodes ?? [];
  const edges = snapshot.edges ?? [];
  const nodeLines = nodes.slice(0, 20).map(node => {
    const dataSummary = formatDataSummary(node.data);
    return `- ${node.id} type=${node.type ?? 'unknown'}${dataSummary ? ` data: ${dataSummary}` : ''}`;
  });
  const edgeLines = edges
    .slice(0, 40)
    .map(
      edge =>
        `- ${edge.source}${edge.sourceHandle ? `:${edge.sourceHandle}` : ''} -> ${edge.target}${edge.targetHandle ? `:${edge.targetHandle}` : ''}`,
    );

  return [
    '<popitv_canvas_context>',
    `session_id: ${sessionId}`,
    'snapshot_status: live',
    `snapshot_age_ms: ${Date.now() - receivedAt}`,
    `workflow_id: ${snapshot.workflowId ?? 'none'}`,
    `workflow_name: ${snapshot.workflowName ?? 'Untitled'}`,
    `node_count: ${snapshot.nodeCount}`,
    `edge_count: ${snapshot.edgeCount}`,
    `is_running: ${snapshot.isRunning}`,
    `current_node_ids: ${snapshot.currentNodeIds.join(', ') || 'none'}`,
    `has_unsaved_changes: ${snapshot.hasUnsavedChanges}`,
    'nodes:',
    nodeLines.length > 0 ? nodeLines.join('\n') : '- none',
    'edges:',
    edgeLines.length > 0 ? edgeLines.join('\n') : '- none',
    '</popitv_canvas_context>',
  ].join('\n');
};

export const appendPopiTVCanvasContext = (
  skillPrompt: string | undefined,
  options: {
    shouldInclude: boolean;
    sessionId?: string;
  },
): string | undefined => {
  if (!options.shouldInclude) return skillPrompt;

  return [skillPrompt?.trim(), buildPopiTVCanvasContextPrompt(options.sessionId)]
    .filter(Boolean)
    .join('\n\n');
};
