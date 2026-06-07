// Report template — CLAUDE.md §13. A self-contained, print-oriented React
// document rendered to static HTML, then to PDF (Puppeteer) at §13.3. Linear-
// inspired: dense, restrained colour, single navy accent (#1F3864), tabular-nums
// for money. v0: the four core sections (summary / subject / valuation /
// comparables); charts + self-hosted fonts arrive in later sub-increments.
//
// Authored with createElement (no JSX) so it renders identically under tsx
// (dev sample script), Vitest, and the Next/Vercel build — the repo's
// tsconfig uses `jsx: preserve`, which tsx/esbuild won't transform.

import { priceChartSvg } from '@/report/charts/priceChart';
import { selectedMapComps } from '@/report/mapComps';
import {
  COMP_STYLE,
  EARLY_ED_STYLE,
  HOSPITAL_STYLE,
  PRIMARY_STYLE,
  SECONDARY_STYLE,
  SUBJECT_STYLE,
  schoolStyle,
} from '@/report/mapMarkers';
import { formatValue, renderClaim } from '@/report/renderClaim';
import type { ClaimBlock, ReportProse } from '@/schemas/claims';
import type { Comparable, RecentDA, RiskFlag, SuburbDemographics } from '@/schemas/state';
import type { StreetView, SubjectVision } from '@/schemas/vision';
import type { SuburbStats } from '@/tools/market/suburbStats';
import type { PlanningControls } from '@/tools/planning/zoning';
import type { ProximityHazards } from '@/tools/proximity/proximity';
import type { NearbyFacility, NearbyPlace } from '@/tools/schools/ga';
import { type ReactElement, createElement as h } from 'react';

export interface ReportData {
  address: string;
  suburb: string;
  state: string;
  postcode: string;
  subject: {
    beds: number;
    baths: number;
    parking: number;
    landArea: number | null;
    buildingArea: number | null;
    propertyType: string;
  };
  triangulation: {
    low: number;
    high: number;
    reconciled: number;
    confidence: 'high' | 'medium' | 'low';
    uncertaintyNote: string | null;
    bands: {
      inferiorCap: number | null;
      comparableLow: number | null;
      comparableHigh: number | null;
      superiorFloor: number | null;
    } | null;
  } | null;
  comparables: Comparable[];
  risks: RiskFlag[];
  recentDAs: RecentDA[];
  suburbStats: SuburbStats | null;
  demographics: SuburbDemographics | null;
  /** Nearby schools + early-education facilities (Geoscience Australia). */
  schools: NearbyFacility[];
  /** Nearby hospitals / medical facilities (Geoscience Australia). */
  hospitals: NearbyPlace[];
  /** Subject's residential zoning + planning overlays, or null. */
  planningControls: PlanningControls | null;
  /** Nearest transmission line + freeway, or null. */
  proximityHazards: ProximityHazards | null;
  prose: ReportProse;
  generatedAt: string; // ISO
  /** Base64 data URL for the static location map, or null when unavailable. */
  staticMapDataUrl: string | null;
  /** Interactive map URL the static map image links to, or null. */
  mapHref: string | null;
  /** Listing photo URLs (base64 data URLs after render-node download). */
  photos: string[];
  /** Floor plan image URLs (base64 data URLs after render-node download). */
  floorplans: string[];
  /** Per-comp thumbnail photos (base64 data URLs), keyed by comp id. Render node
   *  downloads a few small ones per selected comp; empty when unavailable. */
  compPhotos: Record<string, string[]>;
  /** Visual inspection result from node 04a, or null when vision was skipped/failed. */
  subjectVision: SubjectVision | null;
  /** Street-level assessment from node 04c, or null when skipped/no imagery. */
  streetView: StreetView | null;
  /** One Street View hero image (base64 data URL), downloaded by the render node. */
  streetViewImageDataUrl: string | null;
}

const ACCENT = '#1F3864';

export const reportStyles = `
  :root { --accent: ${ACCENT}; --ink: #0A0A0A; --muted: #555; --line: #E4E4E7; --bg: #FFFFFF; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 10pt; line-height: 1.45; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .num { font-variant-numeric: tabular-nums; }
  @page { size: A4; margin: 15mm 15mm 20mm 15mm; }
  .doc { max-width: 180mm; margin: 0 auto; padding: 4mm; }
  .masthead { background: var(--accent); color: #fff; padding: 18px 22px; border-radius: 6px; margin-bottom: 22px; }
  .masthead .kicker { text-transform: uppercase; letter-spacing: .14em; font-size: 7.5pt; opacity: .8; margin: 0 0 6px; }
  .masthead h1 { font-size: 17pt; margin: 0 0 4px; font-weight: 600; letter-spacing: -.01em; }
  .masthead .sub { font-size: 9.5pt; opacity: .85; margin: 0; }
  section { margin: 0 0 18px; break-inside: avoid; }
  /* Hairline divider + breathing room between consecutive sections so they read
     as cleanly separated blocks rather than running together. */
  section + section { border-top: 1px solid var(--line); padding-top: 18px; }
  h2 { font-size: 8pt; text-transform: uppercase; letter-spacing: .12em; color: var(--accent);
    border-bottom: 1.5px solid var(--accent); padding-bottom: 4px; margin: 0 0 10px;
    break-after: avoid; }
  p { margin: 0 0 8px; }
  .value-callout { border: 1px solid var(--line); border-left: 3px solid var(--accent);
    border-radius: 4px; padding: 14px 16px; margin: 0 0 12px; display: flex; align-items: baseline; gap: 14px; }
  .value-callout .amount { font-size: 19pt; font-weight: 600; color: var(--accent); letter-spacing: -.01em; }
  .value-callout .conf { font-size: 8pt; text-transform: uppercase; letter-spacing: .1em; padding: 2px 8px;
    border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
  .value-callout .conf.high { color: #1B7F4B; border-color: #1B7F4B; }
  .value-callout .conf.low { color: #C9302C; border-color: #C9302C; }
  .uncertainty { font-size: 9pt; color: #8A5A00; background: #FFF7E6; border: 1px solid #FFE3A3;
    border-radius: 4px; padding: 8px 10px; margin: 0 0 10px; }
  .chart { margin: 6px 0 12px; }
  .attrs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; margin: 4px 0 10px; }
  .attrs .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .attrs .v { font-size: 11pt; font-weight: 600; }
  .layout { margin: 2px 0 12px; }
  .layout-h { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin-bottom: 5px; }
  .layout-tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .ltag { font-size: 8.5pt; border: 1px solid var(--line); border-radius: 4px; padding: 2px 8px;
    color: var(--ink); background: #FAFAFA; }
  .layout-notes { font-size: 8.5pt; color: var(--muted); margin-top: 5px; }
  .comp { border: 1px solid var(--line); border-radius: 4px; padding: 10px 12px; margin: 0 0 8px; break-inside: avoid; }
  .comp .row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
  .comp .addr { font-weight: 600; font-size: 9.5pt; }
  .comp .price { font-weight: 600; color: var(--accent); }
  .comp .meta { font-size: 8.5pt; color: var(--muted); margin-top: 3px; }
  .badge { font-size: 7pt; text-transform: uppercase; letter-spacing: .08em; padding: 1.5px 6px;
    border-radius: 999px; border: 1px solid var(--accent); color: var(--accent); white-space: nowrap; }
  .badge.anchor { color: #8A5A00; border-color: #C99A00; }
  .badge.sev-critical { color: #C9302C; border-color: #C9302C; }
  .badge.sev-high     { color: #C9302C; border-color: #C9302C; }
  .badge.sev-medium   { color: #8A5A00; border-color: #C99A00; }
  .badge.sev-low      { color: var(--muted); border-color: var(--line); }
  .badge.sev-informational { color: var(--muted); border-color: var(--line); }
  .badges { display: inline-flex; gap: 5px; align-items: baseline; }
  .badge.verdict-superior { color: #1E6B45; border-color: #2E8B57; }
  .badge.verdict-comparable { color: var(--accent); border-color: var(--accent); }
  .badge.verdict-inferior { color: #5C636B; border-color: #9AA3AD; }
  .cmp-axes { margin-top: 7px; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 16px; }
  .cmp-axis { font-size: 8.5pt; color: var(--ink); line-height: 1.35; }
  .cmp-axis .ax { font-size: 7pt; text-transform: uppercase; letter-spacing: .07em;
    color: var(--muted); font-weight: 600; margin-right: 4px; }
  .comp-photos { display: flex; gap: 4px; margin-top: 7px; }
  .comp-photo { width: 84px; height: 56px; object-fit: cover; border-radius: 3px;
    border: 1px solid var(--line); }
  .src { font-size: 7.5pt; color: var(--muted); margin-top: 6px; }
  .src-link { color: var(--accent); text-decoration: underline; }
  .risk-row { display: flex; align-items: baseline; gap: 10px; padding: 7px 0;
    border-bottom: 1px solid var(--line); break-inside: avoid; }
  .risk-row:last-child { border-bottom: none; }
  .risk-row .risk-cat { font-size: 9pt; font-weight: 600; min-width: 90px; text-transform: capitalize; }
  .risk-row .risk-desc { font-size: 9pt; flex: 1; }
  .risk-row.unavailable .risk-cat,
  .risk-row.unavailable .risk-desc { color: var(--muted); }
  .da-row { display: flex; align-items: baseline; gap: 10px; padding: 7px 0;
    border-bottom: 1px solid var(--line); break-inside: avoid; }
  .da-row:last-child { border-bottom: none; }
  .da-row .da-dist { font-size: 8.5pt; color: var(--muted); min-width: 46px; font-variant-numeric: tabular-nums; }
  .da-row .da-date { font-size: 8.5pt; color: var(--muted); min-width: 72px; }
  .da-row .da-desc { font-size: 9pt; flex: 1; }
  .da-row.da-unavailable .da-desc { color: var(--muted); font-style: italic; }
  .schools-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin: 0 0 6px; }
  .school-group { break-inside: avoid; margin-bottom: 5px; }
  .school-group-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em;
    color: var(--accent); margin: 4px 0 2px; }
  .school-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px;
    font-size: 8.5pt; padding: 1px 0; }
  .school-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .school-dist { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .zoning-block { margin: 0 0 8px; }
  .zone-row { display: flex; gap: 10px; font-size: 9pt; padding: 2px 0; align-items: baseline; }
  .zone-label { flex: none; width: 64px; font-size: 7.5pt; text-transform: uppercase;
    letter-spacing: .08em; color: var(--muted); }
  .zone-val { flex: 1; font-weight: 600; }
  .da-overflow { font-size: 8.5pt; color: var(--muted); padding: 5px 0 0; }
  .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; margin: 4px 0 10px; }
  .stats-grid .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .stats-grid .v { font-size: 11pt; font-weight: 600; }
  .stats-unavailable { font-size: 9pt; color: var(--muted); font-style: italic; padding: 6px 0; }
  .demo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; margin: 10px 0 4px; border-top: 1px solid var(--line); padding-top: 8px; }
  .demo-grid .k { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .demo-grid .v { font-size: 11pt; font-weight: 600; }
  .demo-label { font-size: 8pt; text-transform: uppercase; letter-spacing: .1em; color: var(--accent); margin: 10px 0 4px; }
  footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid var(--line);
    font-size: 7.5pt; color: var(--muted); display: flex; justify-content: space-between; }
  .location-map { width: 100%; border-radius: 4px; border: 1px solid var(--line); display: block; margin: 0 0 8px; }
  .location-map-link { display: block; text-decoration: none; border: 0; }
  .location-map-caption { font-size: 7.5pt; color: var(--muted); margin: 0 0 6px; }
  .street-img { width: 100%; max-height: 220px; object-fit: cover; border-radius: 4px;
                border: 1px solid var(--line); display: block; margin: 0 0 8px; }
  .map-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 18px; margin: 0 0 2px; }
  .map-legend-item { display: flex; align-items: center; gap: 7px; font-size: 8.5pt; break-inside: avoid; }
  .map-legend-n { flex: none; width: 15px; height: 15px; line-height: 15px; text-align: center;
    border-radius: 50%; background: #5b6573; color: #fff; font-size: 7pt; font-weight: 600; }
  .map-legend-addr { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .map-legend-price { color: var(--accent); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .pin-legend { display: flex; flex-wrap: wrap; gap: 3px 14px; margin: 2px 0 6px; }
  .pin-legend-item { display: inline-flex; align-items: center; gap: 4px; font-size: 8pt; color: var(--ink); }
  .pin-swatch { flex: none; }
  .pin-legend-label { white-space: nowrap; }
  .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin: 0 0 12px; }
  .photo-grid img { width: 100%; height: 52mm; object-fit: cover; border-radius: 3px; border: 1px solid var(--line); display: block; }
  .condition-chip { display: inline-block; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .09em;
    padding: 2px 8px; border-radius: 999px; border: 1px solid; white-space: nowrap; margin-right: 6px; }
  .condition-chip.positive { color: #1B7F4B; border-color: #1B7F4B; }
  .condition-chip.accent { color: #8A5A00; border-color: #C99A00; }
  .condition-chip.danger { color: #C9302C; border-color: #C9302C; }
  .staging-chip { display: inline-block; font-size: 7.5pt; color: var(--muted); border: 1px solid var(--line);
    padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
  .vision-comment { font-size: 9.5pt; font-style: italic; margin: 8px 0 8px; color: var(--ink); }
  .vision-list { margin: 4px 0 8px; padding-left: 16px; }
  .vision-list li { font-size: 9pt; margin-bottom: 2px; }
  .vision-list.red-flags li { color: #C9302C; }
  .vision-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .vision-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 6px 0 2px; }
  .vision-unavailable { font-size: 9pt; color: var(--muted); font-style: italic; padding: 4px 0; }
  .floorplan-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .1em; color: var(--accent); margin: 12px 0 6px; }
  .floorplan-block { margin: 0 0 10px; }
  .floorplan-block img { width: 100%; border-radius: 3px; border: 1px solid var(--line); display: block; margin-bottom: 6px; }
`;

function paragraphs(blocks: ClaimBlock[] | undefined): ReactElement[] {
  return (blocks ?? [])
    .filter((b) => b.type !== 'range') // range shown in the value callout
    .map((b, i) => h('p', { key: `b${i}` }, renderClaim(b)));
}

function attr(label: string, value: string): ReactElement {
  return h(
    'div',
    { key: label },
    h('div', { className: 'k' }, label),
    h('div', { className: 'v num' }, value),
  );
}

// Human-readable labels for the frozen layout enums. Keys that should not show
// (e.g. 'unknown', 'not-applicable') are simply omitted from the maps.
const STOREYS_LABEL: Record<string, string> = {
  single: 'Single storey',
  double: 'Double storey',
  'split-level': 'Split level',
  multi: 'Multi-level',
};
const STRUCTURE_LABEL: Record<string, string> = {
  'free-standing': 'Free-standing',
  'semi-detached': 'Semi-detached',
  terraced: 'Terraced / row',
  'attached-unit': 'Attached unit',
};
const POSITION_LABEL: Record<string, string> = {
  front: 'Front of block',
  rear: 'Rear of block',
  middle: 'Middle of block',
  'ground-floor': 'Ground floor',
  'upper-floor': 'Upper floor',
};
const FRONTAGE_LABEL: Record<string, string> = {
  'own-frontage': 'Own street frontage',
  'shared-driveway': 'Shared driveway',
  'battle-axe': 'Battle-axe block',
};
const ERA_LABEL: Record<string, string> = {
  'period-pre-1945': 'Period (pre-1945)',
  'mid-century': 'Mid-century',
  'late-20th-century': 'Late 20th century',
  contemporary: 'Contemporary',
  'new-build': 'New build',
};

// "Layout & configuration" block in the Subject section — granular structural
// facts read by vision (storeys, shared walls, position in block, single-level
// living, era). Renders only known facts; returns null when nothing is known.
function renderSubjectLayout(
  layout: SubjectVision['layout'] | null | undefined,
): ReactElement | null {
  if (!layout) return null;
  const facts: string[] = [];
  const pushLabel = (map: Record<string, string>, key: string) => {
    const v = map[key];
    if (v) facts.push(v);
  };
  pushLabel(STOREYS_LABEL, layout.storeys);
  pushLabel(STRUCTURE_LABEL, layout.structure);
  pushLabel(POSITION_LABEL, layout.positionInComplex);
  if (layout.singleLevelLiving === true) facts.push('Single-level living');
  pushLabel(FRONTAGE_LABEL, layout.streetFrontage);
  pushLabel(ERA_LABEL, layout.era);
  const notes = layout.configNotes ?? [];
  if (facts.length === 0 && notes.length === 0) return null;

  return h(
    'div',
    { className: 'layout', key: 'layout' },
    h('div', { className: 'layout-h' }, 'Layout & configuration'),
    h(
      'div',
      { className: 'layout-tags' },
      ...facts.map((f, i) => h('span', { className: 'ltag', key: i }, f)),
    ),
    notes.length > 0 ? h('div', { className: 'layout-notes' }, notes.join(' · ')) : null,
  );
}

function severityClass(sev: RiskFlag['severity']): string {
  return `sev-${sev}`;
}

function riskRow(flag: RiskFlag): ReactElement {
  const rowClass = `risk-row${flag.dataAvailable ? '' : ' unavailable'}`;
  const chipLabel = flag.dataAvailable ? flag.severity : 'data unavailable';
  const chipClass = `badge ${flag.dataAvailable ? severityClass(flag.severity) : 'sev-low'}`;
  return h(
    'div',
    { key: flag.category, className: rowClass },
    h('span', { className: 'risk-cat' }, flag.category),
    h('span', { className: chipClass }, chipLabel),
    h('span', { className: 'risk-desc' }, flag.description),
  );
}

const DA_DISPLAY_MAX = 10;

function daRow(da: RecentDA, index: number): ReactElement {
  const distLabel = `${Math.round(da.distanceM)} m`;
  const dateLabel = da.lodgedDate ?? '—';
  // Truncate very long descriptions (> 120 chars)
  const descText =
    da.description.length > 120 ? `${da.description.slice(0, 117)}…` : da.description;
  const chipClass = 'badge sev-low';
  return h(
    'div',
    { key: `da-${index}`, className: 'da-row' },
    h('span', { className: 'da-dist' }, distLabel),
    h('span', { className: 'da-date' }, dateLabel),
    h('span', { className: 'da-desc' }, descText),
    da.status != null ? h('span', { className: chipClass }, da.status) : null,
  );
}

function statCell(label: string, value: string): ReactElement {
  return h(
    'div',
    { key: label },
    h('div', { className: 'k' }, label),
    h('div', { className: 'v num' }, value),
  );
}

function demoCell(label: string, value: string): ReactElement {
  return h(
    'div',
    { key: label },
    h('div', { className: 'k' }, label),
    h('div', { className: 'v num' }, value),
  );
}

function renderDemographicsBlock(demo: SuburbDemographics): ReactElement {
  const cells: (ReactElement | null)[] = [
    demo.population !== null
      ? demoCell('Population', demo.population.toLocaleString('en-AU'))
      : null,
    demo.medianAge !== null ? demoCell('Median age', String(demo.medianAge)) : null,
    demo.medianHouseholdIncomeWeekly !== null
      ? demoCell(
          'Median household income',
          `${formatValue(demo.medianHouseholdIncomeWeekly, 'currency-aud')}/wk`,
        )
      : null,
    demo.seifaIrsadDecile !== null
      ? demoCell('Socio-economic (SEIFA)', `${demo.seifaIrsadDecile}/10`)
      : null,
    demo.ownerOccupiedPct !== null ? demoCell('Owner-occupied', `${demo.ownerOccupiedPct}%`) : null,
    demo.rentedPct !== null ? demoCell('Renter-occupied (investor)', `${demo.rentedPct}%`) : null,
    demo.ownedWithMortgagePct !== null
      ? demoCell('Owned with mortgage', `${demo.ownedWithMortgagePct}%`)
      : null,
    demo.socialHousingPct !== null
      ? demoCell('Social / public housing', `${demo.socialHousingPct}%`)
      : null,
    demo.medianRentWeekly !== null
      ? demoCell('Median rent', `${formatValue(demo.medianRentWeekly, 'currency-aud')}/wk`)
      : null,
    demo.medianMortgageMonthly !== null
      ? demoCell('Median mortgage', `${formatValue(demo.medianMortgageMonthly, 'currency-aud')}/mo`)
      : null,
    demo.avgHouseholdSize !== null
      ? demoCell('Avg household size', String(demo.avgHouseholdSize))
      : null,
  ].filter((el): el is ReactElement => el !== null);

  if (cells.length === 0) return h('span', { key: 'demo-empty' });

  return h(
    'div',
    { key: 'demo-block' },
    h(
      'div',
      { className: 'demo-label' },
      `SA2 Demographics · ${demo.sa2Name} · ${demo.censusYear} Census`,
    ),
    h('div', { className: 'demo-grid' }, ...cells),
  );
}

const PHOTO_DISPLAY_MAX = 6;

/**
 * Condition chip colour class — CLAUDE.md §7.4 frozen enums:
 *   excellent/good → positive (green)
 *   fair           → accent  (amber)
 *   poor/unliveable → danger (red)
 */
function conditionChipClass(condition: SubjectVision['condition']): string {
  if (condition === 'excellent' || condition === 'good') return 'positive';
  if (condition === 'fair') return 'accent';
  return 'danger';
}

/**
 * Renders the "Property condition & visual inspection" section.
 * Returns null when photos, floorplans, and subjectVision are all absent.
 */
function renderVisualInspection(
  photos: string[],
  floorplans: string[],
  vision: SubjectVision | null,
): ReactElement | null {
  const displayPhotos = photos.slice(0, PHOTO_DISPLAY_MAX);
  const hasPhotos = displayPhotos.length > 0;
  const hasFloorplans = floorplans.length > 0;

  // Whole section omitted when nothing to show.
  if (!hasPhotos && !hasFloorplans && vision === null) return null;

  const children: ReactElement[] = [
    h('h2', { key: 'h' }, 'Property condition & visual inspection'),
  ];

  // Photo grid
  if (hasPhotos) {
    children.push(
      h(
        'div',
        { key: 'grid', className: 'photo-grid' },
        ...displayPhotos.map((src, i) =>
          h('img', {
            key: `photo-${i}`,
            src,
            alt: `Listing photo ${i + 1}`,
          }),
        ),
      ),
    );
  }

  // Vision block
  if (vision !== null) {
    // Meta row: condition chip + staging chip
    children.push(
      h(
        'div',
        { key: 'meta', className: 'vision-meta' },
        h(
          'span',
          { className: `condition-chip ${conditionChipClass(vision.condition)}` },
          vision.condition,
        ),
        h('span', { className: 'staging-chip' }, vision.staging.replace(/-/g, ' ')),
      ),
    );

    // Comment
    children.push(h('p', { key: 'comment', className: 'vision-comment' }, `"${vision.comment}"`));

    // Presentation factors
    if (vision.presentationFactors.length > 0) {
      children.push(h('div', { key: 'pfl', className: 'vision-label' }, 'Presentation'));
      children.push(
        h(
          'ul',
          { key: 'pf', className: 'vision-list' },
          ...vision.presentationFactors.map((f, i) => h('li', { key: `pf-${i}` }, f)),
        ),
      );
    }

    // Red flags
    if (vision.redFlags.length > 0) {
      children.push(h('div', { key: 'rfl', className: 'vision-label' }, 'Red flags'));
      children.push(
        h(
          'ul',
          { key: 'rf', className: 'vision-list red-flags' },
          ...vision.redFlags.map((f, i) => h('li', { key: `rf-${i}` }, f)),
        ),
      );
    }
  } else if (hasPhotos) {
    // Photos present but vision skipped/failed
    children.push(
      h(
        'p',
        { key: 'unavail', className: 'vision-unavailable' },
        'Automated visual inspection unavailable.',
      ),
    );
  }

  // Floor plan block — always shown when floor plans are available, distinct from the photo grid.
  if (hasFloorplans) {
    children.push(h('div', { key: 'fp-label', className: 'floorplan-label' }, 'Floor plan'));
    children.push(
      h(
        'div',
        { key: 'fp-block', className: 'floorplan-block' },
        ...floorplans.map((src, i) =>
          h('img', {
            key: `fp-${i}`,
            src,
            alt: `Floor plan ${i + 1}`,
          }),
        ),
      ),
    );
  }

  return h('section', { key: 'visual-inspection' }, ...children);
}

function renderSuburbMarket(
  stats: SuburbStats | null,
  blocks: ClaimBlock[] | undefined,
  demographics: SuburbDemographics | null,
): ReactElement {
  const children: ReactElement[] = [h('h2', { key: 'h' }, 'Suburb market')];
  children.push(...paragraphs(blocks));

  if (stats === null) {
    children.push(
      h(
        'div',
        { key: 'unavailable', className: 'stats-unavailable' },
        'Not enough recent comparable sales to summarise the suburb market.',
      ),
    );
  } else {
    children.push(
      h(
        'div',
        { key: 'grid', className: 'stats-grid' },
        statCell('Sample size', String(stats.sampleSize)),
        statCell('Median sale price', formatValue(stats.medianSalePrice, 'currency-aud')),
        statCell(
          'Price range',
          `${formatValue(stats.minSalePrice, 'currency-aud')} – ${formatValue(stats.maxSalePrice, 'currency-aud')}`,
        ),
        stats.medianBeds !== null ? statCell('Median beds', String(stats.medianBeds)) : null,
        stats.medianBaths !== null ? statCell('Median baths', String(stats.medianBaths)) : null,
        stats.mostRecentSaleDate !== null
          ? statCell('Most recent sale', formatValue(stats.mostRecentSaleDate, 'date'))
          : null,
      ),
    );
  }

  // Demographics block — only when data is available
  if (demographics !== null) {
    children.push(renderDemographicsBlock(demographics));
  }

  return h('section', { key: 'market' }, ...children);
}

// GA facility names are ALL-CAPS with duplicated " - " campus segments; tidy them.
function cleanFacilityName(raw: string): string {
  const segs = raw.split(/\s+-\s+/).map((s) => s.trim());
  const deduped = segs.filter((s, i) => segs.indexOf(s) === i);
  return deduped
    .map((s) => s.toLowerCase().replace(/\b([a-z])/g, (_m, c: string) => c.toUpperCase()))
    .join(' – ');
}

const SCHOOL_GROUPS: { type: NearbyFacility['type']; label: string; cap: number }[] = [
  { type: 'primary', label: 'Primary', cap: 4 },
  { type: 'secondary', label: 'Secondary', cap: 4 },
  { type: 'combined', label: 'Combined (P–12)', cap: 3 },
  { type: 'early-education', label: 'Early education', cap: 4 },
  { type: 'school', label: 'Other schools', cap: 3 },
];

// Render one labelled group of place-rows (name + straight-line distance).
function schoolGroup(
  key: string,
  label: string,
  items: { name: string; distanceM: number }[],
): ReactElement | null {
  if (!items.length) return null;
  return h(
    'div',
    { key, className: 'school-group' },
    h('div', { className: 'school-group-label' }, label),
    ...items.map((s, i) =>
      h(
        'div',
        { key: `${key}-${i}`, className: 'school-row' },
        h('span', { className: 'school-name' }, cleanFacilityName(s.name)),
        h('span', { className: 'school-dist num' }, formatValue(s.distanceM, 'distance-m')),
      ),
    ),
  );
}

/**
 * "Schools & hospitals" section — nearest schools (grouped by type) + nearest
 * hospitals/medical, with straight-line distance. Returns null when nothing
 * nearby is available.
 */
function renderSchools(schools: NearbyFacility[], hospitals: NearbyPlace[]): ReactElement | null {
  if (!schools.length && !hospitals.length) return null;

  const groups = SCHOOL_GROUPS.map(({ type, label, cap }) =>
    schoolGroup(type, label, schools.filter((s) => s.type === type).slice(0, cap)),
  );
  // Hospitals last — GA's "Hospital" class is broad (incl. clinics/imaging), so
  // label it "Hospitals & medical" and show the nearest few.
  groups.push(schoolGroup('hospitals', 'Hospitals & medical', hospitals.slice(0, 5)));

  return h(
    'section',
    { key: 'schools' },
    h('h2', null, hospitals.length ? 'Schools & hospitals' : 'Schools & early education'),
    h('div', { className: 'schools-grid' }, ...groups.filter(Boolean)),
    h(
      'p',
      { className: 'src' },
      'Source: Geoscience Australia (Education + Health facilities), straight-line distance. Early-education coverage is indicative — check the ACECQA national register for the complete childcare list.',
    ),
  );
}

// A small teardrop pin swatch (colour matches the map marker) for the legend.
function pinSwatch(color: string): ReactElement {
  return h(
    'svg',
    { className: 'pin-swatch', viewBox: '0 0 16 22', width: 12, height: 17 },
    h('path', {
      d: 'M8 0C3.58 0 0 3.58 0 8c0 5.4 8 14 8 14s8-8.6 8-14C16 3.58 12.42 0 8 0z',
      fill: `#${color}`,
    }),
    h('circle', { cx: 8, cy: 8, r: 3, fill: '#ffffff' }),
  );
}

function pinLegendItem(color: string, label: string): ReactElement {
  return h(
    'span',
    { key: label, className: 'pin-legend-item' },
    pinSwatch(color),
    h('span', { className: 'pin-legend-label' }, label),
  );
}

/**
 * Visual key for the map pins — a pin swatch + label per present category, so
 * the reader can tell primary / secondary / childcare / hospital apart (rather
 * than a sentence). Subject (home pin) and numbered comps are always shown.
 */
function renderPinLegend(
  schools: NearbyFacility[],
  hospitals: NearbyPlace[],
  hasComps: boolean,
): ReactElement {
  const items: ReactElement[] = [pinLegendItem(SUBJECT_STYLE.color, SUBJECT_STYLE.label)];
  if (hasComps) items.push(pinLegendItem(COMP_STYLE.color, COMP_STYLE.label));
  for (const st of [PRIMARY_STYLE, SECONDARY_STYLE, EARLY_ED_STYLE]) {
    if (schools.some((s) => schoolStyle(s.type) === st)) {
      items.push(pinLegendItem(st.color, st.label));
    }
  }
  if (hospitals.length) items.push(pinLegendItem(HOSPITAL_STYLE.color, HOSPITAL_STYLE.label));
  return h('div', { className: 'pin-legend' }, ...items);
}

/**
 * "Proximity & infrastructure" — nearest high-voltage transmission line + freeway
 * (negative-externality proximity). Returns null when neither is nearby.
 */
function renderProximity(p: ProximityHazards | null): ReactElement | null {
  if (!p || (!p.transmissionLine && !p.freeway)) return null;
  const rows: ReactElement[] = [];
  if (p.transmissionLine) {
    rows.push(
      h(
        'div',
        { key: 'tx', className: 'zone-row' },
        h('span', { className: 'zone-label' }, 'Power line'),
        h(
          'span',
          { className: 'zone-val' },
          `${p.transmissionLine.label} — ${formatValue(p.transmissionLine.distanceM, 'distance-m')} away`,
        ),
      ),
    );
  }
  if (p.freeway) {
    rows.push(
      h(
        'div',
        { key: 'fw', className: 'zone-row' },
        h('span', { className: 'zone-label' }, 'Freeway'),
        h(
          'span',
          { className: 'zone-val' },
          `${p.freeway.label} — ${formatValue(p.freeway.distanceM, 'distance-m')} away`,
        ),
      ),
    );
  }
  return h(
    'section',
    { key: 'proximity' },
    h('h2', null, 'Proximity & infrastructure'),
    h('div', { className: 'zoning-block' }, ...rows),
    h(
      'p',
      { className: 'src' },
      'Nearest high-voltage transmission line (Geoscience Australia) and freeway (OpenStreetMap); straight-line distance.',
    ),
  );
}

const STREET_CHARACTER_LABEL: Record<string, string> = {
  'leafy-residential': 'Leafy residential',
  arterial: 'Arterial road',
  'commercial-frontage': 'Commercial frontage',
  'industrial-adjacent': 'Industrial adjacent',
  mixed: 'Mixed residential / other',
};
const TREE_COVER_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' };

// "Street-level assessment" section (Node 04c). A hero Street View image plus a
// structured read of the street itself (character, through-traffic, canopy) and
// any visible concerns. Returns null when no assessment AND no image are present.
function renderStreetView(sv: StreetView | null, imageDataUrl: string | null): ReactElement | null {
  if (!sv && !imageDataUrl) return null;

  const children: ReactElement[] = [h('h2', { key: 'h' }, 'Street-level assessment')];

  if (imageDataUrl) {
    children.push(
      h('img', {
        key: 'img',
        src: imageDataUrl,
        alt: 'Street View of the street outside the subject property',
        className: 'street-img',
      }),
    );
  }

  if (sv) {
    const rows: ReactElement[] = [];
    const character = STREET_CHARACTER_LABEL[sv.streetCharacter];
    if (character) {
      rows.push(
        h(
          'div',
          { key: 'char', className: 'zone-row' },
          h('span', { className: 'zone-label' }, 'Street'),
          h('span', { className: 'zone-val' }, character),
        ),
      );
    }
    rows.push(
      h(
        'div',
        { key: 'traffic', className: 'zone-row' },
        h('span', { className: 'zone-label' }, 'Through-traffic'),
        h(
          'span',
          { className: 'zone-val' },
          sv.busyRoad ? 'Busy / arterial — through-traffic likely' : 'Quiet local street',
        ),
      ),
    );
    rows.push(
      h(
        'div',
        { key: 'trees', className: 'zone-row' },
        h('span', { className: 'zone-label' }, 'Tree cover'),
        h('span', { className: 'zone-val' }, TREE_COVER_LABEL[sv.treeCover] ?? sv.treeCover),
      ),
    );
    if (sv.neighbouringConcerns.length > 0) {
      rows.push(
        h(
          'div',
          { key: 'concerns', className: 'zone-row' },
          h('span', { className: 'zone-label' }, 'Noted'),
          h('span', { className: 'zone-val' }, sv.neighbouringConcerns.join('; ')),
        ),
      );
    }
    children.push(h('div', { key: 'rows', className: 'zoning-block' }, ...rows));
  }

  children.push(
    h(
      'p',
      { className: 'src', key: 'src' },
      'Google Street View imagery, assessed at four kerb-side headings. A visual aid only — verify on an in-person inspection.',
    ),
  );

  return h('section', { key: 'street' }, ...children);
}

export function ReportDocument({ data }: { data: ReportData }): ReactElement {
  const {
    subject,
    triangulation,
    prose,
    comparables,
    risks,
    recentDAs,
    suburbStats,
    demographics,
    schools,
    hospitals,
    planningControls,
    proximityHazards,
    staticMapDataUrl: mapDataUrl,
    mapHref,
    photos,
    floorplans,
    compPhotos,
    subjectVision,
    streetView: streetViewAssessment,
    streetViewImageDataUrl,
  } = data;
  const selected = comparables.filter(
    (c) => c.selection === 'fair-value' || c.selection === 'negotiation-anchor',
  );
  // The banded scatter plots the WHOLE verdict-classified pool (inferior +
  // comparable + superior), not just the selected few, so the bands read.
  // Falls back to the selected comps when no verdict is present (degraded run).
  const verdictComps = comparables.filter((c) => c.verdict != null);
  const chartComps = verdictComps.length > 0 ? verdictComps : selected;

  const masthead = h(
    'div',
    { className: 'masthead' },
    h('p', { className: 'kicker' }, 'Property Research Dossier'),
    h('h1', null, data.address),
    h(
      'p',
      { className: 'sub num' },
      `${data.suburb} ${data.state} ${data.postcode} · Generated ${formatValue(data.generatedAt, 'date')}`,
    ),
  );

  const summary = h(
    'section',
    { key: 'summary' },
    h('h2', null, 'Summary'),
    ...paragraphs(prose.summary),
  );

  const subjectSection = h(
    'section',
    { key: 'subject' },
    h('h2', null, 'Subject property'),
    h(
      'div',
      { className: 'attrs' },
      attr('Type', subject.propertyType),
      attr('Bedrooms', String(subject.beds)),
      attr('Bathrooms', String(subject.baths)),
      attr('Parking', String(subject.parking)),
      attr('Land', subject.landArea != null ? `${subject.landArea} m²` : '—'),
      attr('Building', subject.buildingArea != null ? `${subject.buildingArea} m²` : '—'),
    ),
    renderSubjectLayout(subjectVision?.layout),
    ...paragraphs(prose.subject),
  );

  const valuationChildren: ReactElement[] = [h('h2', { key: 'h' }, 'Valuation')];
  if (triangulation) {
    valuationChildren.push(
      h(
        'div',
        { key: 'callout', className: 'value-callout' },
        h(
          'span',
          { className: 'amount num' },
          `${formatValue(triangulation.low, 'currency-aud')} – ${formatValue(triangulation.high, 'currency-aud')}`,
        ),
        h(
          'span',
          { className: `conf ${triangulation.confidence}` },
          `${triangulation.confidence} confidence`,
        ),
      ),
    );
    if (triangulation.uncertaintyNote) {
      valuationChildren.push(
        h('p', { key: 'unc', className: 'uncertainty' }, triangulation.uncertaintyNote),
      );
    }
    if (chartComps.length > 0) {
      valuationChildren.push(
        h('div', {
          key: 'chart',
          className: 'chart',
          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SSR'd SVG from priceChartSvg() — built only from numbers + hard-coded literals, no user HTML; React has no other way to inline raw SVG.
          dangerouslySetInnerHTML: {
            __html: priceChartSvg({
              low: triangulation.low,
              high: triangulation.high,
              reconciled: triangulation.reconciled,
              bands: triangulation.bands,
              comps: chartComps.map((c) => ({
                label: c.address,
                price: c.salePrice,
                selection:
                  c.selection === 'negotiation-anchor' ? 'negotiation-anchor' : 'fair-value',
                verdict: c.verdict,
              })),
            }),
          },
        }),
      );
    }
  }
  valuationChildren.push(...paragraphs(prose.valuation));
  const valuation = h('section', { key: 'valuation' }, ...valuationChildren);

  const axisRow = (label: string, text: string, key: string) =>
    h('div', { className: 'cmp-axis', key }, h('span', { className: 'ax' }, label), ' ', text);

  const compCards = selected.map((c) => {
    const children: ReactElement[] = [
      h(
        'div',
        { className: 'row', key: 'r1' },
        h('span', { className: 'addr' }, c.address),
        h('span', { className: 'price num' }, formatValue(c.salePrice, 'currency-aud')),
      ),
      h(
        'div',
        { className: 'row', key: 'r2' },
        h(
          'span',
          { className: 'meta num' },
          `${formatValue(c.contractDate, 'date')} · ${c.beds} bd / ${c.baths} ba · ${c.propertyType} · ${formatValue(c.distanceM, 'distance-m')} away${c.adjustedValue != null ? ` · adjusted ${formatValue(c.adjustedValue, 'currency-aud')}` : ''}`,
        ),
        h(
          'span',
          { className: 'badges' },
          c.verdict
            ? h('span', { className: `badge verdict-${c.verdict}`, key: 'v' }, c.verdict)
            : null,
          h(
            'span',
            {
              className: `badge ${c.selection === 'negotiation-anchor' ? 'anchor' : ''}`,
              key: 's',
            },
            c.selection === 'negotiation-anchor' ? 'anchor' : 'fair value',
          ),
        ),
      ),
    ];
    const cPhotos = compPhotos[c.id] ?? [];
    if (cPhotos.length > 0) {
      children.push(
        h(
          'div',
          { className: 'comp-photos', key: 'photos' },
          ...cPhotos.map((u, i) => h('img', { key: i, className: 'comp-photo', src: u, alt: '' })),
        ),
      );
    }
    if (c.comparison) {
      children.push(
        h(
          'div',
          { className: 'cmp-axes', key: 'cmp' },
          axisRow('Size', c.comparison.size, 'size'),
          axisRow('Layout', c.comparison.layout, 'layout'),
          axisRow('Condition', c.comparison.condition, 'condition'),
          axisRow('Location', c.comparison.location, 'location'),
        ),
      );
    }
    children.push(
      h(
        'div',
        { className: 'src', key: 'src' },
        'Source: ',
        c.listingUrl
          ? h(
              'a',
              { href: c.listingUrl, target: '_blank', rel: 'noreferrer', className: 'src-link' },
              'realestate.com.au',
            )
          : 'realestate.com.au',
      ),
    );
    return h('div', { key: c.id, className: 'comp' }, ...children);
  });
  const comparablesSection = h(
    'section',
    { key: 'comparables' },
    h('h2', null, `Comparable sales (${selected.length})`),
    ...paragraphs(prose.comparables),
    ...compCards,
  );

  const marketSection = renderSuburbMarket(suburbStats, prose.market, demographics);
  const schoolsSection = renderSchools(schools, hospitals);
  const proximitySection = renderProximity(proximityHazards);

  const riskSection = h(
    'section',
    { key: 'risks' },
    h('h2', null, 'Risk register'),
    ...paragraphs(prose.risks),
    ...risks.map(riskRow),
  );

  const displayDAs = recentDAs.slice(0, DA_DISPLAY_MAX);
  const overflowCount = recentDAs.length - displayDAs.length;
  const planningChildren: ReactElement[] = [h('h2', { key: 'ph' }, 'Planning & zoning')];
  // Zoning + overlays block (from fetchZoning), above the DA prose.
  if (planningControls && (planningControls.zoneCode || planningControls.overlays.length > 0)) {
    const pc = planningControls;
    const zoneRows: ReactElement[] = [];
    if (pc.zoneCode) {
      zoneRows.push(
        h(
          'div',
          { key: 'zone', className: 'zone-row' },
          h('span', { className: 'zone-label' }, 'Zone'),
          h(
            'span',
            { className: 'zone-val' },
            pc.zoneDescription
              ? `${pc.zoneCode} — ${cleanFacilityName(pc.zoneDescription)}`
              : pc.zoneCode,
          ),
        ),
      );
    }
    if (pc.overlays.length > 0) {
      zoneRows.push(
        h(
          'div',
          { key: 'overlays', className: 'zone-row' },
          h('span', { className: 'zone-label' }, 'Overlays'),
          h(
            'span',
            { className: 'zone-val' },
            pc.overlays
              .map((o) =>
                o.description && o.description !== o.code
                  ? `${o.code} (${cleanFacilityName(o.description)})`
                  : o.code,
              )
              .join('; '),
          ),
        ),
      );
    }
    planningChildren.push(h('div', { key: 'zoning', className: 'zoning-block' }, ...zoneRows));
  }
  planningChildren.push(...paragraphs(prose.planning));
  if (recentDAs.length === 0) {
    planningChildren.push(
      h(
        'div',
        { key: 'da-empty', className: 'da-row da-unavailable' },
        h(
          'span',
          { className: 'da-desc' },
          'No recent development applications found nearby, or planning data was unavailable for this council.',
        ),
      ),
    );
  } else {
    planningChildren.push(...displayDAs.map((da, i) => daRow(da, i)));
    if (overflowCount > 0) {
      planningChildren.push(
        h(
          'div',
          { key: 'da-overflow', className: 'da-overflow' },
          `+${overflowCount} more applications nearby`,
        ),
      );
    }
  }
  const planningSection = h('section', { key: 'planning' }, ...planningChildren);

  const footer = h(
    'footer',
    null,
    h('span', null, 'Personal property research'),
    h('span', { className: 'num' }, formatValue(data.generatedAt, 'date')),
  );

  // Location map section — only rendered when the data URL is present. When an
  // interactive map URL is available, the image is wrapped in a link annotation
  // (Chromium's print-to-PDF turns <a href> into a clickable PDF link) so the
  // reader can open a live, zoomable map at the property.
  const mapImage = h('img', {
    src: mapDataUrl ?? undefined,
    alt: 'Location map showing subject property and comparable sales',
    className: 'location-map',
  });
  // Numbered price legend, keyed to the numbered comp pins on the map (both use
  // selectedMapComps, so pin "3" === legend row "3"). Surfaces each comp's sale
  // price right next to its dot.
  const legendComps = selectedMapComps(comparables);
  const mapLegend =
    legendComps.length > 0
      ? h(
          'div',
          { className: 'map-legend' },
          ...legendComps.map((c, i) =>
            h(
              'div',
              { key: c.id, className: 'map-legend-item' },
              h('span', { className: 'map-legend-n num' }, String(i + 1)),
              h(
                'span',
                { className: 'map-legend-addr' },
                (c.address.split(',')[0] ?? c.address).trim(),
              ),
              h(
                'span',
                { className: 'map-legend-price num' },
                formatValue(c.salePrice, 'currency-aud'),
              ),
            ),
          ),
        )
      : null;

  const locationSection =
    mapDataUrl != null
      ? h(
          'section',
          { key: 'location' },
          h('h2', null, 'Location'),
          mapHref
            ? h(
                'a',
                {
                  href: mapHref,
                  target: '_blank',
                  rel: 'noreferrer',
                  className: 'location-map-link',
                },
                mapImage,
              )
            : mapImage,
          renderPinLegend(schools, hospitals, legendComps.length > 0),
          mapLegend,
          mapHref
            ? h(
                'p',
                { className: 'location-map-caption' },
                'Click the map to open it interactively (satellite, Street View, directions).',
              )
            : null,
        )
      : null;

  const visualInspectionSection = renderVisualInspection(photos, floorplans, subjectVision);
  const streetSection = renderStreetView(streetViewAssessment, streetViewImageDataUrl);

  return h(
    'div',
    { className: 'doc' },
    masthead,
    summary,
    subjectSection,
    locationSection,
    streetSection,
    schoolsSection,
    proximitySection,
    visualInspectionSection,
    valuation,
    comparablesSection,
    marketSection,
    riskSection,
    planningSection,
    footer,
  );
}
