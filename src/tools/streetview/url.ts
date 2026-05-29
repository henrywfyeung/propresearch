// Google Static Street View URL builder — exact spec from CLAUDE.md §8.5.
// The GOOGLE_MAPS_KEY must be restricted by HTTP-referrer / IP-allowlist to
// the Vercel deployment before prod ([R18]).

export const STREET_VIEW_HEADINGS = [0, 90, 180, 270] as const;

export function streetviewUrl(lat: number, lng: number, heading: number): string {
  const u = new URL('https://maps.googleapis.com/maps/api/streetview');
  u.searchParams.set('size', '640x640');
  u.searchParams.set('location', `${lat},${lng}`);
  u.searchParams.set('heading', String(heading));
  u.searchParams.set('pitch', '0');
  u.searchParams.set('fov', '90');
  u.searchParams.set('return_error_code', 'true');
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) throw new Error('GOOGLE_MAPS_KEY is not set');
  u.searchParams.set('key', key);
  return u.toString();
}

/** The four heading URLs for a location, in N/E/S/W order. */
export function streetviewUrls(lat: number, lng: number): string[] {
  return STREET_VIEW_HEADINGS.map((h) => streetviewUrl(lat, lng, h));
}
