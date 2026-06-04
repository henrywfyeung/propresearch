// tests/unit/reaComps.test.ts
import { ComparableSchema } from '@/schemas/state';
import { mapReaPropertyType, parseAudPrice, toComparable } from '@/tools/comps/reaComps';
import { type ReaSoldListing, reaListingUrl } from '@/tools/rapidapi/rea';
import { describe, expect, it } from 'vitest';

const SUBJECT = { lat: -33.8184, lng: 151.2454 };

const base: ReaSoldListing = {
  listingId: '150833140',
  propertyType: 'apartment',
  price: { display: '$1,030,000' },
  dateSold: { display: '26 May 2026', value: '2026-05-26' },
  landSize: { value: 787, unit: 'm2' },
  features: { general: { bedrooms: 1, bathrooms: 1, parkingSpaces: 1 } },
  address: {
    streetAddress: '12/22 Warringah Road',
    suburb: 'Mosman',
    state: 'NSW',
    postcode: '2088',
    location: { latitude: -33.81835452, longitude: 151.24535984 },
  },
  images: [
    { server: 'https://i3.au.reastatic.net', uri: '/a/image.jpg' },
    { server: 'https://i3.au.reastatic.net', uri: '/b/image.jpg' },
  ],
};

describe('mapReaPropertyType', () => {
  it('maps to the canonical vocab used by similarity scoring', () => {
    expect(mapReaPropertyType('house')).toBe('House');
    expect(mapReaPropertyType('apartment')).toBe('ApartmentUnitFlat');
    expect(mapReaPropertyType('townhouse')).toBe('Townhouse');
    expect(mapReaPropertyType('something-weird')).toBe('Other');
    expect(mapReaPropertyType(null)).toBe('Other');
  });
});

describe('parseAudPrice', () => {
  it('parses a clean dollar amount', () => {
    expect(parseAudPrice('$1,030,000')).toBe(1030000);
  });
  it('returns null for withheld / non-numeric', () => {
    expect(parseAudPrice('Price Withheld')).toBeNull();
    expect(parseAudPrice('Contact Agent')).toBeNull();
    expect(parseAudPrice(undefined)).toBeNull();
  });
});

describe('toComparable', () => {
  it('produces a schema-valid Comparable', () => {
    const c = toComparable(base, SUBJECT);
    expect(c).not.toBeNull();
    expect(() => ComparableSchema.parse(c)).not.toThrow();
    expect(c?.salePrice).toBe(1030000);
    expect(c?.contractDate).toBe('2026-05-26');
    expect(c?.propertyType).toBe('ApartmentUnitFlat');
    expect(c?.beds).toBe(1);
    expect(c?.landArea).toBe(787);
    expect(c?.photos).toEqual([
      'https://i3.au.reastatic.net/1920x1080-format=jpg/a/image.jpg',
      'https://i3.au.reastatic.net/1920x1080-format=jpg/b/image.jpg',
    ]);
    expect(c?.distanceM).toBeLessThan(50); // same location
    expect(c?.source.provider).toBe('rea');
  });

  it('converts hectares to m²', () => {
    const c = toComparable({ ...base, landSize: { value: 0.12, unit: 'ha' } }, SUBJECT);
    expect(c?.landArea).toBe(1200);
  });

  it('drops video-host (youtube) image entries so vision is not fed a 400ing URL', () => {
    const withVideo = {
      ...base,
      images: [
        { server: 'https://i3.au.reastatic.net', uri: '/a/image.jpg', name: 'photo' },
        { server: 'https://img.youtube.com', uri: '/vi/abc/0.jpg', name: 'video' },
      ],
    };
    const c = toComparable(withVideo, SUBJECT);
    expect(c?.photos).toEqual(['https://i3.au.reastatic.net/1920x1080-format=jpg/a/image.jpg']);
    expect(c?.photos.some((u) => u.includes('youtube'))).toBe(false);
  });

  it('deep-links listingUrl to the canonical listing page (not the homepage)', () => {
    const c = toComparable(
      {
        ...base,
        _links: {
          prettyUrl: {
            href: 'https://www.realestate.com.au/property-apartment-nsw-mosman-150833140',
          },
        },
      },
      SUBJECT,
    );
    expect(c?.listingUrl).toBe(
      'https://www.realestate.com.au/property-apartment-nsw-mosman-150833140',
    );
  });

  it('falls back to the bare-id short URL when no prettyUrl is present', () => {
    const c = toComparable(base, SUBJECT); // base has no _links/prettyUrl
    expect(c?.listingUrl).toBe('https://www.realestate.com.au/150833140');
  });

  it('returns null when the price is withheld', () => {
    expect(toComparable({ ...base, price: { display: 'Price Withheld' } }, SUBJECT)).toBeNull();
  });

  it('returns null when geo is missing', () => {
    expect(toComparable({ ...base, address: { streetAddress: '1 X St' } }, SUBJECT)).toBeNull();
  });
});

describe('reaListingUrl', () => {
  it('prefers the absolute _links.prettyUrl.href', () => {
    expect(
      reaListingUrl({
        ...base,
        prettyUrl: 'property-apartment-nsw-mosman-150833140',
        _links: {
          prettyUrl: {
            href: 'https://www.realestate.com.au/property-apartment-nsw-mosman-150833140',
          },
        },
      }),
    ).toBe('https://www.realestate.com.au/property-apartment-nsw-mosman-150833140');
  });

  it('builds an absolute URL from the relative prettyUrl slug', () => {
    expect(reaListingUrl({ ...base, prettyUrl: 'property-apartment-nsw-mosman-150833140' })).toBe(
      'https://www.realestate.com.au/property-apartment-nsw-mosman-150833140',
    );
  });

  it('falls back to the bare listingId short URL', () => {
    expect(reaListingUrl(base)).toBe('https://www.realestate.com.au/150833140');
  });
});
