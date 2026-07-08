import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { RemoteKnowledgeService } from '../knowledge/remoteKnowledgeService';
import {
  executeKnowledgeMcpTool,
  getKnowledgeMcpToolManifest,
  KNOWLEDGE_MCP_SERVER_NAME,
} from './knowledgeMcpBridgeTools';

describe('knowledge MCP bridge tools', () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  test('declares the knowledge upload tool manifest', () => {
    const manifest = getKnowledgeMcpToolManifest();

    expect(manifest.map(tool => tool.name)).toEqual([
      'preview_rag_context',
      'upload_agent_knowledge_file',
    ]);
    const uploadTool = manifest.find(tool => tool.name === 'upload_agent_knowledge_file');
    expect(uploadTool?.inputSchema.required).toEqual(['filePath', 'userConfirmed']);
    expect(uploadTool?.inputSchema.properties?.filePath).toEqual(
      expect.objectContaining({ type: 'string' }),
    );
    expect(uploadTool?.inputSchema.properties?.userConfirmed).toEqual(
      expect.objectContaining({ type: 'boolean' }),
    );
  });

  test('previews RAG context through RemoteKnowledgeService', async () => {
    const previewRagContext = vi.fn(async () => ({
      success: true,
      data: {
        rendered_contexts: 'context',
        user_content: 'question',
      },
    }));
    const service = { previewRagContext } as unknown as RemoteKnowledgeService;

    const result = await executeKnowledgeMcpTool(
      KNOWLEDGE_MCP_SERVER_NAME,
      'preview_rag_context',
      {
        query: 'how to refund?',
        knowledgeBaseIds: ['kb-1'],
        knowledgeIds: ['doc-1'],
      },
      service,
    );

    expect(result?.isError).toBe(false);
    expect(previewRagContext).toHaveBeenCalledWith({
      query: 'how to refund?',
      knowledgeBaseIds: ['kb-1'],
      knowledgeIds: ['doc-1'],
    });
    expect(result?.content[0].text).toContain('"rendered_contexts": "context"');
  });

  test('uploads a local file through RemoteKnowledgeService', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-mcp-'));
    const filePath = path.join(tempDir, 'demo.md');
    await fs.writeFile(filePath, '# Demo\n');

    const uploadAgentKnowledgeFile = vi.fn(async () => ({
      success: true,
      knowledgeId: 'knowledge-1',
      knowledgeBaseId: 'kb-1',
    }));
    const service = { uploadAgentKnowledgeFile } as unknown as RemoteKnowledgeService;

    const result = await executeKnowledgeMcpTool(
      KNOWLEDGE_MCP_SERVER_NAME,
      'upload_agent_knowledge_file',
      {
        filePath,
        fileName: 'custom.md',
        apiKey: 'test-key',
        metadata: { source: 'agent' },
        channel: 'agent',
        userConfirmed: true,
      },
      service,
    );

    expect(result?.isError).toBe(false);
    expect(uploadAgentKnowledgeFile).toHaveBeenCalledTimes(1);
    const request = uploadAgentKnowledgeFile.mock.calls[0][0];
    expect(request).toMatchObject({
      fileName: 'custom.md',
      apiKey: 'test-key',
      metadata: { source: 'agent' },
      channel: 'agent',
    });
    expect(request.file).toBeInstanceOf(Blob);
    await expect(request.file.text()).resolves.toBe('# Demo\n');
    expect(result?.content[0].text).toContain('"knowledgeId": "knowledge-1"');
  });

  test('rejects relative file paths', async () => {
    const service = {
      uploadAgentKnowledgeFile: vi.fn(),
    } as unknown as RemoteKnowledgeService;

    const result = await executeKnowledgeMcpTool(
      KNOWLEDGE_MCP_SERVER_NAME,
      'upload_agent_knowledge_file',
      { filePath: 'demo.md', userConfirmed: true },
      service,
    );

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('absolute');
  });

  test('rejects uploads without explicit user confirmation', async () => {
    const service = {
      uploadAgentKnowledgeFile: vi.fn(),
    } as unknown as RemoteKnowledgeService;

    const result = await executeKnowledgeMcpTool(
      KNOWLEDGE_MCP_SERVER_NAME,
      'upload_agent_knowledge_file',
      { filePath: '/tmp/demo.md' },
      service,
    );

    expect(result?.isError).toBe(true);
    expect(result?.content[0].text).toContain('explicit user confirmation');
    expect(service.uploadAgentKnowledgeFile).not.toHaveBeenCalled();
  });
});
