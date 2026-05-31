// src/agents/nodes/05_planningAndNews.ts — Node 05 (CLAUDE.md §7.7 / spec §4).
// Fetches recent DAs near the subject property from the NSW ePlanning Online DA API.
// NSW-only in v1; non-NSW → empty market context (graceful degrade).
// Missing resolvedAddress → in-band PARTIAL_DATA error (mirror node 09).
// council === null (unmapped LGA) → empty market + logger.warn.
// fetchRecentDAs throws → empty market + logger.warn.

import type { GraphState } from '@/agents/annotation';
import { haversineMeters } from '@/lib/geo';
import { logger } from '@/lib/observability/logger';
import type { MarketContext, RecentDA } from '@/schemas/state';
import { lgaToCouncil } from '@/tools/nsw-planning/councils';
import { fetchRecentDAs } from '@/tools/nsw-planning/onlineDa';
import { resolveLga } from '@/tools/nsw-risk/lga';

// The OnlineDA endpoint URL used in sourceRef.endpoint.
const ONLINE_DA_URL = 'https://api.apps1.nsw.gov.au/eplanning/data/v0/OnlineDA';

// Only keep DAs within this many metres of the subject.
const MAX_DISTANCE_M = 500;

// Cap the list so compose/render don't get overwhelmed.
const MAX_DAS = 25;

/** Compute today − 12 months as a YYYY-MM-DD string. */
function lodgedFromDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export async function fetchPlanning(state: GraphState): Promise<Partial<GraphState>> {
  // Guard: no resolvedAddress
  if (!state.resolvedAddress) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'fetchPlanning: no resolvedAddress' }],
    };
  }

  const { lat, lng, state: region } = state.resolvedAddress;

  // NSW gate — VIC/WA planning sources not yet implemented
  if (region !== 'NSW') {
    return {
      market: { suburbStats: null, recentNews: [], recentDAs: [] },
    };
  }

  // Resolve LGA → CouncilName
  const lga = await resolveLga(lat, lng).catch((err: unknown) => {
    logger.warn({ err }, 'fetchPlanning: LGA resolution failed; degrading to empty market');
    return null;
  });

  const council = lga ? lgaToCouncil(lga) : null;

  if (council === null) {
    logger.warn(
      { lga },
      'fetchPlanning: unmapped LGA — planning data unavailable for this council',
    );
    return {
      market: emptyMarket(),
    };
  }

  // Fetch DAs from the OnlineDA API
  let rawRecords: Awaited<ReturnType<typeof fetchRecentDAs>>;
  try {
    rawRecords = await fetchRecentDAs(council, lodgedFromDate());
  } catch (err) {
    logger.warn({ err, council }, 'fetchPlanning: fetchRecentDAs threw; degrading to empty market');
    return {
      market: emptyMarket(),
    };
  }

  // Map valid records to RecentDA, filter to ≤500m, sort, cap
  const fetchedAt = new Date().toISOString();
  const recentDAs: RecentDA[] = [];

  for (const record of rawRecords) {
    const loc = record.Location[0];
    if (!loc) continue;

    const recLat = Number.parseFloat(loc.Y);
    const recLng = Number.parseFloat(loc.X);
    if (!Number.isFinite(recLat) || !Number.isFinite(recLng)) continue;

    const distanceM = haversineMeters({ lat, lng }, { lat: recLat, lng: recLng });
    if (distanceM > MAX_DISTANCE_M) continue;

    // Synthesize description from DevelopmentType array, falling back to ApplicationType
    const description =
      record.DevelopmentType && record.DevelopmentType.length > 0
        ? record.DevelopmentType.map((d) => d.DevelopmentType).join('; ')
        : record.ApplicationType;

    recentDAs.push({
      description,
      status: record.ApplicationStatus,
      category: record.DevelopmentCategory ?? record.ApplicationType ?? null,
      distanceM,
      lodgedDate: record.LodgementDate,
      coverage: 'full',
      sourceRef: {
        provider: 'nsw-planning',
        endpoint: ONLINE_DA_URL,
        fetchedAt,
        path: '/market/recentDAs',
      },
    });
  }

  // Sort by distance ascending, then cap
  recentDAs.sort((a, b) => a.distanceM - b.distanceM);
  const capped = recentDAs.slice(0, MAX_DAS);

  return {
    market: {
      suburbStats: null,
      recentNews: [],
      recentDAs: capped,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyMarket(): MarketContext {
  return { suburbStats: null, recentNews: [], recentDAs: [] };
}
