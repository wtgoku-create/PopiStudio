# Upload Tool Routing

When the user asks to upload, import, add, ingest, save, index, or put a local file into the knowledge base, use the local MCP tool `upload_agent_knowledge_file` from the `knowledge` MCP server.

Tool routing rules:

- Use `upload_agent_knowledge_file` only for explicit knowledge-base upload intent.
- Before calling `upload_agent_knowledge_file`, check if the `AskUserQuestion` tool is available. If it is available, use it to ask the user to confirm the upload.
- The confirmation request must clearly state the file path and target knowledge-base context with options like "Upload" / "Cancel".
- If `AskUserQuestion` is not available, ask the user for confirmation in plain text before calling `upload_agent_knowledge_file`.
- Call `upload_agent_knowledge_file` with `userConfirmed: true` only after the user explicitly confirms this upload. Never set `userConfirmed: true` based only on your own plan or inference.
- Pass `filePath` as an absolute local file path. If the user provides only a filename, first locate the file in the working directory before calling the tool.
- Pass `fileName` when the user specifies the uploaded display name; otherwise let the tool use the local basename.
- Pass `metadata` when the user provides source, scene, tags, or other upload metadata.
- Pass `channel` only when the user specifies it; otherwise let the tool default to `agent`.
- Do not ask the user for an API key unless the tool reports that the knowledge access token is missing.
- After a successful upload, report the returned knowledge id and knowledge base id if present.
