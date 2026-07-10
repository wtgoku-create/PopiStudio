import fs from 'fs';
import path from 'path';

import { describe, expect, test } from 'vitest';

import { buildSelectedKnowledgeContextPrompt } from './sourceReferencePrompt';

describe('buildSelectedKnowledgeContextPrompt', () => {
  test('keeps selected knowledge metadata lightweight', () => {
    const prompt = buildSelectedKnowledgeContextPrompt({
      knowledgeBases: [{ id: 'kb-1', name: 'Policies' }],
      knowledgeFiles: [{ id: 'doc-1', title: 'Refund Policy', knowledgeBaseName: 'Policies' }],
    });

    expect(prompt).toContain('[Popiai selected knowledge sources]');
    expect(prompt).toContain('Selected knowledgeBaseIds');
    expect(prompt).toContain('Selected knowledgeIds');
    expect(prompt).toContain('kb-1');
    expect(prompt).toContain('doc-1');
    expect(prompt).not.toContain('Knowledge Source References');
    expect(prompt).not.toContain('upload_agent_knowledge_file');
  });

  test('knowledge rules live in the knowledge-base skill', () => {
    const skillPath = path.resolve(process.cwd(), 'SKILLs/knowledge-base/SKILL.md');
    const skill = fs.readFileSync(skillPath, 'utf8');

    expect(skill).toContain('Knowledge Base');
    expect(skill).toContain('Knowledge chunks');
    expect(skill).toContain('Wiki pages');
    expect(skill).toContain('Upload Tool Routing');
    expect(skill).toContain('upload_agent_knowledge_file');
    expect(skill).toContain('AskUserQuestion');
    expect(skill).toContain('userConfirmed: true');
  });
});
