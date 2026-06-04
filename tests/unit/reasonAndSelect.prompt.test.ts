// tests/unit/reasonAndSelect.prompt.test.ts — 3-phase prompt builders.
import {
  type AnalysedComp,
  type ReasonSelectComp,
  type ReasonSubject,
  analyseVersion,
  buildAnalyseMessages,
  buildPlanMessages,
  buildSelectMessages,
  planVersion,
  selectVersion,
} from '@/prompts/reasonAndSelect';
import { describe, expect, it } from 'vitest';

const subject: ReasonSubject = {
  suburb: 'Mosman',
  attrs: {
    beds: 3,
    baths: 2,
    parking: 1,
    landArea: 500,
    buildingArea: null,
    propertyType: 'House',
  },
  layout: {
    storeys: 'double',
    structure: 'free-standing',
    positionInComplex: 'not-applicable',
    singleLevelLiving: false,
    streetFrontage: 'own-frontage',
    era: 'contemporary',
    configNotes: ['Open-plan living'],
  },
  condition: 'good',
};

const comp: ReasonSelectComp = {
  id: 'A',
  address: 'A St',
  salePrice: 2_000_000,
  contractDate: '2026-03-01',
  distanceM: 100,
  beds: 3,
  baths: 2,
  landArea: 480,
  propertyType: 'House',
  similarityScore: 90,
  layout: { storeys: 'double', structure: 'free-standing', era: 'contemporary' },
  condition: 'good',
};

const analysed: AnalysedComp = {
  id: 'A',
  address: 'A St',
  adjustedValue: 2_100_000,
  verdict: 'comparable',
  beds: 3,
  baths: 2,
  distanceM: 100,
  similarityScore: 90,
  recommendExclude: false,
};

describe('reasonAndSelect prompts', () => {
  it('all three phases have non-empty versions', () => {
    expect(planVersion.length).toBeGreaterThan(0);
    expect(analyseVersion.length).toBeGreaterThan(0);
    expect(selectVersion.length).toBeGreaterThan(0);
  });

  it('PLAN carries the subject + comps and asks for verdict + shortlist', () => {
    const m = buildPlanMessages(subject, [comp]);
    expect(m[0]?.content).toContain('shortlist');
    expect(m[1]?.content).toContain('Mosman');
    expect(m[1]?.content).toContain('"A"');
  });

  it('ANALYSE grounds Size/Layout/Condition + carries subject layout/condition', () => {
    const m = buildAnalyseMessages(subject, [comp]);
    expect(m[0]?.content).toContain('layout');
    expect(m[0]?.content).toContain('recommendExclude');
    expect(m[1]?.content).toContain('Subject layout');
    expect(m[1]?.content).toContain('Subject condition');
  });

  it('SELECT carries the analysed comps + honours recommendExclude', () => {
    const m = buildSelectMessages(subject, [analysed]);
    expect(m[0]?.content).toContain('recommendExclude');
    expect(m[0]?.content).toContain('fair-value');
    expect(m[1]?.content).toContain('"A"');
  });
});
