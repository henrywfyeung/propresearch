// tests/unit/catchments.test.ts — point-in-polygon over the committed, bundled
// catchment GeoJSON (deterministic; the data is checked into src/data/catchments).

import { findCatchments } from '@/tools/schools/catchments';
import { describe, expect, it } from 'vitest';

describe('findCatchments', () => {
  it('resolves the VIC primary + secondary zone for a Richmond address (no catchType)', () => {
    const c = findCatchments(-37.812936, 144.9925, 'VIC');
    expect(c.primary?.school).toBeTruthy();
    expect(c.primary?.level).toBe('primary');
    expect(c.primary?.catchType).toBeNull(); // VIC layers carry no catchType
    expect(c.secondary?.school).toBeTruthy();
    expect(c.secondary?.level).toBe('secondary');
  });

  it('resolves the NSW zone WITH a catchType for a Mosman address', () => {
    const c = findCatchments(-33.8269, 151.2406, 'NSW');
    expect(c.primary?.school).toBeTruthy();
    expect(c.primary?.catchType).toBe('PRIMARY');
    expect(c.secondary?.catchType).toMatch(/^HIGH_/); // e.g. HIGH_COED / HIGH_BOYS
  });

  it('returns nulls for states without bundled data', () => {
    expect(findCatchments(-31.95, 115.86, 'WA')).toEqual({ primary: null, secondary: null });
  });

  it('returns nulls when the point lies outside every zone (offshore)', () => {
    const c = findCatchments(-39.5, 149.5, 'VIC'); // Bass Strait
    expect(c.primary).toBeNull();
    expect(c.secondary).toBeNull();
  });
});
