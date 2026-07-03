import fs from 'fs/promises';
import path from 'path';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import type { RemoteKnowledgeService } from '../knowledge/remoteKnowledgeService';
import type { PopiTVBridgeToolResult } from './popiTVMcpBridgeTools';
import type { LocalMcpToolProvider } from './popiTVToolBridgeServer';

export const KNOWLEDGE_MCP_SERVER_NAME = 'knowledge';

const KNOWLEDGE_UPLOAD_TOOL_NAME = 'upload_agent_knowledge_file';

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

export function getKnowledgeMcpToolManifest(): LocalMcpToolProvider['tools'] {
  return [
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
        },
        ['filePath'],
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
  if (toolName !== KNOWLEDGE_UPLOAD_TOOL_NAME) {
    return toToolError(`Unknown knowledge tool "${toolName}".`, details);
  }

  try {
    const safeArgs = isRecord(args) ? args : {};
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
