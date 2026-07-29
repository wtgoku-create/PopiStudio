import fs from 'fs/promises';
import path from 'path';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { RemoteKnowledgeService } from '../knowledge/remoteKnowledgeService';
import type { PopiTVBridgeToolResult } from './popiTVMcpBridgeTools';
import type { LocalMcpToolProvider } from './popiTVToolBridgeServer';

export const KNOWLEDGE_MCP_SERVER_NAME = 'knowledge';

const KNOWLEDGE_UPLOAD_TOOL_NAME = 'upload_agent_knowledge_file';
const KNOWLEDGE_PREVIEW_RAG_CONTEXT_TOOL_NAME = 'preview_rag_context';
const KNOWLEDGE_PREVIEW_RAG_CONTEXT_EMPTY_TEXT = '未查询到相关知识库内容。';

const objectSchema = (
  properties: Record<string, object>,
  required: string[] = [],
): Tool['inputSchema'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const toToolResult = (
  payload: unknown,
  details: Record<string, unknown> = {},
): PopiTVBridgeToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  isError: false,
  details,
});

const toToolTextResult = (
  text: string,
  details: Record<string, unknown> = {},
): PopiTVBridgeToolResult => ({
  content: [{ type: 'text', text }],
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

const isRecord = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

const getOptionalString = (args: Record<string, unknown>, key: string): string | undefined => {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const getOptionalBoolean = (args: Record<string, unknown>, key: string): boolean | undefined => {
  const value = args[key];
  return typeof value === 'boolean' ? value : undefined;
};

const getOptionalStringArray = (
  args: Record<string, unknown>,
  key: string,
): string[] | undefined => {
  const value = args[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  return strings.length > 0 ? strings.map(item => item.trim()) : undefined;
};

const getPreviewRagContextRenderedContent = (result: {
  data?: { rendered_contexts?: string };
}): string => {
  const renderedContent = result.data?.rendered_contexts;
  return typeof renderedContent === 'string' && renderedContent.trim()
    ? renderedContent
    : KNOWLEDGE_PREVIEW_RAG_CONTEXT_EMPTY_TEXT;
};

export function getKnowledgeMcpToolManifest(): LocalMcpToolProvider['tools'] {
  return [
    {
      name: KNOWLEDGE_PREVIEW_RAG_CONTEXT_TOOL_NAME,
      description:
        'Preview RAG context from selected knowledge bases or knowledge files for a user query.',
      inputSchema: objectSchema(
        {
          query: {
            type: 'string',
            description: 'User query to retrieve relevant knowledge context for.',
          },
          knowledgeBaseIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Selected knowledge base ids.',
          },
          knowledgeIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Selected knowledge file ids.',
          },
        },
        ['query'],
      ),
    },
    {
      name: KNOWLEDGE_UPLOAD_TOOL_NAME,
      description:
        'Upload a local file into the agent knowledge base. Uses the current Popiai knowledge token unless apiKey is provided.',
      inputSchema: objectSchema(
        {
          filePath: {
            type: 'string',
            description: 'Absolute local path of the file to upload.',
          },
          fileName: {
            type: 'string',
            description: 'Optional uploaded file name. Defaults to the local file basename.',
          },
          apiKey: {
            type: 'string',
            description: 'Optional WeKnora API key sent as X-API-Key.',
          },
          metadata: {
            type: 'object',
            additionalProperties: true,
            description: 'Optional metadata JSON object.',
          },
          channel: {
            type: 'string',
            description: 'Optional upload channel. Defaults to agent.',
          },
          userConfirmed: {
            type: 'boolean',
            description: 'Must be true only after the user explicitly confirms uploading this file.',
          },
        },
        ['filePath', 'userConfirmed'],
      ),
    },
  ];
}

export async function executeKnowledgeMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  remoteKnowledgeService: RemoteKnowledgeService,
): Promise<PopiTVBridgeToolResult | null> {
  if (serverName !== KNOWLEDGE_MCP_SERVER_NAME) {
    return null;
  }

  const details = { server: KNOWLEDGE_MCP_SERVER_NAME, tool: toolName };

  try {
    const safeArgs = isRecord(args) ? args : {};
    if (toolName === KNOWLEDGE_PREVIEW_RAG_CONTEXT_TOOL_NAME) {
      const query = getOptionalString(safeArgs, 'query');
      if (!query) {
        return toToolError('preview_rag_context requires "query".', details);
      }
      const knowledgeBaseIds = getOptionalStringArray(safeArgs, 'knowledgeBaseIds') || [];
      const knowledgeIds = getOptionalStringArray(safeArgs, 'knowledgeIds') || [];
      if (knowledgeBaseIds.length === 0 && knowledgeIds.length === 0) {
        return toToolError('preview_rag_context requires at least one selected knowledgeBaseIds or knowledgeIds value.', details);
      }
      const result = await remoteKnowledgeService.previewRagContext({
        query,
        knowledgeBaseIds,
        knowledgeIds,
      });
      if (!result.success) {
        return toToolError(result.error || 'RAG context preview failed', details);
      }
      return toToolTextResult(getPreviewRagContextRenderedContent(result), details);
    }

    if (toolName !== KNOWLEDGE_UPLOAD_TOOL_NAME) {
      return toToolError(`Unknown knowledge tool "${toolName}".`, details);
    }

    if (getOptionalBoolean(safeArgs, 'userConfirmed') !== true) {
      return toToolError('upload_agent_knowledge_file requires explicit user confirmation. Ask the user to confirm the file upload, then call again with "userConfirmed": true.', details);
    }

    const filePath = getOptionalString(safeArgs, 'filePath');
    if (!filePath) {
      return toToolError('upload_agent_knowledge_file requires "filePath".', details);
    }
    if (!path.isAbsolute(filePath)) {
      return toToolError('upload_agent_knowledge_file requires an absolute "filePath".', details);
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      return toToolError(`"${filePath}" is not a regular file.`, details);
    }

    const bytes = await fs.readFile(filePath);
    const fileName = getOptionalString(safeArgs, 'fileName') || path.basename(filePath);
    const apiKey = getOptionalString(safeArgs, 'apiKey');
    const channel = getOptionalString(safeArgs, 'channel');
    const metadata = isRecord(safeArgs.metadata) ? safeArgs.metadata : undefined;
    const file = new Blob([new Uint8Array(bytes)]);

    const result = await remoteKnowledgeService.uploadAgentKnowledgeFile({
      file,
      fileName,
      ...(apiKey ? { apiKey } : {}),
      ...(metadata ? { metadata } : {}),
      ...(channel ? { channel } : {}),
    });

    if (!result.success) {
      return toToolError(result.error || 'Knowledge upload failed', details);
    }

    return toToolResult(result, details);
  } catch (error) {
    return toToolError(error instanceof Error ? error.message : String(error), details);
  }
}

export function createKnowledgeMcpToolProvider(
  remoteKnowledgeService: RemoteKnowledgeService,
): LocalMcpToolProvider {
  return {
    serverName: KNOWLEDGE_MCP_SERVER_NAME,
    tools: getKnowledgeMcpToolManifest(),
    handleToolCall: (serverName, toolName, args) => (
      executeKnowledgeMcpTool(serverName, toolName, args, remoteKnowledgeService)
    ),
  };
}
