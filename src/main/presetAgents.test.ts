import fs from 'fs';
import os from 'os';
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
  test('includes the xiaohuan avatarize-media preset', () => {
    const preset = getPreset('avatarize-media');

    expect(preset.name).toBe('小幻 · 替换角色');
    expect(preset.description).toContain('把上传的日常图片、视频中的形象替换成你的角色');
    expect(preset.skillIds).toEqual([
      'popi-mcn-avatarize-media',
      'seedream',
      'seedance',
    ]);
  });

  test('preserves preset-specific working directory for xiaohuan', () => {
    const createRequest = presetToCreateRequest(getPreset('avatarize-media'));

    expect(createRequest.workingDirectory).toBe(path.join(os.homedir(), 'popiai', 'project', 'avatarize-media'));
  });

  test('maps xiaohuan preset to bundled skill-market skills', () => {
    const bundledSkillIds = loadBundledSkillIds();
    const preset = getPreset('avatarize-media');

    expect(preset.skillIds.every((skillId) => bundledSkillIds.has(skillId))).toBe(true);
  });

  test('bundles the xiaohuan avatarize skill with matching frontmatter name', () => {
    const skillPath = path.join(__dirname, '..', '..', 'SKILLs', 'popi-mcn-avatarize-media', 'SKILL.md');

    expect(fs.existsSync(skillPath)).toBe(true);
    expect(fs.readFileSync(skillPath, 'utf8')).toContain('name: popi-mcn-avatarize-media');
  });

  test('includes the xiaomo script guide preset', () => {
    const preset = getPreset('script-guide');

    expect(preset.name).toBe('陪陪 · 想法陪聊');
    expect(preset.description).toContain('逐步追问缺失信息');
    expect(preset.skillIds).toEqual([
      'content-planner',
      'article-writer',
      'daily-trending',
      'web-search',
    ]);
  });

  test('uses the requested preset agent names in order', () => {
    expect(PRESET_AGENTS.map((agent) => agent.name)).toEqual([
      '组长 · 统筹组长',
      '小点子 · 热点小助手',
      '锐评哥 · 爆款打分',
      '陪陪 · 想法陪聊',
      '小词 · 提示词编导',
      '小七 · 素材生成',
      '小幻 · 替换角色',
      '小剪·ai剪辑师',
      '小剪· ai剪辑师',
      '记录员 · 数据记录',
      '小浩 · 商务',
      '小家 · 家庭温馨搞笑编导',
      '小校 · 校园剧情搞笑编导',
      '小分 · 一人分饰多角编导',
      '丝丝 · Vlog 提示词专家',
      '叮叮 · 搞笑剧编导',
      '小点子 · 家庭温馨搞笑热点',
      '小点子 · 校园剧情搞笑热点',
      '小点子 · 一人分饰多角热点',
      '小v·公众号内容创作',
      '小b· b站内容创作',
      '小b·b站运营',
      '红红·小红书内容创作',
      '红红·小红书运营',
      '抖抖·抖音内容创作',
      '抖抖·抖音内容运营',
    ]);
  });
});

describe('Popi Alice preset agent', () => {
  const aliceSkillIds = ['popi-alice-vlog-director', 'popi-alice-storyboard-skill', 'popiart'];
  const oldAliceImageUrl = `http://${['8', '136', '121', '101'].join('.')}:8790/media/Character_id_card/alice.jpg`;
  const aliceImageUrl = 'https://static.popi.art/media/image/2026/0527/97025_thumb.webp';

  test('removes the standalone Alice character preset', () => {
    expect(PRESET_AGENTS.find((agent) => agent.id === 'alice')).toBeUndefined();
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
