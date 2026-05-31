// src/agents/nodes/09_fetchRisks.ts — Node 09 (CLAUDE.md §7.11 / spec §4).
// Runs bushfire / heritage / flood lookups in parallel for NSW properties.
// Non-NSW → three dataAvailable:false informational flags (v1 NSW-only).
// Missing resolvedAddress → in-band PARTIAL_DATA error.
// Per-category failure → dataAvailable:false degrade flag + logger.warn.
// null from bushfire/heritage (no intersect) → dataAvailable:true 'None identified.'
//
// Per-item idempotency (report_node_artifacts, [R21]) is deferred until the
// durable Inngest queue lands.

import type { GraphState } from '@/agents/annotation';
import { logger } from '@/lib/observability/logger';
import type { RiskFlag } from '@/schemas/state';
import { queryBushfire } from '@/tools/nsw-risk/bushfire';
import { queryFlood } from '@/tools/nsw-risk/flood';
import { queryHeritage } from '@/tools/nsw-risk/heritage';
import { resolveLga } from '@/tools/nsw-risk/lga';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Degrade flag used when a source throws. */
function degradeFlag(category: RiskFlag['category']): RiskFlag {
  return {
    category,
    severity: 'informational',
    description: 'Risk data unavailable (source error).',
    dataAvailable: false,
    sourceRef: null,
    evidence: null,
  };
}

/** 'None identified' flag — the source was available but found no intersect. */
function noneFlag(category: RiskFlag['category']): RiskFlag {
  return {
    category,
    severity: 'informational',
    description: 'None identified.',
    dataAvailable: true,
    sourceRef: null,
    evidence: null,
  };
}

/** NSW-gate placeholder flag — risk data sources are NSW-only in v1. */
function nswOnlyFlag(category: RiskFlag['category']): RiskFlag {
  return {
    category,
    severity: 'informational',
    description: 'Risk data sources are NSW-only in v1.',
    dataAvailable: false,
    sourceRef: null,
    evidence: null,
  };
}

// ---------------------------------------------------------------------------
// Node
// ---------------------------------------------------------------------------

export async function fetchRisks(state: GraphState): Promise<Partial<GraphState>> {
  // Guard: no resolvedAddress
  if (!state.resolvedAddress) {
    return {
      errors: [{ code: 'PARTIAL_DATA', message: 'fetchRisks: no resolvedAddress' }],
    };
  }

  const { lat, lng, state: region } = state.resolvedAddress;

  // NSW gate — VIC/WA risk sources not yet implemented
  if (region !== 'NSW') {
    return {
      risks: [nswOnlyFlag('flood'), nswOnlyFlag('bushfire'), nswOnlyFlag('heritage')],
    };
  }

  // Resolve LGA for flood coverage disambiguation (§3 of spec). A failure here MUST
  // degrade, not crash the node: null → queryFlood's conservative branch
  // (dataAvailable:false), never a false "no flood risk".
  const lga = await resolveLga(lat, lng).catch((err: unknown) => {
    logger.warn({ err }, 'fetchRisks: LGA resolution failed; using conservative flood branch');
    return null;
  });

  // Run all three in parallel; collect results without throwing
  const [bushfireResult, heritageResult, floodResult] = await Promise.allSettled([
    queryBushfire(lat, lng),
    queryHeritage(lat, lng),
    queryFlood(lat, lng, lga),
  ]);

  // --- bushfire ---
  let bushfireFlag: RiskFlag;
  if (bushfireResult.status === 'rejected') {
    logger.warn({ err: bushfireResult.reason }, 'fetchRisks: bushfire adapter failed');
    bushfireFlag = degradeFlag('bushfire');
  } else {
    bushfireFlag = bushfireResult.value ?? noneFlag('bushfire');
  }

  // --- heritage ---
  let heritageFlag: RiskFlag;
  if (heritageResult.status === 'rejected') {
    logger.warn({ err: heritageResult.reason }, 'fetchRisks: heritage adapter failed');
    heritageFlag = degradeFlag('heritage');
  } else {
    heritageFlag = heritageResult.value ?? noneFlag('heritage');
  }

  // --- flood (always returns a flag, never null) ---
  let floodFlag: RiskFlag;
  if (floodResult.status === 'rejected') {
    logger.warn({ err: floodResult.reason }, 'fetchRisks: flood adapter failed');
    floodFlag = degradeFlag('flood');
  } else {
    floodFlag = floodResult.value;
  }

  return {
    risks: [bushfireFlag, heritageFlag, floodFlag],
  };
}
