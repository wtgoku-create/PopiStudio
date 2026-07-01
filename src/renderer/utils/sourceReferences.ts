import { SourceReferenceKind, type SourceReference } from '../types/sourceReference';

const KB_TAG_RE = /<kb\s+([^<>]*?)\/>/gi;
const SOURCE_TAG_RE = /<source\s+([^<>]*?)\/>/gi;
const WIKI_LINK_RE = /\[\[([^\]|\n]+)\|([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

const SOURCE_REF_SCHEME = 'popiai-source-ref:';

const ATTR_RE = /([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*"([^"]*)"/g;

const parseAttributes = (value: string): Record<string, string> => {
  const attrs: Record<string, string> = {};
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(value)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
};

const encodeReference = (reference: SourceReference): string => {
  return `${SOURCE_REF_SCHEME}${encodeURIComponent(JSON.stringify(reference))}`;
};

const escapeMarkdownLinkText = (value: string): string => (
  value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
);

const toMarkdownReferenceLink = (label: string, reference: SourceReference): string => {
  return `[${escapeMarkdownLinkText(label)}](${encodeReference(reference)})`;
};

const parseWikiLinkParams = (value: string | undefined): Record<string, string> => {
  const params: Record<string, string> = {};
  if (!value) return params;
  for (const part of value.split('|')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const paramValue = part.slice(index + 1).trim();
    if (key && paramValue) {
      params[key] = paramValue;
    }
  }
  return params;
};

const buildChunkReference = (attrs: Record<string, string>): SourceReference | null => {
  const doc = attrs.doc?.trim();
  const chunkId = attrs.chunk_id?.trim();
  const kbId = attrs.kb_id?.trim();
  if (!doc || !chunkId || !kbId) {
    return null;
  }
  return {
    kind: SourceReferenceKind.Chunk,
    app: attrs.app?.trim() || 'weknora',
    doc,
    chunkId,
    kbId,
    label: doc,
  };
};

const buildGenericReference = (attrs: Record<string, string>): SourceReference | null => {
  const app = attrs.app?.trim();
  const type = attrs.type?.trim();
  if (!app || !type) {
    return null;
  }

  if (type === SourceReferenceKind.Chunk) {
    const chunk = buildChunkReference(attrs);
    if (chunk) return { ...chunk, app };
  }

  if (type === SourceReferenceKind.Wiki) {
    const slug = attrs.slug?.trim();
    const title = attrs.title?.trim() || attrs.name?.trim();
    if (!slug || !title) return null;
    return {
      kind: SourceReferenceKind.Wiki,
      app,
      slug,
      title,
      kbId: attrs.kb_id?.trim() || undefined,
      label: title,
    };
  }

  const title = attrs.title?.trim() || attrs.name?.trim();
  const id = attrs.id?.trim();
  return {
    kind: SourceReferenceKind.Generic,
    app,
    type,
    id,
    title,
    label: title || id || `${app}/${type}`,
    metadata: attrs,
  };
};

export const encodeSourceReferencesForMarkdown = (content: string): string => {
  return content
    .replace(KB_TAG_RE, (raw, attrText) => {
      const reference = buildChunkReference(parseAttributes(attrText));
      return reference ? toMarkdownReferenceLink(reference.label, reference) : raw;
    })
    .replace(SOURCE_TAG_RE, (raw, attrText) => {
      const reference = buildGenericReference(parseAttributes(attrText));
      return reference ? toMarkdownReferenceLink(reference.label, reference) : raw;
    })
    .replace(WIKI_LINK_RE, (raw, slugValue, titleValue, paramsValue) => {
      const slug = String(slugValue).trim();
      const title = String(titleValue).trim();
      if (!slug || !title) return raw;
      const params = parseWikiLinkParams(typeof paramsValue === 'string' ? paramsValue : undefined);
      const reference: SourceReference = {
        kind: SourceReferenceKind.Wiki,
        app: 'weknora',
        slug,
        title,
        kbId: params.kb_id || undefined,
        label: title,
      };
      return toMarkdownReferenceLink(title, reference);
    });
};

export const decodeSourceReferenceHref = (href: string): SourceReference | null => {
  if (!href.startsWith(SOURCE_REF_SCHEME)) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(href.slice(SOURCE_REF_SCHEME.length)));
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<SourceReference>;
    if (
      candidate.kind === SourceReferenceKind.Chunk
      || candidate.kind === SourceReferenceKind.Wiki
      || candidate.kind === SourceReferenceKind.Generic
    ) {
      return parsed as SourceReference;
    }
    return null;
  } catch {
    return null;
  }
};
