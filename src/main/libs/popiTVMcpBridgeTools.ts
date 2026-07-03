import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export interface McpToolManifestEntry {
  server: string;
  name: string;
  description: string;
  inputSchema: Tool['inputSchema'];
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

export type PopiTVBridgeToolResult = CallToolResult & {
  details?: unknown;
};

type RequestPopiTVCanvas = (request: PopiTVCanvasBridgeRequest) => Promise<unknown>;
type ReadCachedPopiTVCanvas = (sessionId?: string) => unknown | null;

type CanvasEditOperation = Record<string, unknown>;
type CanvasPosition = { x: number; y: number };
type NodeDimensions = { width: number; height: number };

const CANVAS_LAYOUT_MIN_GAP = 120;
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

const objectSchema = (
  properties: Record<string, object>,
  required: string[] = [],
): Tool['inputSchema'] => ({
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
        'Measure rendered PopiTV canvas nodes by id. Returns an array of {id,x,y,width,height} records.',
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

const isPosition = (value: unknown): value is CanvasPosition =>
  isRecord(value) &&
  typeof value.x === 'number' &&
  Number.isFinite(value.x) &&
  typeof value.y === 'number' &&
  Number.isFinite(value.y);

const getNodeDimensions = (nodeType: unknown): NodeDimensions => {
  if (typeof nodeType !== 'string') return CANVAS_LAYOUT_DEFAULT_DIMENSIONS;
  return DEFAULT_NODE_DIMENSIONS[nodeType] ?? CANVAS_LAYOUT_DEFAULT_DIMENSIONS;
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
  const promptTitle =
    typeof operation.data.customTitle === 'string' && operation.data.customTitle.trim()
      ? `${operation.data.customTitle.trim()} Prompt`
      : undefined;
  const promptNode: CanvasEditOperation = {
    type: 'addNode',
    nodeType: 'prompt',
    nodeId: `${baseId}-prompt`,
    data: {
      prompt: promptText,
      ...(promptTitle ? { customTitle: promptTitle } : {}),
    },
  };
  if (isRecord(operation.promptPosition)) {
    promptNode.position = operation.promptPosition;
  }

  return [
    promptNode,
    {
      ...operation,
      nodeId: baseId,
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
): CanvasEditOperation[] => {
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
    const expanded = expandInlinePromptGenerationNode(next, index);
    if (expanded) return expanded;

    return [next];
  });
};

type LayoutRect = {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

const getLayoutRect = (operation: CanvasEditOperation): LayoutRect | null => {
  if (operation.type !== 'addNode') return null;
  if (!isPosition(operation.position)) return null;
  const dimensions = getNodeDimensions(operation.nodeType);
  return {
    nodeId: typeof operation.nodeId === 'string' ? operation.nodeId : '<unnamed>',
    x: operation.position.x,
    y: operation.position.y,
    width: dimensions.width,
    height: dimensions.height,
  };
};

const doRectsOverlap = (a: LayoutRect, b: LayoutRect): boolean =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

const hasHorizontalGapViolation = (a: LayoutRect, b: LayoutRect): boolean => {
  const yOverlaps = a.y < b.y + b.height && a.y + a.height > b.y;
  if (!yOverlaps) return false;

  const left = a.x <= b.x ? a : b;
  const right = left === a ? b : a;
  return right.x - (left.x + left.width) < CANVAS_LAYOUT_MIN_GAP;
};

const validatePopiTVEditLayout = (operations: CanvasEditOperation[]): string | null => {
  const addNodeOperations = operations.filter(operation => operation.type === 'addNode');
  const missingPosition = addNodeOperations.find(operation => !isPosition(operation.position));
  if (missingPosition) {
    const nodeId = typeof missingPosition.nodeId === 'string' ? missingPosition.nodeId : '<unnamed>';
    return `addNode "${nodeId}" requires an explicit position. Measure the canvas and provide non-overlapping x/y coordinates.`;
  }

  const rects = addNodeOperations
    .map(operation => getLayoutRect(operation))
    .filter((rect): rect is LayoutRect => rect !== null);

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const first = rects[i];
      const second = rects[j];
      if (doRectsOverlap(first, second)) {
        return `addNode "${first.nodeId}" overlaps "${second.nodeId}". Move one node so their rectangles do not intersect.`;
      }
      if (hasHorizontalGapViolation(first, second)) {
        return `addNode "${first.nodeId}" and "${second.nodeId}" need at least ${CANVAS_LAYOUT_MIN_GAP}px horizontal clearance.`;
      }
    }
  }

  return null;
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
      const normalizedOperations = normalizePopiTVEditOperations(operations);
      const layoutError = validatePopiTVEditLayout(normalizedOperations);
      if (layoutError) {
        return toToolError(layoutError, details);
      }
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
