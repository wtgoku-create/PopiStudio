import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  checkPackagedOpenClawRuntimeResources,
  OpenClawRuntimeResourceErrorCode,
} from './installerResourceRecovery';

const tempDirs: string[] = [];

const makeTempDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popi-runtime-check-'));
  tempDirs.push(dir);
  return dir;
};

const mkdir = (targetPath: string): void => {
  fs.mkdirSync(targetPath, { recursive: true });
};

const touch = (targetPath: string): void => {
  mkdir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, '');
};

describe('checkPackagedOpenClawRuntimeResources', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports missing runtime root', () => {
    const resourcesRoot = makeTempDir();
    const result = checkPackagedOpenClawRuntimeResources(
      path.join(resourcesRoot, 'cfmind'),
      resourcesRoot,
    );

    expect(result).toMatchObject({
      ok: false,
      code: OpenClawRuntimeResourceErrorCode.MissingRuntimeRoot,
    });
  });

  test('reports incomplete runtime root', () => {
    const resourcesRoot = makeTempDir();
    const runtimeRoot = path.join(resourcesRoot, 'cfmind');
    mkdir(runtimeRoot);

    const result = checkPackagedOpenClawRuntimeResources(runtimeRoot, resourcesRoot);

    expect(result).toMatchObject({
      ok: false,
      code: OpenClawRuntimeResourceErrorCode.MissingRuntimeEntry,
    });
  });

  test('reports missing bundled skills after runtime is present', () => {
    const resourcesRoot = makeTempDir();
    const runtimeRoot = path.join(resourcesRoot, 'cfmind');
    touch(path.join(runtimeRoot, 'gateway-bundle.mjs'));

    const result = checkPackagedOpenClawRuntimeResources(runtimeRoot, resourcesRoot);

    expect(result).toMatchObject({
      ok: false,
      code: OpenClawRuntimeResourceErrorCode.MissingBundledSkills,
    });
  });

  test('reports empty bundled skills directory as missing', () => {
    const resourcesRoot = makeTempDir();
    const runtimeRoot = path.join(resourcesRoot, 'cfmind');
    touch(path.join(runtimeRoot, 'gateway-bundle.mjs'));
    mkdir(path.join(resourcesRoot, 'SKILLs'));

    const result = checkPackagedOpenClawRuntimeResources(runtimeRoot, resourcesRoot);

    expect(result).toMatchObject({
      ok: false,
      code: OpenClawRuntimeResourceErrorCode.MissingBundledSkills,
    });
  });

  test('passes when required bundled resources are present', () => {
    const resourcesRoot = makeTempDir();
    const runtimeRoot = path.join(resourcesRoot, 'cfmind');
    touch(path.join(runtimeRoot, 'gateway-bundle.mjs'));
    touch(path.join(resourcesRoot, 'SKILLs', 'web-search', 'SKILL.md'));

    expect(checkPackagedOpenClawRuntimeResources(runtimeRoot, resourcesRoot)).toEqual({ ok: true });
  });
});
