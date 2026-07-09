const normalizePromptPart = (value?: string): string => value?.trim() ?? '';

export const buildCoworkSystemPrompt = (
  skillPrompt?: string,
  baseSystemPrompt?: string,
  tailPrompt?: string,
): string | undefined => {
  const combined = [
    normalizePromptPart(skillPrompt),
    normalizePromptPart(baseSystemPrompt),
    normalizePromptPart(tailPrompt),
  ]
    .filter(Boolean)
    .join('\n\n');

  return combined || undefined;
};

export const buildCoworkContinuationSystemPrompt = (
  skillPrompt?: string,
  baseSystemPrompt?: string,
  tailPrompt?: string,
): string | undefined => {
  if (!normalizePromptPart(skillPrompt) && !normalizePromptPart(tailPrompt)) {
    return undefined;
  }

  return buildCoworkSystemPrompt(skillPrompt, baseSystemPrompt, tailPrompt);
};
