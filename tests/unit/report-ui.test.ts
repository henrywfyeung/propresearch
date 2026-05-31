// tests/unit/report-ui.test.ts
//
// Pure-logic unit tests for the report UI pages.
// No DOM rendering — only the extracted pure functions are tested.

import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Stepper logic (from report-progress.tsx)
// ---------------------------------------------------------------------------

import {
  NODE_LABELS,
  NODE_ORDER,
  activeStepIndex,
  labelForNode,
} from '@/app/reports/[id]/report-progress';

describe('NODE_LABELS', () => {
  it('has a label for every node in NODE_ORDER', () => {
    for (const node of NODE_ORDER) {
      expect(NODE_LABELS[node]).toBeTruthy();
    }
  });

  it('includes the expected CLAUDE.md §15.2 labels', () => {
    expect(NODE_LABELS.resolveAddress).toBe('Resolving address…');
    expect(NODE_LABELS.fetchCandidateComps).toBe('Finding comparable sales…');
    expect(NODE_LABELS.fetchRisks).toBe('Assessing risks…');
    expect(NODE_LABELS.fetchPlanning).toBe('Pulling planning activity…');
    expect(NODE_LABELS.reasonAndSelect).toBe('Selecting best comparables…');
    expect(NODE_LABELS.triangulate).toBe('Triangulating value…');
    expect(NODE_LABELS.compose).toBe('Writing the report…');
    expect(NODE_LABELS.render).toBe('Rendering PDF…');
  });
});

describe('labelForNode', () => {
  it('returns the correct label for a known node', () => {
    expect(labelForNode('resolveAddress')).toBe('Resolving address…');
    expect(labelForNode('render')).toBe('Rendering PDF…');
  });

  it('returns "Starting…" for null', () => {
    expect(labelForNode(null)).toBe('Starting…');
  });

  it('returns "Starting…" for undefined', () => {
    expect(labelForNode(undefined)).toBe('Starting…');
  });

  it('falls back to the raw node name for unknown nodes', () => {
    expect(labelForNode('unknownNode')).toBe('unknownNode');
  });
});

describe('activeStepIndex', () => {
  it('returns -1 for null', () => {
    expect(activeStepIndex(null)).toBe(-1);
  });

  it('returns -1 for undefined', () => {
    expect(activeStepIndex(undefined)).toBe(-1);
  });

  it('returns 0 for resolveAddress (first step)', () => {
    expect(activeStepIndex('resolveAddress')).toBe(0);
  });

  it('returns NODE_ORDER.length - 1 for render (last step)', () => {
    expect(activeStepIndex('render')).toBe(NODE_ORDER.length - 1);
  });

  it('returns the correct mid-pipeline index for reasonAndSelect', () => {
    const expected = NODE_ORDER.indexOf('reasonAndSelect');
    expect(activeStepIndex('reasonAndSelect')).toBe(expected);
  });

  it('returns -1 for an unknown node name', () => {
    expect(activeStepIndex('bogusNode')).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// Form body builder (from new-report-form.tsx)
// ---------------------------------------------------------------------------

import { buildPostBody } from '@/app/reports/new/new-report-form';

describe('buildPostBody', () => {
  const BASE = {
    rawAddress: '12 Smith St, Mosman NSW 2088',
    beds: '3',
    baths: '2',
    parking: '1',
    landArea: '650',
    buildingArea: '220',
    propertyType: 'House',
  };

  it('converts string numbers to numeric fields', () => {
    const body = buildPostBody(BASE);
    expect(body.subject.beds).toBe(3);
    expect(body.subject.baths).toBe(2);
    expect(body.subject.parking).toBe(1);
    expect(body.subject.landArea).toBe(650);
    expect(body.subject.buildingArea).toBe(220);
  });

  it('trims whitespace from rawAddress', () => {
    const body = buildPostBody({ ...BASE, rawAddress: '  12 X St  ' });
    expect(body.rawAddress).toBe('12 X St');
  });

  it('sets landArea to null when empty string', () => {
    const body = buildPostBody({ ...BASE, landArea: '' });
    expect(body.subject.landArea).toBeNull();
  });

  it('sets buildingArea to null when empty string', () => {
    const body = buildPostBody({ ...BASE, buildingArea: '' });
    expect(body.subject.buildingArea).toBeNull();
  });

  it('preserves propertyType string', () => {
    const body = buildPostBody({ ...BASE, propertyType: 'Apartment' });
    expect(body.subject.propertyType).toBe('Apartment');
  });

  it('produces the correct rawAddress field', () => {
    const body = buildPostBody(BASE);
    expect(body.rawAddress).toBe('12 Smith St, Mosman NSW 2088');
  });

  it('shape matches the POST /api/reports BodySchema', () => {
    const body = buildPostBody(BASE);
    expect(body).toEqual({
      rawAddress: '12 Smith St, Mosman NSW 2088',
      subject: {
        beds: 3,
        baths: 2,
        parking: 1,
        landArea: 650,
        buildingArea: 220,
        propertyType: 'House',
      },
    });
  });
});
