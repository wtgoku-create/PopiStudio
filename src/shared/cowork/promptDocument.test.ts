import { expect, test } from 'vitest';

import {
  CoworkPromptDocumentVersion,
  CoworkPromptResourceSource,
  CoworkPromptResourceTransport,
  CoworkPromptSegmentKind,
  getCoworkPromptDocumentText,
  normalizeCoworkPromptDocument,
  serializeCoworkPromptDocumentForOpenClaw,
} from './promptDocument';

const document = {
  version: CoworkPromptDocumentVersion.V1,
  segments: [
    { kind: CoworkPromptSegmentKind.Text, text: '理解 ' },
    { kind: CoworkPromptSegmentKind.Resource, resourceId: 'resource-1' },
    { kind: CoworkPromptSegmentKind.Text, text: ' 的内容' },
  ],
  resources: [{
    id: 'resource-1',
    name: 'title "final".txt',
    path: '/tmp/title & final.txt',
    source: CoworkPromptResourceSource.Mention,
    transport: CoworkPromptResourceTransport.Reference,
  }],
};

test('serializes a resource manifest and preserves inline reference order for OpenClaw', () => {
  expect(serializeCoworkPromptDocumentForOpenClaw(document)).toBe(
    '<resources>\n'
      + '  <resource id="r1" label="title &quot;final&quot;.txt" path="/tmp/title &amp; final.txt" />\n'
      + '</resources>\n\n'
      + '理解 {{resource:r1}} 的内容',
  );
});

test('reuses transport IDs and distinguishes local paths from network URLs', () => {
  expect(serializeCoworkPromptDocumentForOpenClaw({
    version: CoworkPromptDocumentVersion.V1,
    segments: [
      { kind: CoworkPromptSegmentKind.Resource, resourceId: 'local' },
      { kind: CoworkPromptSegmentKind.Text, text: ' 对比 ' },
      { kind: CoworkPromptSegmentKind.Resource, resourceId: 'remote' },
      { kind: CoworkPromptSegmentKind.Text, text: '，再检查 ' },
      { kind: CoworkPromptSegmentKind.Resource, resourceId: 'local' },
    ],
    resources: [
      {
        id: 'unused',
        name: 'unused.txt',
        path: '/tmp/unused.txt',
        source: CoworkPromptResourceSource.Mention,
        transport: CoworkPromptResourceTransport.Reference,
      },
      {
        id: 'local',
        name: 'local.txt',
        path: './local.txt',
        source: CoworkPromptResourceSource.Mention,
        transport: CoworkPromptResourceTransport.Reference,
      },
      {
        id: 'remote',
        name: 'remote.txt',
        path: 'https://example.com/remote.txt?x=1&y=2',
        source: CoworkPromptResourceSource.Mention,
        transport: CoworkPromptResourceTransport.Reference,
      },
    ],
  })).toBe(
    '<resources>\n'
      + '  <resource id="r1" label="local.txt" path="./local.txt" />\n'
      + '  <resource id="r2" label="remote.txt" url="https://example.com/remote.txt?x=1&amp;y=2" />\n'
      + '</resources>\n\n'
      + '{{resource:r1}} 对比 {{resource:r2}}，再检查 {{resource:r1}}',
  );
});

test('extracts only user-authored text for display storage', () => {
  expect(getCoworkPromptDocumentText(document)).toBe('理解  的内容');
});

test('rejects resource segments that reference missing resources', () => {
  expect(normalizeCoworkPromptDocument({
    ...document,
    segments: [{ kind: CoworkPromptSegmentKind.Resource, resourceId: 'missing' }],
  })).toBeUndefined();
});

test('normalizes legacy V1 documents without skills', () => {
  expect(normalizeCoworkPromptDocument(document)).toEqual(document);
});

test('serializes inline skills once and reuses their transport IDs', () => {
  expect(serializeCoworkPromptDocumentForOpenClaw({
    version: CoworkPromptDocumentVersion.V1,
    segments: [
      { kind: CoworkPromptSegmentKind.Text, text: '使用 ' },
      { kind: CoworkPromptSegmentKind.Skill, skillId: 'docx' },
      { kind: CoworkPromptSegmentKind.Text, text: ' 创建后再用 ' },
      { kind: CoworkPromptSegmentKind.Skill, skillId: 'docx' },
      { kind: CoworkPromptSegmentKind.Text, text: ' 修改' },
    ],
    resources: [],
    skills: [{
      id: 'docx',
      name: 'Word "文档"',
      description: 'Create documents',
      location: '/tmp/docx & files/SKILL.md',
      directory: '/tmp/docx & files',
    }],
  })).toBe(
    '<skills>\n'
      + '  <skill id="s1" skill-id="docx" label="Word &quot;文档&quot;" location="/tmp/docx &amp; files/SKILL.md" directory="/tmp/docx &amp; files" />\n'
      + '</skills>\n\n'
      + '使用 {{skill:s1}} 创建后再用 {{skill:s1}} 修改',
  );
});

test('serializes skill and resource manifests in stable order', () => {
  expect(serializeCoworkPromptDocumentForOpenClaw({
    version: CoworkPromptDocumentVersion.V1,
    segments: [
      { kind: CoworkPromptSegmentKind.Skill, skillId: 'docx' },
      { kind: CoworkPromptSegmentKind.Text, text: ' 阅读 ' },
      { kind: CoworkPromptSegmentKind.Resource, resourceId: 'file' },
    ],
    resources: [{
      id: 'file',
      name: 'title.txt',
      path: './title.txt',
      source: CoworkPromptResourceSource.Mention,
      transport: CoworkPromptResourceTransport.Reference,
    }],
    skills: [{
      id: 'docx',
      name: 'Word',
      description: 'Create documents',
      location: '/tmp/docx/SKILL.md',
      directory: '/tmp/docx',
    }],
  })).toBe(
    '<skills>\n'
      + '  <skill id="s1" skill-id="docx" label="Word" location="/tmp/docx/SKILL.md" directory="/tmp/docx" />\n'
      + '</skills>\n'
      + '<resources>\n'
      + '  <resource id="r1" label="title.txt" path="./title.txt" />\n'
      + '</resources>\n\n'
      + '{{skill:s1}} 阅读 {{resource:r1}}',
  );
});

test('rejects skill segments that reference missing skills', () => {
  expect(normalizeCoworkPromptDocument({
    version: CoworkPromptDocumentVersion.V1,
    segments: [{ kind: CoworkPromptSegmentKind.Skill, skillId: 'missing' }],
    resources: [],
    skills: [],
  })).toBeUndefined();
});
