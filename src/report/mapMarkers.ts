// src/report/mapMarkers.ts — single source of truth for map-marker styling, so
// the static-map pins (Node 13) and the report's visual pin legend (ReportDocument)
// use identical colours per category. Colours are hex WITHOUT '#' (Mapbox format);
// the legend prepends '#'. `glyph` is a Mapbox Maki icon name (verified to render).

import type { FacilityType } from '@/tools/schools/ga';

export interface MarkerStyle {
  /** Hex colour without '#'. */
  color: string;
  /** Maki glyph name for the map pin ('' = plain pin). */
  glyph: string;
  /** Legend label. */
  label: string;
}

export const SUBJECT_STYLE: MarkerStyle = { color: '1f3864', glyph: 'home', label: 'Subject property' };
export const COMP_STYLE: MarkerStyle = {
  color: '5b6573',
  glyph: '',
  label: 'Comparable sales (numbered — see prices below)',
};
export const PRIMARY_STYLE: MarkerStyle = { color: '2e8b57', glyph: 'school', label: 'Primary schools' };
export const SECONDARY_STYLE: MarkerStyle = {
  color: '2c6fb0',
  glyph: 'college',
  label: 'Secondary schools',
};
export const EARLY_ED_STYLE: MarkerStyle = {
  color: 'e08e0b',
  glyph: 'playground',
  label: 'Childcare & early education',
};
export const HOSPITAL_STYLE: MarkerStyle = {
  color: 'c0392b',
  glyph: 'hospital',
  label: 'Hospitals & medical',
};

/**
 * Map a school facility type to its marker style. Combined (P–12) folds into
 * Secondary; the generic 'school' bucket folds into Primary.
 */
export function schoolStyle(type: FacilityType): MarkerStyle {
  if (type === 'early-education') return EARLY_ED_STYLE;
  if (type === 'secondary' || type === 'combined') return SECONDARY_STYLE;
  return PRIMARY_STYLE; // 'primary' + generic 'school'
}
