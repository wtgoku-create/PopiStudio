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
    const sourceReferencesPath = path.resolve(process.cwd(), 'SKILLs/knowledge-base/references/source-references.md');
    const uploadRoutingPath = path.resolve(process.cwd(), 'SKILLs/knowledge-base/references/upload-routing.md');
    const skill = fs.readFileSync(skillPath, 'utf8');
    const sourceReferences = fs.readFileSync(sourceReferencesPath, 'utf8');
    const uploadRouting = fs.readFileSync(uploadRoutingPath, 'utf8');

    expect(skill).toContain('Knowledge Base');
    expect(skill).toContain('references/query-routing.md');
    expect(skill).toContain('references/source-references.md');
    expect(skill).toContain('references/upload-routing.md');
    expect(sourceReferences).toContain('Knowledge chunks');
    expect(sourceReferences).toContain('Wiki pages');
    expect(uploadRouting).toContain('Upload Tool Routing');
    expect(uploadRouting).toContain('upload_agent_knowledge_file');
    expect(uploadRouting).toContain('AskUserQuestion');
    expect(uploadRouting).toContain('userConfirmed: true');
  });
});
