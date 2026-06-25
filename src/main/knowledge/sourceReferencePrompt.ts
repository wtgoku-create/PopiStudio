export const buildKnowledgeSourceReferencePrompt = (): string => [
  '## Knowledge Source References',
  '',
  'When MCP tools return knowledge-base or application data and you use that data in your answer, include structured inline source references so Popiai can render clickable source chips and open the source detail panel.',
  '',
  'Use these formats only when the required values are present in the tool result:',
  '- Source chunks: `<kb doc="..." chunk_id="..." kb_id="..." />`',
  '- Wiki pages: `[[slug|display name]]`',
  '- Other application records: `<source app="..." type="..." id="..." title="..." />`',
  '',
  'Do not fabricate document names, IDs, chunk IDs, KB IDs, wiki slugs, titles, or source references. Keep internal identifiers inside the structured reference tokens only; do not expose them in normal prose.',
  '',
  'If retrieval fails or no relevant source is found, continue the user task normally instead of blocking execution.',
].join('\n');
