import { STREET_VIEW_HEADINGS, streetviewUrl, streetviewUrls } from '@/tools/streetview/url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const PREV = process.env.GOOGLE_MAPS_KEY;
beforeEach(() => {
  process.env.GOOGLE_MAPS_KEY = 'test-maps-key';
});
afterEach(() => {
  process.env.GOOGLE_MAPS_KEY = PREV;
});

describe('streetviewUrl (§8.5)', () => {
  it('builds the exact parameter set', () => {
    const url = new URL(streetviewUrl(-33.8, 151.2, 90));
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/streetview');
    expect(url.searchParams.get('size')).toBe('640x640');
    expect(url.searchParams.get('location')).toBe('-33.8,151.2');
    expect(url.searchParams.get('heading')).toBe('90');
    expect(url.searchParams.get('pitch')).toBe('0');
    expect(url.searchParams.get('fov')).toBe('90');
    expect(url.searchParams.get('return_error_code')).toBe('true');
    expect(url.searchParams.get('key')).toBe('test-maps-key');
  });

  it('produces 4 URLs at headings 0/90/180/270', () => {
    const urls = streetviewUrls(-33.8, 151.2);
    expect(urls).toHaveLength(4);
    expect(STREET_VIEW_HEADINGS).toEqual([0, 90, 180, 270]);
    const headings = urls.map((u) => new URL(u).searchParams.get('heading'));
    expect(headings).toEqual(['0', '90', '180', '270']);
  });

  it('throws when GOOGLE_MAPS_KEY is missing', () => {
    process.env.GOOGLE_MAPS_KEY = '';
    expect(() => streetviewUrl(0, 0, 0)).toThrow(/GOOGLE_MAPS_KEY/);
  });
});
