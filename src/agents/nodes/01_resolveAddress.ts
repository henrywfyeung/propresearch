// src/agents/nodes/01_resolveAddress.ts — Node 01 (CLAUDE.md §7.1). Geocodes the
// raw address via Mapbox into a ResolvedAddress. Hard-fails (throws) on an
// unresolvable address or an unsupported region — not an in-band degrade.

import type { GraphState } from '@/agents/annotation';
import { AddressResolutionError, UnsupportedRegionError } from '@/lib/errors';
import type { AusStateSchema } from '@/schemas/state';
import { forwardGeocode } from '@/tools/mapbox/geocode';
import type { z } from 'zod';

type AusState = z.infer<typeof AusStateSchema>;
const SUPPORTED: readonly AusState[] = ['NSW', 'VIC', 'WA'];

function isSupported(s: string): s is AusState {
  return (SUPPORTED as readonly string[]).includes(s);
}

export async function resolveAddress(state: GraphState): Promise<Partial<GraphState>> {
  const raw = state.rawAddress?.trim();
  if (!raw) throw new AddressResolutionError('no address provided');

  const geo = await forwardGeocode(raw);
  if (!geo) throw new AddressResolutionError(`could not geocode "${raw}"`);
  if (!geo.suburb || !geo.postcode || !geo.state) {
    throw new AddressResolutionError(`incomplete geocode for "${raw}"`);
  }

  const st = geo.state.toUpperCase();
  if (!isSupported(st)) throw new UnsupportedRegionError(`region ${st} is not supported`);

  return {
    resolvedAddress: {
      lat: geo.lat,
      lng: geo.lng,
      suburb: geo.suburb,
      postcode: geo.postcode,
      state: st,
      normalizedAddress: geo.matchedAddress ?? raw,
    },
  };
}
