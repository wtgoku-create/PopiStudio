type KnowledgeBaseRef = { id: string; name?: string };
type KnowledgeFileRef = {
  id: string;
  title?: string;
  knowledgeBaseName?: string;
  fileType?: string;
};

export const buildSelectedKnowledgeContextPrompt = (options: {
  knowledgeBases?: KnowledgeBaseRef[];
  knowledgeFiles?: KnowledgeFileRef[];
}): string => {
  const knowledgeBases = options.knowledgeBases?.filter(item => Boolean(item.id)) ?? [];
  const knowledgeFiles = options.knowledgeFiles?.filter(item => Boolean(item.id)) ?? [];
  if (knowledgeBases.length === 0 && knowledgeFiles.length === 0) {
    return '';
  }

  return [
    '[Popiai selected knowledge sources]',
    knowledgeBases.length > 0
      ? `Selected knowledgeBaseIds: ${JSON.stringify(knowledgeBases.map(item => ({
          id: item.id,
          ...(item.name ? { name: item.name } : {}),
        })))}`
      : '',
    knowledgeFiles.length > 0
      ? `Selected knowledgeIds: ${JSON.stringify(knowledgeFiles.map(item => ({
          id: item.id,
          ...(item.title ? { title: item.title } : {}),
          ...(item.knowledgeBaseName ? { knowledgeBaseName: item.knowledgeBaseName } : {}),
          ...(item.fileType ? { fileType: item.fileType } : {}),
        })))}`
      : '',
    '[/Popiai selected knowledge sources]',
  ].filter(Boolean).join('\n');
};
