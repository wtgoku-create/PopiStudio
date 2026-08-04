export const CoworkPromptDocumentVersion = {
  V1: 1,
} as const;

export const CoworkPromptSegmentKind = {
  Text: 'text',
  Resource: 'resource',
  Skill: 'skill',
} as const;
export type CoworkPromptSegmentKind = typeof CoworkPromptSegmentKind[keyof typeof CoworkPromptSegmentKind];

export const CoworkPromptResourceSource = {
  Mention: 'mention',
  Upload: 'upload',
} as const;
export type CoworkPromptResourceSource = typeof CoworkPromptResourceSource[keyof typeof CoworkPromptResourceSource];

export const CoworkPromptResourceTransport = {
  Reference: 'reference',
} as const;
export type CoworkPromptResourceTransport = typeof CoworkPromptResourceTransport[keyof typeof CoworkPromptResourceTransport];

export interface CoworkPromptTextSegment {
  kind: typeof CoworkPromptSegmentKind.Text;
  text: string;
}

export interface CoworkPromptResourceSegment {
  kind: typeof CoworkPromptSegmentKind.Resource;
  resourceId: string;
}

export interface CoworkPromptSkillSegment {
  kind: typeof CoworkPromptSegmentKind.Skill;
  skillId: string;
}

export type CoworkPromptSegment = CoworkPromptTextSegment | CoworkPromptResourceSegment | CoworkPromptSkillSegment;

export interface CoworkPromptResource {
  id: string;
  name: string;
  path: string;
  source: CoworkPromptResourceSource;
  transport: CoworkPromptResourceTransport;
}

export interface CoworkPromptSkill {
  id: string;
  name: string;
  description: string;
  location: string;
  directory: string;
}

export interface CoworkPromptDocument {
  version: typeof CoworkPromptDocumentVersion.V1;
  segments: CoworkPromptSegment[];
  resources: CoworkPromptResource[];
  skills?: CoworkPromptSkill[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const normalizeCoworkPromptDocument = (value: unknown): CoworkPromptDocument | undefined => {
  if (!isRecord(value) || value.version !== CoworkPromptDocumentVersion.V1) return undefined;
  if (!Array.isArray(value.segments) || !Array.isArray(value.resources)) return undefined;

  const resources: CoworkPromptResource[] = [];
  const resourceIds = new Set<string>();
  for (const item of value.resources) {
    if (!isRecord(item)) return undefined;
    const { id, name, path, source, transport } = item;
    if (
      typeof id !== 'string'
      || typeof name !== 'string'
      || typeof path !== 'string'
      || !Object.values(CoworkPromptResourceSource).includes(source as CoworkPromptResourceSource)
      || transport !== CoworkPromptResourceTransport.Reference
    ) {
      return undefined;
    }
    if (!id || !path || resourceIds.has(id)) return undefined;
    resourceIds.add(id);
    resources.push({
      id,
      name,
      path,
      source: source as CoworkPromptResourceSource,
      transport,
    });
  }

  const skills: CoworkPromptSkill[] = [];
  const skillIds = new Set<string>();
  if (value.skills !== undefined) {
    if (!Array.isArray(value.skills)) return undefined;
    for (const item of value.skills) {
      if (!isRecord(item)) return undefined;
      const { id, name, description, location, directory } = item;
      if (
        typeof id !== 'string'
        || typeof name !== 'string'
        || typeof description !== 'string'
        || typeof location !== 'string'
        || typeof directory !== 'string'
        || !id
        || !location
        || skillIds.has(id)
      ) {
        return undefined;
      }
      skillIds.add(id);
      skills.push({ id, name, description, location, directory });
    }
  }

  const segments: CoworkPromptSegment[] = [];
  for (const item of value.segments) {
    if (!isRecord(item)) return undefined;
    if (item.kind === CoworkPromptSegmentKind.Text && typeof item.text === 'string') {
      segments.push({ kind: CoworkPromptSegmentKind.Text, text: item.text });
      continue;
    }
    if (
      item.kind === CoworkPromptSegmentKind.Resource
      && typeof item.resourceId === 'string'
      && resourceIds.has(item.resourceId)
    ) {
      segments.push({ kind: CoworkPromptSegmentKind.Resource, resourceId: item.resourceId });
      continue;
    }
    if (
      item.kind === CoworkPromptSegmentKind.Skill
      && typeof item.skillId === 'string'
      && skillIds.has(item.skillId)
    ) {
      segments.push({ kind: CoworkPromptSegmentKind.Skill, skillId: item.skillId });
      continue;
    }
    return undefined;
  }

  return {
    version: CoworkPromptDocumentVersion.V1,
    segments,
    resources,
    ...(value.skills !== undefined ? { skills } : {}),
  };
};

export const getCoworkPromptDocumentText = (document: CoworkPromptDocument): string => (
  document.segments
    .filter((segment): segment is CoworkPromptTextSegment => segment.kind === CoworkPromptSegmentKind.Text)
    .map(segment => segment.text)
    .join('')
);

export const stripCoworkPromptDocumentSkills = (
  document: CoworkPromptDocument,
): CoworkPromptDocument => ({
  version: document.version,
  segments: document.segments.filter(segment => segment.kind !== CoworkPromptSegmentKind.Skill),
  resources: document.resources,
});

const escapeXmlAttribute = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/'/g, '&apos;');

export const serializeCoworkPromptDocumentForOpenClaw = (
  document: CoworkPromptDocument,
  fallbackText = '',
): string => {
  const resourcesById = new Map(document.resources.map(resource => [resource.id, resource]));
  const skillsById = new Map((document.skills ?? []).map(skill => [skill.id, skill]));
  const transportIdsByResourceId = new Map<string, string>();
  const transportIdsBySkillId = new Map<string, string>();
  const referencedResources: Array<{ transportId: string; resource: CoworkPromptResource }> = [];
  const referencedSkills: Array<{ transportId: string; skill: CoworkPromptSkill }> = [];
  const body = document.segments.map((segment) => {
    if (segment.kind === CoworkPromptSegmentKind.Text) return segment.text;
    if (segment.kind === CoworkPromptSegmentKind.Resource) {
      const resource = resourcesById.get(segment.resourceId);
      if (!resource) return '';
      let transportId = transportIdsByResourceId.get(resource.id);
      if (!transportId) {
        transportId = `r${referencedResources.length + 1}`;
        transportIdsByResourceId.set(resource.id, transportId);
        referencedResources.push({ transportId, resource });
      }
      return `{{resource:${transportId}}}`;
    }
    const skill = skillsById.get(segment.skillId);
    if (!skill) return '';
    let transportId = transportIdsBySkillId.get(skill.id);
    if (!transportId) {
      transportId = `s${referencedSkills.length + 1}`;
      transportIdsBySkillId.set(skill.id, transportId);
      referencedSkills.push({ transportId, skill });
    }
    return `{{skill:${transportId}}}`;
  }).join('');
  const trimmedBody = body.trim() || fallbackText.trim();
  if (referencedResources.length === 0 && referencedSkills.length === 0) return trimmedBody;

  const manifests: string[] = [];
  if (referencedSkills.length > 0) {
    const skillManifest = referencedSkills.map(({ transportId, skill }) => (
      `  <skill id="${transportId}" skill-id="${escapeXmlAttribute(skill.id)}" label="${escapeXmlAttribute(skill.name)}" location="${escapeXmlAttribute(skill.location)}" directory="${escapeXmlAttribute(skill.directory)}" />`
    )).join('\n');
    manifests.push(`<skills>\n${skillManifest}\n</skills>`);
  }
  if (referencedResources.length > 0) {
    const resourceManifest = referencedResources.map(({ transportId, resource }) => {
      const locationAttribute = /^https?:\/\//i.test(resource.path) ? 'url' : 'path';
      return `  <resource id="${transportId}" label="${escapeXmlAttribute(resource.name)}" ${locationAttribute}="${escapeXmlAttribute(resource.path)}" />`;
    }).join('\n');
    manifests.push(`<resources>\n${resourceManifest}\n</resources>`);
  }
  return `${manifests.join('\n')}\n\n${trimmedBody}`;
};
