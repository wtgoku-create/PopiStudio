import { describe, expect, test } from 'vitest';

import { SourceReferenceKind } from '../types/sourceReference';
import { decodeSourceReferenceHref, encodeSourceReferencesForMarkdown } from './sourceReferences';

describe('sourceReferences', () => {
  test('encodes distill source tags as clickable source references', () => {
    const markdown = encodeSourceReferencesForMarkdown(
      'Fact. <source app="weknora" type="distill" kb_id="kb-1" id="relationship" title="人物关系" />',
    );
    const href = markdown.match(/\]\((popiai-source-ref:[^)]+)\)/)?.[1];

    expect(href).toBeTruthy();
    const reference = decodeSourceReferenceHref(href || '');
    expect(reference).toMatchObject({
      kind: SourceReferenceKind.Generic,
      app: 'weknora',
      type: 'distill',
      id: 'relationship',
      title: '人物关系',
      label: '人物关系',
      metadata: {
        kb_id: 'kb-1',
      },
    });
  });
});
