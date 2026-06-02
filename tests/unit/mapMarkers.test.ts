// tests/unit/mapMarkers.test.ts — school type → marker style mapping + distinct colours.

import {
  EARLY_ED_STYLE,
  HOSPITAL_STYLE,
  PRIMARY_STYLE,
  SECONDARY_STYLE,
  SUBJECT_STYLE,
  schoolStyle,
} from '@/report/mapMarkers';
import { describe, expect, it } from 'vitest';

describe('schoolStyle', () => {
  it('maps primary + generic school → PRIMARY (green/school)', () => {
    expect(schoolStyle('primary')).toBe(PRIMARY_STYLE);
    expect(schoolStyle('school')).toBe(PRIMARY_STYLE);
  });

  it('maps secondary + combined → SECONDARY (blue/college)', () => {
    expect(schoolStyle('secondary')).toBe(SECONDARY_STYLE);
    expect(schoolStyle('combined')).toBe(SECONDARY_STYLE);
  });

  it('maps early-education → EARLY_ED (amber/playground)', () => {
    expect(schoolStyle('early-education')).toBe(EARLY_ED_STYLE);
  });
});

describe('marker styles', () => {
  it('every category has a distinct colour (so pins are tellable apart)', () => {
    const colours = [
      SUBJECT_STYLE,
      PRIMARY_STYLE,
      SECONDARY_STYLE,
      EARLY_ED_STYLE,
      HOSPITAL_STYLE,
    ].map((s) => s.color);
    expect(new Set(colours).size).toBe(colours.length);
  });

  it('colours are bare hex (no #) for Mapbox marker syntax', () => {
    for (const s of [PRIMARY_STYLE, SECONDARY_STYLE, EARLY_ED_STYLE, HOSPITAL_STYLE]) {
      expect(s.color).toMatch(/^[0-9a-f]{6}$/);
    }
  });
});
