import fs from 'fs';
import path from 'path';

export const OpenClawRuntimeResourceErrorCode = {
  MissingRuntimeRoot: 'missing_runtime_root',
  MissingRuntimeEntry: 'missing_runtime_entry',
  MissingBundledSkills: 'missing_bundled_skills',
  MissingBundledPython: 'missing_bundled_python',
} as const;

export type OpenClawRuntimeResourceErrorCode =
  typeof OpenClawRuntimeResourceErrorCode[keyof typeof OpenClawRuntimeResourceErrorCode];

export type OpenClawRuntimeResourceCheckResult = {
  ok: true;
} | {
  ok: false;
  code: OpenClawRuntimeResourceErrorCode;
  message: string;
  missingPath: string;
};

export function isOpenClawRuntimeResourceError(
  result: OpenClawRuntimeResourceCheckResult,
): result is Extract<OpenClawRuntimeResourceCheckResult, { ok: false }> {
  return result.ok === false;
}

const exists = (targetPath: string): boolean => {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
};

const hasAny = (runtimeRoot: string, relativePaths: string[]): string | null => {
  for (const relativePath of relativePaths) {
    const candidate = path.join(runtimeRoot, relativePath);
    if (exists(candidate)) return candidate;
  }
  return null;
};

const hasSkillDefinition = (skillsRoot: string): boolean => {
  if (!exists(skillsRoot)) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    return false;
  }

  return entries.some((entry) => (
    entry.isDirectory() && exists(path.join(skillsRoot, entry.name, 'SKILL.md'))
  ));
};

export function checkPackagedOpenClawRuntimeResources(
  runtimeRoot: string | null,
  resourcesRoot: string,
): OpenClawRuntimeResourceCheckResult {
  if (!runtimeRoot || !exists(runtimeRoot)) {
    const missingPath = runtimeRoot || path.join(resourcesRoot, 'cfmind');
    return {
      ok: false,
      code: OpenClawRuntimeResourceErrorCode.MissingRuntimeRoot,
      missingPath,
      message: `OpenClaw runtime resources are missing at ${missingPath}. Reinstall PopiStudio to repair the bundled resources.`,
    };
  }

  const runtimeEntry = hasAny(runtimeRoot, [
    'gateway-bundle.mjs',
    'openclaw.mjs',
    path.join('dist', 'entry.js'),
    path.join('dist', 'entry.mjs'),
    path.join('gateway.asar'),
  ]);
  if (!runtimeEntry) {
    return {
      ok: false,
      code: OpenClawRuntimeResourceErrorCode.MissingRuntimeEntry,
      missingPath: runtimeRoot,
      message: `OpenClaw runtime resources are incomplete at ${runtimeRoot}. Reinstall PopiStudio to repair the bundled resources.`,
    };
  }

  const skillsPath = path.join(resourcesRoot, 'SKILLs');
  if (!hasSkillDefinition(skillsPath)) {
    return {
      ok: false,
      code: OpenClawRuntimeResourceErrorCode.MissingBundledSkills,
      missingPath: skillsPath,
      message: `Bundled skill resources are missing at ${skillsPath}. Reinstall PopiStudio to repair the bundled resources.`,
    };
  }

  if (process.platform === 'win32') {
    const pythonPath = path.join(resourcesRoot, 'python-win');
    if (!hasAny(pythonPath, ['python.exe', 'python3.exe'])) {
      return {
        ok: false,
        code: OpenClawRuntimeResourceErrorCode.MissingBundledPython,
        missingPath: pythonPath,
        message: `Bundled Python resources are missing at ${pythonPath}. Reinstall PopiStudio to repair the bundled resources.`,
      };
    }
  }

  return { ok: true };
}
