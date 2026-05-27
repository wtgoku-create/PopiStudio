import fs from 'fs';
import path from 'path';
import { describe, expect, test } from 'vitest';

import { PRESET_AGENTS, presetToCreateRequest } from './presetAgents';

const getPreset = (id: string) => {
  const preset = PRESET_AGENTS.find((agent) => agent.id === id);
  expect(preset).toBeDefined();
  return preset!;
};

const loadBundledSkillIds = (): Set<string> => {
  const configPath = path.join(__dirname, '..', '..', 'SKILLs', 'skills.config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    defaults?: Record<string, unknown>;
  };
  return new Set(Object.keys(config.defaults ?? {}));
};

describe('MCN preset agents', () => {
  test('exposes the three-stage MCN workflow agents as templates', () => {
    expect(getPreset('mcn-topic-planner').name).toBe('小满 · 选题策划');
    expect(getPreset('mcn-script-director').name).toBe('阿木 · 编导脚本');
    expect(getPreset('mcn-content-producer').name).toBe('小帧 · 内容制作');
  });

  test('prefills identity and role prompt when creating an MCN preset agent', () => {
    const createRequest = presetToCreateRequest(getPreset('mcn-topic-planner'));

    expect(createRequest.identity).toContain('MCN 机构的内容选题策划');
    expect(createRequest.systemPrompt).toContain('趋势分析');
    expect(createRequest.systemPrompt).toContain('只做选题这一棒');
  });

  test('maps each MCN preset to bundled skill-market skills', () => {
    const bundledSkillIds = loadBundledSkillIds();
    const expectedSkillIds: Record<string, string[]> = {
      'mcn-topic-planner': ['daily-trending', 'content-planner', 'web-search'],
      'mcn-script-director': ['article-writer', 'content-planner', 'popitv'],
      'mcn-content-producer': [
        'popitv',
        'seedream',
        'seedance',
        'remotion',
        'canvas-design',
        'music-search',
        'web-search',
      ],
    };

    Object.entries(expectedSkillIds).forEach(([presetId, skillIds]) => {
      const preset = getPreset(presetId);
      expect(preset.skillIds).toEqual(skillIds);
      expect(preset.skillIds.every((skillId) => bundledSkillIds.has(skillId))).toBe(true);
    });
  });
});

describe('Popi Alice preset agent', () => {
  const aliceSkillIds = ['popi-alice-vlog-director', 'popi-alice-storyboard-skill', 'popiart'];
  const oldAliceImageUrl = `http://${['8', '136', '121', '101'].join('.')}:8790/media/Character_id_card/alice.jpg`;
  const aliceImageUrl = 'https://static.popi.art/media/image/2026/0527/97025_thumb.webp';

  test('exposes Alice as a Xiaohongshu vlog director template', () => {
    const preset = getPreset('popi-alice');

    expect(preset.name).toBe('Alice · 小红书 Vlog 导演');
    expect(preset.description).toContain('先策划');
    expect(preset.description).toContain('明确执行');
  });

  test('prefills Alice identity and director prompt', () => {
    const createRequest = presetToCreateRequest(getPreset('popi-alice'));

    expect(createRequest.identity).toBe('我是 Alice 的小红书 vlog 导演。');
    expect(createRequest.systemPrompt).toContain('默认先进入 `popi-alice-vlog-director`');
    expect(createRequest.systemPrompt).toContain('只有当用户明确说');
    expect(createRequest.systemPrompt).toContain('popi-alice-storyboard-skill');
  });

  test('maps Alice to bundled skill-market skills', () => {
    const bundledSkillIds = loadBundledSkillIds();
    const preset = getPreset('popi-alice');

    expect(preset.skillIds).toEqual(aliceSkillIds);
    expect(preset.skillIds.every((skillId) => bundledSkillIds.has(skillId))).toBe(true);
  });

  test('bundles Alice skill directories with matching frontmatter names', () => {
    aliceSkillIds
      .filter((skillId) => skillId.startsWith('popi-alice-'))
      .forEach((skillId) => {
        const skillPath = path.join(__dirname, '..', '..', 'SKILLs', skillId, 'SKILL.md');
        expect(fs.existsSync(skillPath)).toBe(true);
        expect(fs.readFileSync(skillPath, 'utf8')).toContain(`name: ${skillId}`);
      });
  });

  test('uses the current canonical Alice character image URL in bundled skills', () => {
    [
      path.join(__dirname, '..', '..', 'SKILLs', 'popi-alice-vlog-director', 'references', 'alice-assets.md'),
      path.join(__dirname, '..', '..', 'SKILLs', 'popi-alice-storyboard-skill', 'SKILL.md'),
    ].forEach((skillPath) => {
      const content = fs.readFileSync(skillPath, 'utf8');
      expect(content).toContain(aliceImageUrl);
      expect(content).not.toContain(oldAliceImageUrl);
    });
  });

  test('prevents unverified completion claims after Alice storyboard execution', () => {
    const storyboardSkill = fs.readFileSync(
      path.join(__dirname, '..', '..', 'SKILLs', 'popi-alice-storyboard-skill', 'SKILL.md'),
      'utf8',
    );

    expect(storyboardSkill).toContain('不得输出未核验完成宣称');
    expect(storyboardSkill).toContain('不要说“所有图片和视频都已上传并可以访问”');
    expect(storyboardSkill).toContain('必须明确标注为“待验证”');
  });
});
