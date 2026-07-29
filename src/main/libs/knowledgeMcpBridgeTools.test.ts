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
        query: 'how to refund?',
        rendered_contexts: 'context',
        search_result: [
          { id: 'search-1', content: 'search content' },
        ],
        rerank_result: [
          { id: 'rerank-1', content: 'rerank content' },
        ],
        merge_result: [
          {
            id: 'merge-1',
            knowledge_id: 'doc-1',
            knowledge_base_id: 'kb-1',
            knowledge_title: 'Refunds',
            chunk_index: 1,
            chunk_type: 'text',
            score: 0.8,
            content: 'merge content',
          },
        ],
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
    expect(result?.content[0].text).toBe('context');
    expect(result?.content[0].text).not.toContain('"rendered_contexts"');
    expect(result?.content[0].text).not.toContain('search_result');
    expect(result?.content[0].text).not.toContain('rerank_result');
    expect(result?.content[0].text).not.toContain('merge_result');
  });

  test('returns only preview RAG rendered context from MCP output', async () => {
    const longContent = 'x'.repeat(1500);
    const previewRagContext = vi.fn(async () => ({
      success: true,
      data: {
        query: 'summarize',
        rendered_contexts: 'final rendered context',
        user_content: 'final user content',
        merge_result: Array.from({ length: 7 }, (_item, index) => ({
          id: `merge-${index + 1}`,
          knowledge_id: `doc-${index + 1}`,
          knowledge_base_id: 'kb-1',
          knowledge_title: `Doc ${index + 1}`,
          chunk_index: index,
          content: longContent,
          score: 1 - index / 10,
        })),
      },
    }));
    const service = { previewRagContext } as unknown as RemoteKnowledgeService;

    const result = await executeKnowledgeMcpTool(
      KNOWLEDGE_MCP_SERVER_NAME,
      'preview_rag_context',
      {
        query: 'summarize',
        knowledgeBaseIds: ['kb-1'],
      },
      service,
    );

    expect(result?.isError).toBe(false);
    expect(result?.content[0].text).toBe('final rendered context');
    expect(result?.content[0].text).not.toContain('final user content');
    expect(result?.content[0].text).not.toContain(longContent);
  });

  test('returns default text when preview RAG rendered context is empty', async () => {
    const previewRagContext = vi.fn(async () => ({
      success: true,
      data: {
        query: 'unknown',
        rendered_contexts: '   ',
        user_content: '   ',
        merge_result: [],
      },
    }));
    const service = { previewRagContext } as unknown as RemoteKnowledgeService;

    const result = await executeKnowledgeMcpTool(
      KNOWLEDGE_MCP_SERVER_NAME,
      'preview_rag_context',
      {
        query: 'unknown',
        knowledgeBaseIds: ['kb-1'],
      },
      service,
    );

    expect(result?.isError).toBe(false);
    expect(result?.content[0].text).toBe('未查询到相关知识库内容。');
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
