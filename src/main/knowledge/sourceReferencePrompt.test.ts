import { describe, expect, test } from 'vitest';

import { buildKnowledgeSourceReferencePrompt } from './sourceReferencePrompt';

describe('buildKnowledgeSourceReferencePrompt', () => {
  test('includes local knowledge upload tool routing instructions', () => {
    const prompt = buildKnowledgeSourceReferencePrompt();

    expect(prompt).toContain('Knowledge Upload Tool Routing');
    expect(prompt).toContain('upload_agent_knowledge_file');
    expect(prompt).toContain('knowledge access token is missing');
  });
});
