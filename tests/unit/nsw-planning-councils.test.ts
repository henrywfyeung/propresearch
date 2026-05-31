// tests/unit/nsw-planning-councils.test.ts
// Unit tests for the LGA→CouncilName map in @/tools/nsw-planning/councils.ts.

import { LGA_TO_COUNCIL, lgaToCouncil } from '@/tools/nsw-planning/councils';
import { describe, expect, it } from 'vitest';

describe('lgaToCouncil — known mappings', () => {
  it('MOSMAN → Mosman Municipal Council', () => {
    expect(lgaToCouncil('MOSMAN')).toBe('Mosman Municipal Council');
  });

  it('SYDNEY → Council of the City of Sydney', () => {
    expect(lgaToCouncil('SYDNEY')).toBe('Council of the City of Sydney');
  });

  it('PARRAMATTA → City of Parramatta Council', () => {
    expect(lgaToCouncil('PARRAMATTA')).toBe('City of Parramatta Council');
  });

  it('NORTH SYDNEY → North Sydney Council', () => {
    expect(lgaToCouncil('NORTH SYDNEY')).toBe('North Sydney Council');
  });

  it('WILLOUGHBY → Willoughby City Council', () => {
    expect(lgaToCouncil('WILLOUGHBY')).toBe('Willoughby City Council');
  });

  it('KU-RING-GAI → Ku-ring-gai Council', () => {
    expect(lgaToCouncil('KU-RING-GAI')).toBe('Ku-ring-gai Council');
  });

  it('INNER WEST → Inner West Council', () => {
    expect(lgaToCouncil('INNER WEST')).toBe('Inner West Council');
  });

  it('RANDWICK → Randwick City Council', () => {
    expect(lgaToCouncil('RANDWICK')).toBe('Randwick City Council');
  });

  it('WAVERLEY → Waverley Council', () => {
    expect(lgaToCouncil('WAVERLEY')).toBe('Waverley Council');
  });

  it('WOOLLAHRA → Woollahra Municipal Council', () => {
    expect(lgaToCouncil('WOOLLAHRA')).toBe('Woollahra Municipal Council');
  });

  it('LANE COVE → Lane Cove Municipal Council', () => {
    expect(lgaToCouncil('LANE COVE')).toBe('Lane Cove Municipal Council');
  });

  it('HUNTERS HILL → The Council of the Municipality of Hunters Hill', () => {
    expect(lgaToCouncil('HUNTERS HILL')).toBe('The Council of the Municipality of Hunters Hill');
  });

  it('NORTHERN BEACHES → Northern Beaches Council', () => {
    expect(lgaToCouncil('NORTHERN BEACHES')).toBe('Northern Beaches Council');
  });

  it('BLACKTOWN → Blacktown City Council', () => {
    expect(lgaToCouncil('BLACKTOWN')).toBe('Blacktown City Council');
  });

  it('THE HILLS → The Hills Shire Council', () => {
    expect(lgaToCouncil('THE HILLS')).toBe('The Hills Shire Council');
  });

  it('PENRITH → Penrith City Council', () => {
    expect(lgaToCouncil('PENRITH')).toBe('Penrith City Council');
  });

  it('LIVERPOOL → Liverpool City Council', () => {
    expect(lgaToCouncil('LIVERPOOL')).toBe('Liverpool City Council');
  });

  it('CAMPBELLTOWN → Campbelltown City Council', () => {
    expect(lgaToCouncil('CAMPBELLTOWN')).toBe('Campbelltown City Council');
  });

  it('WOLLONGONG → Wollongong City Council', () => {
    expect(lgaToCouncil('WOLLONGONG')).toBe('Wollongong City Council');
  });

  it('NEWCASTLE → Newcastle City Council', () => {
    expect(lgaToCouncil('NEWCASTLE')).toBe('Newcastle City Council');
  });

  it('LAKE MACQUARIE → Lake Macquarie City Council', () => {
    expect(lgaToCouncil('LAKE MACQUARIE')).toBe('Lake Macquarie City Council');
  });

  it('CENTRAL COAST → Central Coast Council', () => {
    expect(lgaToCouncil('CENTRAL COAST')).toBe('Central Coast Council');
  });

  it('HORNSBY → The Council of the Shire of Hornsby', () => {
    expect(lgaToCouncil('HORNSBY')).toBe('The Council of the Shire of Hornsby');
  });

  it('SUTHERLAND → Sutherland Shire Council', () => {
    expect(lgaToCouncil('SUTHERLAND')).toBe('Sutherland Shire Council');
  });

  it('BAYSIDE → Bayside Council', () => {
    expect(lgaToCouncil('BAYSIDE')).toBe('Bayside Council');
  });

  it('GEORGES RIVER → Georges River Council', () => {
    expect(lgaToCouncil('GEORGES RIVER')).toBe('Georges River Council');
  });

  it('CANTERBURY-BANKSTOWN → Canterbury-Bankstown Council', () => {
    expect(lgaToCouncil('CANTERBURY-BANKSTOWN')).toBe('Canterbury-Bankstown Council');
  });

  it('CANADA BAY → City of Canada Bay Council', () => {
    expect(lgaToCouncil('CANADA BAY')).toBe('City of Canada Bay Council');
  });

  it('STRATHFIELD → Strathfield Municipal Council', () => {
    expect(lgaToCouncil('STRATHFIELD')).toBe('Strathfield Municipal Council');
  });
});

describe('lgaToCouncil — case-insensitive key handling', () => {
  it('accepts lowercase input', () => {
    expect(lgaToCouncil('mosman')).toBe('Mosman Municipal Council');
  });

  it('accepts mixed case input', () => {
    expect(lgaToCouncil('Mosman')).toBe('Mosman Municipal Council');
  });

  it('accepts mixed case multi-word', () => {
    expect(lgaToCouncil('North Sydney')).toBe('North Sydney Council');
  });

  it('accepts fully uppercase', () => {
    expect(lgaToCouncil('WAVERLEY')).toBe('Waverley Council');
  });
});

describe('lgaToCouncil — unknown / unmapped LGAs return null', () => {
  it('returns null for an empty string', () => {
    expect(lgaToCouncil('')).toBeNull();
  });

  it('returns null for a VIC LGA', () => {
    expect(lgaToCouncil('MELBOURNE')).toBeNull();
  });

  it('returns null for a completely unknown string', () => {
    expect(lgaToCouncil('NONEXISTENT LGA XYZ')).toBeNull();
  });
});

describe('LGA_TO_COUNCIL map sanity checks', () => {
  it('has at least 80 entries (broad coverage)', () => {
    expect(Object.keys(LGA_TO_COUNCIL).length).toBeGreaterThanOrEqual(80);
  });

  it('all keys are uppercase strings', () => {
    for (const key of Object.keys(LGA_TO_COUNCIL)) {
      expect(key, `Key "${key}" should be uppercase`).toBe(key.toUpperCase());
    }
  });

  it('all values are non-empty strings', () => {
    for (const [key, value] of Object.entries(LGA_TO_COUNCIL)) {
      expect(typeof value, `Value for "${key}" should be a string`).toBe('string');
      expect(value.length, `Value for "${key}" should be non-empty`).toBeGreaterThan(0);
    }
  });
});
