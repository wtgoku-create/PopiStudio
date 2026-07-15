---
name: knowledge-base
description: Retrieve, cite, and upload Popiai knowledge-base content. Use this skill when the user selects knowledge bases or knowledge files, asks to answer from knowledge-base sources, or asks to upload/import/index a local file into a knowledge base.
official: true
category: 内容创作
version: 1.0.0
name_i18n:
  zh: 知识库
  en: Knowledge Base
description_i18n:
  zh: 检索、引用和上传 Popiai 知识库内容；适用于选中知识库、基于知识库回答或上传文件到知识库。
  en: Retrieve, cite, and upload Popiai knowledge-base content when selected sources or knowledge-base uploads are involved.
---

# Knowledge Base

Use this skill when the user selects knowledge bases or knowledge files, asks to answer from a knowledge base, or asks to upload/import/index a local file into a knowledge base.

## Selected Sources

When the prompt contains `[Popiai selected knowledge sources]`, treat it as turn-scoped metadata. It may include selected `knowledgeBaseIds` and selected `knowledgeIds`.

- First decide whether the user request depends on the selected sources.
- If the request depends on selected sources, retrieve from them before answering.
- If selected sources are unrelated to the request, answer normally and do not mention them.
- Pass selected ids to whichever knowledge query tool supports them.
- If the user explicitly asks to answer based on, summarize, compare, cite, or extract from selected sources, do not answer from general knowledge when retrieval fails. Say that the selected sources could not be retrieved or did not contain relevant evidence.
- If retrieval fails for an optional or unrelated selected source, continue with the user request normally and mention the retrieval issue briefly only when relevant.

## Routing References

For every user question or request involving selected knowledge, mentioned knowledge, internal documents, wiki pages, uploaded files, or likely application knowledge, run this workflow before answering:

1. Silently classify the turn:
   - `selected-source-required`: user explicitly asks to use, summarize, compare, cite, extract from, quote, verify against, or answer based on selected knowledge.
   - `knowledge-likely`: request probably depends on selected knowledge, internal docs, wiki pages, policies, uploaded files, product/project notes, or app knowledge-base data.
   - `general-task`: request can be handled without selected knowledge, such as rewriting, brainstorming, coding, general explanation, casual chat, or workflow help.
   - `upload-intent`: user wants to upload, import, add, ingest, save, index, or put a local file into a knowledge base.
   - `unclear`: it is ambiguous whether selected knowledge should be used.
2. For `selected-source-required`, search selected knowledge before answering.
3. For `knowledge-likely`, search selected knowledge before answering unless the selected source is clearly unrelated.
4. For `general-task`, do not search just because a knowledge base is selected. Answer normally.
5. For `upload-intent`, read `references/upload-routing.md`.
6. For `unclear`, ask a short clarification only when the answer would materially change. If the task can proceed safely, answer normally and mention selected knowledge was not used.

## Retrieval

When retrieving knowledge, prefer the distill-first flow:

1. Call `distill_nav` with the user's actual information need and any selected `knowledgeBaseIds` / `knowledgeIds` supported by the tool.
2. Read returned navigation and choose `distill_read_skill` only for pages whose `skill_id`, title, category, or summary directly matches the question. Do not guess ids that were not returned.
3. Use the distilled page only when it provides specific enough facts, constraints, examples, or guidance.
4. If the distilled page is insufficient, unavailable, or needs verification, use raw retrieval: `knowledge_search`, `grep_chunks`, `get_document_info`, `list_knowledge_chunks`, `wiki_search`, `wiki_read_page`, `query_knowledge_graph`, `distill_source_materials`, or `preview_rag_context` as appropriate.
5. When constructing a search query, rewrite the user's request into a concise knowledge-search query that captures the actual information need.

## Required Source References

Any final answer, summary, synthesis, comparison, extraction, timeline, classification, relationship description, or conclusion that uses data returned by knowledge retrieval, wiki, graph, document, chunk, distill, or source-material tools must cite the used data inline.

- Do not summarize retrieved knowledge without citations.
- Each summarized bullet, table row, or conclusion sentence must carry the source token for the retrieved data it summarizes.
- If a sentence combines multiple retrieved items, cite each supporting item next to the part it supports.
- A section heading like "Summary" or "Conclusion" does not reduce the citation requirement.
- Do not cite only at the end of a paragraph or answer.
- Do not say "according to the retrieved sources" as a substitute for a structured token.
- Do not omit citations because the data came from `distill_read_skill`; distill results are retrieved knowledge.

Use exactly these source token formats when fields are available:

- Knowledge chunks: `<kb doc="DOCUMENT_TITLE" chunk_id="CHUNK_ID" kb_id="KNOWLEDGE_BASE_ID" />`
- Wiki pages: `[[slug|display name|kb_id=KNOWLEDGE_BASE_ID]]`
- Distill pages: `<source app="weknora" type="distill" kb_id="KNOWLEDGE_BASE_ID" id="SKILL_ID" title="DISTILL_PAGE_TITLE" />`

Prefer citing underlying chunk/wiki sources over distill pages when they can be resolved. If `source_refs` or `chunk_refs` are opaque, call `distill_source_materials` before citing; if still unresolved, cite the distill page itself rather than fabricating fields.

For detailed tool routing, citation edge cases, or upload handling, read only the relevant reference file:

- `references/query-routing.md`
- `references/source-references.md`
- `references/upload-routing.md`
