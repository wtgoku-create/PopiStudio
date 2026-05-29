export interface McpToolManifestEntry {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const POPITV_MCP_SERVER_NAME = 'popitv';

export type PopiTVCanvasBridgeType =
  | 'popitv:get-snapshot'
  | 'popitv:measure-nodes'
  | 'popitv:apply-edit-operations'
  | 'popitv:run-workflow'
  | 'popitv:run-selected'
  | 'popitv:stop-workflow';

export type PopiTVCanvasBridgeRequest = {
  bridgeType: PopiTVCanvasBridgeType;
  sessionId?: string;
  nodeIds?: string[];
  operations?: unknown[];
};

export type PopiTVBridgeToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError: boolean;
  details?: unknown;
};

type RequestPopiTVCanvas = (request: PopiTVCanvasBridgeRequest) => Promise<unknown>;
type ReadCachedPopiTVCanvas = (sessionId?: string) => unknown | null;

type CanvasEditOperation = Record<string, unknown>;
type CanvasPosition = { x: number; y: number };
type NodeDimensions = { width: number; height: number };
type NodeMeasurement = { id: string; width: number; height: number };

type LayoutState = {
  nextYByColumnX: Map<number, number>;
};

const CANVAS_LAYOUT_ROW_START_Y = 200;
const CANVAS_LAYOUT_ROW_GAP = 80;
const CANVAS_LAYOUT_COLUMN_GAP = 80;
const CANVAS_LAYOUT_COLUMN_START_X = 200;
const CANVAS_LAYOUT_COLUMN_TOLERANCE = 220;
const DEFAULT_NODE_DIMENSIONS: Record<string, NodeDimensions> = {
  imageInput: { width: 300, height: 280 },
  audioInput: { width: 300, height: 200 },
  videoInput: { width: 300, height: 280 },
  annotation: { width: 300, height: 280 },
  prompt: { width: 320, height: 220 },
  array: { width: 340, height: 260 },
  promptConstructor: { width: 340, height: 280 },
  nanoBanana: { width: 300, height: 300 },
  generateVideo: { width: 300, height: 300 },
  generate3d: { width: 300, height: 300 },
  generateAudio: { width: 300, height: 280 },
  llmGenerate: { width: 320, height: 360 },
  splitGrid: { width: 300, height: 320 },
  output: { width: 320, height: 320 },
  outputGallery: { width: 320, height: 360 },
  imageCompare: { width: 400, height: 360 },
  videoStitch: { width: 400, height: 280 },
  easeCurve: { width: 340, height: 280 },
  videoTrim: { width: 360, height: 360 },
  videoFrameGrab: { width: 320, height: 320 },
  router: { width: 200, height: 80 },
  switch: { width: 220, height: 120 },
  conditionalSwitch: { width: 260, height: 180 },
  glbViewer: { width: 360, height: 380 },
};
const CANVAS_LAYOUT_DEFAULT_DIMENSIONS = DEFAULT_NODE_DIMENSIONS.nanoBanana;
const CANVAS_LAYOUT_SOURCE_COLUMN_WIDTH = Math.max(
  DEFAULT_NODE_DIMENSIONS.prompt.width,
  DEFAULT_NODE_DIMENSIONS.imageInput.width,
  DEFAULT_NODE_DIMENSIONS.audioInput.width,
  DEFAULT_NODE_DIMENSIONS.videoInput.width,
);
const CANVAS_LAYOUT_GENERATION_COLUMN_X =
  CANVAS_LAYOUT_COLUMN_START_X + CANVAS_LAYOUT_SOURCE_COLUMN_WIDTH + CANVAS_LAYOUT_COLUMN_GAP;
const CANVAS_LAYOUT_GENERATION_COLUMN_WIDTH = Math.max(
  DEFAULT_NODE_DIMENSIONS.promptConstructor.width,
  DEFAULT_NODE_DIMENSIONS.array.width,
  DEFAULT_NODE_DIMENSIONS.nanoBanana.width,
  DEFAULT_NODE_DIMENSIONS.llmGenerate.width,
);
const CANVAS_LAYOUT_VIDEO_COLUMN_X =
  CANVAS_LAYOUT_GENERATION_COLUMN_X +
  CANVAS_LAYOUT_GENERATION_COLUMN_WIDTH +
  CANVAS_LAYOUT_COLUMN_GAP;
const CANVAS_LAYOUT_VIDEO_COLUMN_WIDTH = Math.max(
  DEFAULT_NODE_DIMENSIONS.generateVideo.width,
  DEFAULT_NODE_DIMENSIONS.videoStitch.width,
  DEFAULT_NODE_DIMENSIONS.videoTrim.width,
  DEFAULT_NODE_DIMENSIONS.videoFrameGrab.width,
);
const CANVAS_LAYOUT_MEDIA_COLUMN_X =
  CANVAS_LAYOUT_VIDEO_COLUMN_X + CANVAS_LAYOUT_VIDEO_COLUMN_WIDTH + CANVAS_LAYOUT_COLUMN_GAP;
const CANVAS_LAYOUT_MEDIA_COLUMN_WIDTH = Math.max(
  DEFAULT_NODE_DIMENSIONS.generateAudio.width,
  DEFAULT_NODE_DIMENSIONS.generate3d.width,
  DEFAULT_NODE_DIMENSIONS.splitGrid.width,
);
const CANVAS_LAYOUT_OUTPUT_COLUMN_X =
  CANVAS_LAYOUT_MEDIA_COLUMN_X + CANVAS_LAYOUT_MEDIA_COLUMN_WIDTH + CANVAS_LAYOUT_COLUMN_GAP;
const CANVAS_LAYOUT_COLUMNS: Record<string, number> = {
  imageInput: CANVAS_LAYOUT_COLUMN_START_X,
  audioInput: CANVAS_LAYOUT_COLUMN_START_X,
  videoInput: CANVAS_LAYOUT_COLUMN_START_X,
  prompt: CANVAS_LAYOUT_COLUMN_START_X,
  annotation: CANVAS_LAYOUT_COLUMN_START_X,
  promptConstructor: CANVAS_LAYOUT_GENERATION_COLUMN_X,
  array: CANVAS_LAYOUT_GENERATION_COLUMN_X,
  nanoBanana: CANVAS_LAYOUT_GENERATION_COLUMN_X,
  llmGenerate: CANVAS_LAYOUT_GENERATION_COLUMN_X,
  generateVideo: CANVAS_LAYOUT_VIDEO_COLUMN_X,
  videoStitch: CANVAS_LAYOUT_VIDEO_COLUMN_X,
  videoTrim: CANVAS_LAYOUT_VIDEO_COLUMN_X,
  videoFrameGrab: CANVAS_LAYOUT_VIDEO_COLUMN_X,
  generateAudio: CANVAS_LAYOUT_MEDIA_COLUMN_X,
  generate3d: CANVAS_LAYOUT_MEDIA_COLUMN_X,
  splitGrid: CANVAS_LAYOUT_MEDIA_COLUMN_X,
  output: CANVAS_LAYOUT_OUTPUT_COLUMN_X,
  outputGallery: CANVAS_LAYOUT_OUTPUT_COLUMN_X,
  imageCompare: CANVAS_LAYOUT_OUTPUT_COLUMN_X,
  router: 200,
  switch: 500,
  conditionalSwitch: 800,
  glbViewer: 1180,
  easeCurve: 1180,
};
const CANVAS_LAYOUT_DEFAULT_X = CANVAS_LAYOUT_COLUMNS.nanoBanana;

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
): Record<string, unknown> => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const optionalSessionIdSchema = {
  type: 'string',
  description:
    'Popiai cowork session id. If omitted, the visible PopiTV canvas may handle the request.',
};

const nodeIdsSchema = {
  type: 'array',
  items: { type: 'string' },
  description: 'Optional node ids. When provided, only those selected nodes are executed.',
};

export function getPopiTVMcpToolManifest(): McpToolManifestEntry[] {
  return [
    {
      server: POPITV_MCP_SERVER_NAME,
      name: 'read_canvas',
      description:
        'Read the current PopiTV canvas snapshot, including nodes, edges, run state, and workflow metadata.',
      inputSchema: objectSchema({
        sessionId: optionalSessionIdSchema,
        refresh: {
          type: 'boolean',
          description:
            'When true, bypass the cached snapshot and request a fresh snapshot from the active canvas.',
        },
      }),
    },
    {
      server: POPITV_MCP_SERVER_NAME,
      name: 'edit_canvas',
      description:
        'Apply PopiTV canvas edit operations. Use type/addNode operations with nodeType values like prompt, nanoBanana, generateVideo, generateAudio, generate3d, llmGenerate. Image generation aliases such as image_generation are accepted; generation nodes with inline text are expanded into prompt-to-generation connections.',
      inputSchema: objectSchema(
        {
          sessionId: optionalSessionIdSchema,
          operations: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description:
              'Canvas edit operations. Add image generation nodes with {type:"addNode", nodeType:"nanoBanana", nodeId:"shot-1", data:{inputPrompt:"...", aspectRatio:"16:9"}}; inline text creates a connected prompt node automatically. Alias fields action, text, prompt, aspect_ratio, and image_generation are accepted.',
          },
        },
        ['operations'],
      ),
    },
    {
      server: POPITV_MCP_SERVER_NAME,
      name: 'measure_nodes',
      description:
        'Measure rendered PopiTV canvas nodes by id. Returns an array of {id,width,height} records.',
      inputSchema: objectSchema(
        {
          sessionId: optionalSessionIdSchema,
          nodeIds: {
            ...nodeIdsSchema,
            description: 'Node ids to measure on the active PopiTV canvas.',
          },
        },
        ['nodeIds'],
      ),
    },
    {
      server: POPITV_MCP_SERVER_NAME,
      name: 'run_canvas',
      description: 'Start running the current PopiTV workflow, or run only the supplied node ids.',
      inputSchema: objectSchema({
        sessionId: optionalSessionIdSchema,
        nodeIds: nodeIdsSchema,
      }),
    },
    {
      server: POPITV_MCP_SERVER_NAME,
      name: 'stop_canvas',
      description: 'Stop the current PopiTV workflow execution.',
      inputSchema: objectSchema({
        sessionId: optionalSessionIdSchema,
      }),
    },
  ];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const getOptionalString = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getOptionalStringArray = (
  args: Record<string, unknown>,
  key: string,
): string[] | undefined => {
  const value = args[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  );
  return strings.length > 0 ? strings : undefined;
};

const normalizeOperationType = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const normalized = value.trim().replace(/[-_\s]+([a-z])/g, (_, char: string) =>
    char.toUpperCase(),
  );
  const aliases: Record<string, string> = {
    addnode: 'addNode',
    removenode: 'removeNode',
    updatenode: 'updateNode',
    editnode: 'updateNode',
    modifynode: 'updateNode',
    setnode: 'updateNode',
    addedge: 'addEdge',
    removeedge: 'removeEdge',
  };
  return aliases[normalized.toLowerCase()] ?? normalized;
};

const normalizeNodeType = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const key = value.trim().replace(/[-_\s]+/g, '').toLowerCase();
  const aliases: Record<string, string> = {
    image: 'nanoBanana',
    imagegeneration: 'nanoBanana',
    generateimage: 'nanoBanana',
    texttoimage: 'nanoBanana',
    text2image: 'nanoBanana',
    videogen: 'generateVideo',
    videogeneration: 'generateVideo',
    generatevideo: 'generateVideo',
    audiogen: 'generateAudio',
    audiogeneration: 'generateAudio',
    generateaudio: 'generateAudio',
    generation3d: 'generate3d',
    generatethreed: 'generate3d',
    generate3d: 'generate3d',
    llm: 'llmGenerate',
    textgeneration: 'llmGenerate',
    generatetext: 'llmGenerate',
  };
  return aliases[key] ?? value;
};

const normalizeNodeData = (
  nodeType: unknown,
  value: unknown,
): Record<string, unknown> | unknown => {
  if (!isRecord(value)) return value;

  const next: Record<string, unknown> = { ...value };
  const normalizedNodeType = typeof nodeType === 'string' ? nodeType : '';

  if (next.custom_title !== undefined && next.customTitle === undefined) {
    next.customTitle = next.custom_title;
    delete next.custom_title;
  }
  if (next.aspect_ratio !== undefined && next.aspectRatio === undefined) {
    next.aspectRatio = next.aspect_ratio;
    delete next.aspect_ratio;
  }
  if (next.image_count !== undefined && next.imageCount === undefined) {
    next.imageCount = next.image_count;
    delete next.image_count;
  }
  if (next.duration_seconds !== undefined && next.durationSeconds === undefined) {
    next.durationSeconds = next.duration_seconds;
    delete next.duration_seconds;
  }
  if (next.input_prompt !== undefined && next.inputPrompt === undefined) {
    next.inputPrompt = next.input_prompt;
    delete next.input_prompt;
  }

  const textLike = next.inputPrompt ?? next.prompt ?? next.text;
  if (typeof textLike === 'string' && textLike.trim()) {
    if (normalizedNodeType === 'prompt') {
      next.prompt = textLike;
      delete next.inputPrompt;
    } else if (
      ['nanoBanana', 'generateVideo', 'generateAudio', 'generate3d', 'llmGenerate'].includes(
        normalizedNodeType,
      )
    ) {
      next.inputPrompt = textLike;
      delete next.prompt;
    } else if (!normalizedNodeType) {
      if (next.prompt === undefined) next.prompt = textLike;
      if (next.inputPrompt === undefined) next.inputPrompt = textLike;
    }
  }

  delete next.text;
  return next;
};

const isPosition = (value: unknown): value is { x: number; y: number } =>
  isRecord(value) &&
  typeof value.x === 'number' &&
  Number.isFinite(value.x) &&
  typeof value.y === 'number' &&
  Number.isFinite(value.y);

const getLayoutColumnX = (nodeType: unknown): number => {
  if (typeof nodeType !== 'string') return CANVAS_LAYOUT_DEFAULT_X;
  return CANVAS_LAYOUT_COLUMNS[nodeType] ?? CANVAS_LAYOUT_DEFAULT_X;
};

const isDimensions = (value: unknown): value is NodeDimensions =>
  isRecord(value) &&
  typeof value.width === 'number' &&
  Number.isFinite(value.width) &&
  typeof value.height === 'number' &&
  Number.isFinite(value.height);

const getNodeDimensions = (nodeType: unknown, node?: Record<string, unknown>): NodeDimensions => {
  if (node) {
    if (isDimensions(node)) return node;
    if (isDimensions(node.measured)) return node.measured;
    if (isDimensions(node.dimensions)) return node.dimensions;
  }

  if (typeof nodeType !== 'string') return CANVAS_LAYOUT_DEFAULT_DIMENSIONS;
  return DEFAULT_NODE_DIMENSIONS[nodeType] ?? CANVAS_LAYOUT_DEFAULT_DIMENSIONS;
};

const getSnapshotNodes = (snapshot: unknown): Record<string, unknown>[] => {
  if (!isRecord(snapshot) || !Array.isArray(snapshot.nodes)) return [];
  return snapshot.nodes.filter((node): node is Record<string, unknown> => isRecord(node));
};

const getSnapshotNodeIds = (snapshot: unknown): string[] =>
  getSnapshotNodes(snapshot)
    .map(node => node.id)
    .filter((id): id is string => typeof id === 'string' && id.trim() !== '');

const isNodeMeasurement = (value: unknown): value is NodeMeasurement =>
  isRecord(value) &&
  typeof value.id === 'string' &&
  value.id.trim() !== '' &&
  typeof value.width === 'number' &&
  Number.isFinite(value.width) &&
  typeof value.height === 'number' &&
  Number.isFinite(value.height);

const mergeNodeMeasurementsIntoSnapshot = (
  snapshot: unknown,
  measurements: unknown,
): unknown => {
  if (!isRecord(snapshot) || !Array.isArray(measurements)) return snapshot;

  const measurementsById = new Map<string, NodeDimensions>();
  for (const measurement of measurements) {
    if (!isNodeMeasurement(measurement)) continue;
    measurementsById.set(measurement.id, {
      width: measurement.width,
      height: measurement.height,
    });
  }
  if (measurementsById.size === 0) return snapshot;

  return {
    ...snapshot,
    nodes: getSnapshotNodes(snapshot).map(node => {
      const id = typeof node.id === 'string' ? node.id : '';
      const measured = measurementsById.get(id);
      return measured ? { ...node, measured } : node;
    }),
  };
};

const measureSnapshotNodes = async (
  snapshot: unknown,
  sessionId: string | undefined,
  requestCanvas: RequestPopiTVCanvas,
): Promise<unknown> => {
  const nodeIds = getSnapshotNodeIds(snapshot);
  if (nodeIds.length === 0) return snapshot;

  try {
    const measurements = await requestCanvas({
      bridgeType: 'popitv:measure-nodes',
      ...(sessionId ? { sessionId } : {}),
      nodeIds,
    });
    return mergeNodeMeasurementsIntoSnapshot(snapshot, measurements);
  } catch {
    return snapshot;
  }
};

const createLayoutState = (snapshot?: unknown): LayoutState => {
  const nextYByColumnX = new Map<number, number>();

  for (const node of getSnapshotNodes(snapshot)) {
    if (!isPosition(node.position)) continue;

    for (const columnX of Object.values(CANVAS_LAYOUT_COLUMNS)) {
      if (Math.abs(node.position.x - columnX) > CANVAS_LAYOUT_COLUMN_TOLERANCE) continue;
      const dimensions = getNodeDimensions(node.type, node);
      const nextY = Math.max(
        nextYByColumnX.get(columnX) ?? CANVAS_LAYOUT_ROW_START_Y,
        node.position.y + dimensions.height + CANVAS_LAYOUT_ROW_GAP,
      );
      nextYByColumnX.set(columnX, nextY);
      break;
    }
  }

  return { nextYByColumnX };
};

const takeNextLayoutPosition = (layoutState: LayoutState, nodeType: unknown): CanvasPosition => {
  const x = getLayoutColumnX(nodeType);
  const y = layoutState.nextYByColumnX.get(x) ?? CANVAS_LAYOUT_ROW_START_Y;
  const dimensions = getNodeDimensions(nodeType);
  layoutState.nextYByColumnX.set(x, y + dimensions.height + CANVAS_LAYOUT_ROW_GAP);
  return { x, y };
};

const reserveLayoutPosition = (
  layoutState: LayoutState,
  nodeType: unknown,
  position: CanvasPosition,
): void => {
  const x = getLayoutColumnX(nodeType);
  if (Math.abs(position.x - x) > CANVAS_LAYOUT_COLUMN_TOLERANCE) return;
  const dimensions = getNodeDimensions(nodeType);
  layoutState.nextYByColumnX.set(
    x,
    Math.max(
      layoutState.nextYByColumnX.get(x) ?? CANVAS_LAYOUT_ROW_START_Y,
      position.y + dimensions.height + CANVAS_LAYOUT_ROW_GAP,
    ),
  );
};

const GENERATION_NODE_TYPES = new Set([
  'nanoBanana',
  'generateVideo',
  'generateAudio',
  'generate3d',
  'llmGenerate',
]);

const expandInlinePromptGenerationNode = (
  operation: CanvasEditOperation,
  index: number,
  layoutState: LayoutState,
): CanvasEditOperation[] | null => {
  if (operation.type !== 'addNode') return null;
  if (typeof operation.nodeType !== 'string' || !GENERATION_NODE_TYPES.has(operation.nodeType)) {
    return null;
  }
  if (!isRecord(operation.data)) return null;

  const promptText = operation.data.inputPrompt;
  if (typeof promptText !== 'string' || !promptText.trim()) return null;

  const baseId =
    typeof operation.nodeId === 'string' && operation.nodeId.trim()
      ? operation.nodeId.trim()
      : `${operation.nodeType}-popitv-${Date.now()}-${index}`;
  const generationPosition = isPosition(operation.position)
    ? operation.position
    : takeNextLayoutPosition(layoutState, operation.nodeType);
  const promptPosition = {
    x: getLayoutColumnX('prompt'),
    y: generationPosition.y,
  };
  reserveLayoutPosition(layoutState, 'prompt', promptPosition);
  reserveLayoutPosition(layoutState, operation.nodeType, generationPosition);
  const promptTitle =
    typeof operation.data.customTitle === 'string' && operation.data.customTitle.trim()
      ? `${operation.data.customTitle.trim()} Prompt`
      : undefined;

  return [
    {
      type: 'addNode',
      nodeType: 'prompt',
      nodeId: `${baseId}-prompt`,
      position: promptPosition,
      data: {
        prompt: promptText,
        ...(promptTitle ? { customTitle: promptTitle } : {}),
      },
    },
    {
      ...operation,
      nodeId: baseId,
      position: generationPosition,
    },
    {
      type: 'addEdge',
      source: `${baseId}-prompt`,
      target: baseId,
      sourceHandle: 'text',
      targetHandle: 'text',
    },
  ];
};

export const normalizePopiTVEditOperations = (
  operations: unknown[],
  canvasSnapshot?: unknown,
): CanvasEditOperation[] => {
  const layoutState = createLayoutState(canvasSnapshot);

  return operations.flatMap((operation, index): CanvasEditOperation[] => {
    if (!isRecord(operation)) return [operation as CanvasEditOperation];

    const type = normalizeOperationType(operation.type ?? operation.action);
    const nodeType = normalizeNodeType(operation.nodeType);
    const data = normalizeNodeData(nodeType, operation.data);
    const next: CanvasEditOperation = {
      ...operation,
      ...(typeof type === 'string' ? { type } : {}),
      ...(typeof nodeType === 'string' ? { nodeType } : {}),
      ...(data !== undefined ? { data } : {}),
    };

    delete next.action;
    const expanded = expandInlinePromptGenerationNode(next, index, layoutState);
    if (expanded) return expanded;

    if (next.type === 'addNode') {
      if (isPosition(next.position)) {
        reserveLayoutPosition(layoutState, next.nodeType, next.position);
      } else {
        next.position = takeNextLayoutPosition(layoutState, next.nodeType);
      }
    }

    return [next];
  });
};

const toToolResult = (
  payload: unknown,
  details: Record<string, unknown> = {},
): PopiTVBridgeToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  isError: false,
  details,
});

const toToolError = (
  message: string,
  details: Record<string, unknown> = {},
): PopiTVBridgeToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
  details,
});

export async function executePopiTVMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  requestCanvas: RequestPopiTVCanvas,
  readCachedCanvas?: ReadCachedPopiTVCanvas,
): Promise<PopiTVBridgeToolResult | null> {
  if (serverName !== POPITV_MCP_SERVER_NAME) {
    return null;
  }

  const safeArgs = isRecord(args) ? args : {};
  const sessionId = getOptionalString(safeArgs, 'sessionId');
  const shouldRefresh = safeArgs.refresh === true;
  const details = { server: POPITV_MCP_SERVER_NAME, tool: toolName };

  try {
    if (toolName === 'read_canvas') {
      if (!shouldRefresh) {
        const cachedPayload = readCachedCanvas?.(sessionId);
        if (cachedPayload) {
          return toToolResult(cachedPayload, { ...details, cached: true });
        }
      }
      const payload = await requestCanvas({
        bridgeType: 'popitv:get-snapshot',
        ...(sessionId ? { sessionId } : {}),
      });
      return toToolResult(payload, details);
    }

    if (toolName === 'edit_canvas') {
      const operations = safeArgs.operations;
      if (!Array.isArray(operations)) {
        return toToolError('edit_canvas requires an "operations" array.', details);
      }
      const canvasSnapshot = await measureSnapshotNodes(
        readCachedCanvas?.(sessionId),
        sessionId,
        requestCanvas,
      );
      const normalizedOperations = normalizePopiTVEditOperations(operations, canvasSnapshot);
      const payload = await requestCanvas({
        bridgeType: 'popitv:apply-edit-operations',
        ...(sessionId ? { sessionId } : {}),
        operations: normalizedOperations,
      });
      return toToolResult(payload, details);
    }

    if (toolName === 'measure_nodes') {
      const nodeIds = getOptionalStringArray(safeArgs, 'nodeIds');
      if (!nodeIds) {
        return toToolError('measure_nodes requires a non-empty "nodeIds" array.', details);
      }
      const payload = await requestCanvas({
        bridgeType: 'popitv:measure-nodes',
        ...(sessionId ? { sessionId } : {}),
        nodeIds,
      });
      return toToolResult(payload, details);
    }

    if (toolName === 'run_canvas') {
      const nodeIds = getOptionalStringArray(safeArgs, 'nodeIds');
      const payload = await requestCanvas({
        bridgeType: nodeIds ? 'popitv:run-selected' : 'popitv:run-workflow',
        ...(sessionId ? { sessionId } : {}),
        ...(nodeIds ? { nodeIds } : {}),
      });
      return toToolResult(payload, details);
    }

    if (toolName === 'stop_canvas') {
      const payload = await requestCanvas({
        bridgeType: 'popitv:stop-workflow',
        ...(sessionId ? { sessionId } : {}),
      });
      return toToolResult(payload, details);
    }

    return toToolError(`Unknown PopiTV tool "${toolName}".`, details);
  } catch (error) {
    return toToolError(error instanceof Error ? error.message : String(error), details);
  }
}
