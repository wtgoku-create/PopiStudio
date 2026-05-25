export interface McpToolManifestEntry {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const POPITV_MCP_SERVER_NAME = 'popitv';

export type PopiTVCanvasBridgeType =
  | 'popitv:get-snapshot'
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
  const generationPosition = isPosition(operation.position)
    ? operation.position
    : { x: 540, y: 200 + index * 260 };
  const promptPosition = { x: generationPosition.x - 340, y: generationPosition.y };
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

export const normalizePopiTVEditOperations = (operations: unknown[]): CanvasEditOperation[] =>
  operations.flatMap((operation, index): CanvasEditOperation[] => {
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
    return expandInlinePromptGenerationNode(next, index) ?? [next];
  });

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
      const payload = await requestCanvas({
        bridgeType: 'popitv:apply-edit-operations',
        ...(sessionId ? { sessionId } : {}),
        operations: normalizedOperations,
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
