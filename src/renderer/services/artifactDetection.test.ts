import { describe, expect, test, vi } from 'vitest';

import { collectSessionArtifacts, loadDetectedFileArtifact } from './artifactDetection';
import { ArtifactTypeValue } from '../types/artifact';
import type { CoworkMessage } from '../types/cowork';

const message = (
  id: string,
  type: CoworkMessage['type'],
  content: string,
  metadata?: CoworkMessage['metadata'],
): CoworkMessage => ({
  id,
  type,
  content,
  timestamp: 1,
  metadata,
});

describe('collectSessionArtifacts', () => {
  test('filters bare file paths outside the session cwd', () => {
    const artifacts = collectSessionArtifacts([
      message('m1', 'assistant', [
        '/Users/a111/project/PopiStudio/SKILLs/a/SKILL.md',
        '/Users/a111/project/LobsterAI/SKILLs/b/SKILL.md',
      ].join('\n')),
    ], 's1', '/Users/a111/project/PopiStudio');

    expect(artifacts.map(item => item.filePath)).toEqual([
      '/Users/a111/project/PopiStudio/SKILLs/a/SKILL.md',
    ]);
  });

  test('ignores hidden and dependency directories', () => {
    const artifacts = collectSessionArtifacts([
      message('m1', 'assistant', [
        '/repo/.cowork-temp/SKILL.md',
        '/repo/node_modules/pkg/SKILL.md',
        '/repo/output/SKILL.md',
      ].join('\n')),
    ], 's1', '/repo');

    expect(artifacts.map(item => item.filePath)).toEqual(['/repo/output/SKILL.md']);
  });

  test('does not parse bare paths from generic tool results', () => {
    const artifacts = collectSessionArtifacts([
      message('tool-1', 'tool_use', '', {
        toolUseId: 'call-1',
        toolName: 'bash',
      }),
      message('result-1', 'tool_result', '/repo/SKILL.md\n/repo/other/SKILL.md', {
        toolUseId: 'call-1',
      }),
    ], 's1', '/repo');

    expect(artifacts).toHaveLength(0);
  });
});

describe('loadDetectedFileArtifact', () => {
  test('does not read video and audio artifacts into memory', async () => {
    const readFileAsDataUrl = vi.fn();
    vi.stubGlobal('window', {
      electron: {
        dialog: {
          readFileAsDataUrl,
          statFile: vi.fn(),
        },
      },
    });

    const video = await loadDetectedFileArtifact({
      id: 'a1',
      messageId: 'm1',
      sessionId: 's1',
      type: ArtifactTypeValue.Video,
      title: 'demo.mp4',
      content: '',
      fileName: 'demo.mp4',
      filePath: 'demo.mp4',
      createdAt: 1,
    }, '/repo');

    expect(video?.filePath).toBe('/repo/demo.mp4');
    expect(video?.content).toBe('');
    expect(readFileAsDataUrl).not.toHaveBeenCalled();
  });
});
