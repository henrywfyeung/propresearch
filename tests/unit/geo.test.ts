// tests/unit/geo.test.ts
import { haversineMeters } from '@/lib/geo';
import { describe, expect, it } from 'vitest';

describe('haversineMeters', () => {
  it('is 0 for identical points', () => {
    expect(haversineMeters({ lat: -33.8, lng: 151.2 }, { lat: -33.8, lng: 151.2 })).toBe(0);
  });

  it('matches a known Sydney distance within 1%', () => {
    // Sydney Opera House → Sydney Town Hall ≈ 1.97 km for these coords
    const d = haversineMeters({ lat: -33.8568, lng: 151.2153 }, { lat: -33.8731, lng: 151.2069 });
    expect(d).toBeGreaterThan(1951);
    expect(d).toBeLessThan(1991);
  });

  it('returns a rounded integer', () => {
    const d = haversineMeters({ lat: -33.81835, lng: 151.24536 }, { lat: -33.819, lng: 151.246 });
    expect(Number.isInteger(d)).toBe(true);
  });
});
