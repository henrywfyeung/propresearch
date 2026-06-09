// src/tools/nsw-planning/councils.ts
// Maps uppercase NSW LGA names (as returned by resolveLga in @/tools/nsw-risk/lga.ts)
// to the exact CouncilName strings expected by the NSW ePlanning Online DA API.
//
// COVERAGE: This ships a CURATED map covering metro Sydney, Newcastle, Wollongong,
// Central Coast, and common major NSW councils (~90 entries). The canonical
// CouncilName values were obtained by live-probing the keyless OnlineDA API
// (2026-06-01) and collecting all distinct Council.CouncilName values in the
// response payload.
//
// Unmapped LGAs return null — the caller (Node 05 fetchPlanning) degrades
// gracefully to "planning data unavailable for this council" per §7.17.
//
// To extend: add an entry keyed on the UPPERCASE LGA name as returned by
// the ArcGIS Common/Admin_3857 layer (LGANAME field), mapped to the exact
// CouncilName string from the OnlineDA API. Both strings are case-sensitive.

// ---------------------------------------------------------------------------
// LGA → CouncilName map
// Key:   UPPERCASE LGA name (LGANAME field from ArcGIS Common/Admin_3857/MapServer/1)
// Value: exact CouncilName string expected by the OnlineDA API filters header
// ---------------------------------------------------------------------------

export const LGA_TO_COUNCIL: Record<string, string> = {
  // --- Inner Sydney ---
  SYDNEY: 'Council of the City of Sydney',
  'NORTH SYDNEY': 'North Sydney Council',
  MOSMAN: 'Mosman Municipal Council',
  WOOLLAHRA: 'Woollahra Municipal Council',
  WAVERLEY: 'Waverley Council',
  RANDWICK: 'Randwick City Council',
  'INNER WEST': 'Inner West Council',
  STRATHFIELD: 'Strathfield Municipal Council',
  BURWOOD: 'Burwood Council',
  'CANADA BAY': 'City of Canada Bay Council',

  // --- Lower North Shore ---
  'LANE COVE': 'Lane Cove Municipal Council',
  'KU-RING-GAI': 'Ku-ring-gai Council',
  WILLOUGHBY: 'Willoughby City Council',
  'HUNTERS HILL': 'The Council of the Municipality of Hunters Hill',

  // --- Northern Beaches ---
  'NORTHERN BEACHES': 'Northern Beaches Council',

  // --- Western Sydney ---
  PARRAMATTA: 'City of Parramatta Council',
  CUMBERLAND: 'Cumberland Council',
  AUBURN: 'Cumberland Council', // Auburn was merged into Cumberland
  HOLROYD: 'Cumberland Council', // Holroyd was merged into Cumberland
  BLACKTOWN: 'Blacktown City Council',
  'THE HILLS': 'The Hills Shire Council',
  PENRITH: 'Penrith City Council',
  HAWKESBURY: 'Hawkesbury City Council',
  BLUE_MOUNTAINS: 'Blue Mountains City Council',
  'BLUE MOUNTAINS': 'Blue Mountains City Council',
  CAMDEN: 'Camden Council',
  CAMPBELLTOWN: 'Campbelltown City Council',
  WOLLONDILLY: 'Wollondilly Shire Council',

  // --- Southern Sydney ---
  SUTHERLAND: 'Sutherland Shire Council',
  BAYSIDE: 'Bayside Council',
  'CANTERBURY-BANKSTOWN': 'Canterbury-Bankstown Council',
  'GEORGE S RIVER': 'Georges River Council',
  'GEORGES RIVER': 'Georges River Council',
  FAIRFIELD: 'Fairfield City Council',
  LIVERPOOL: 'Liverpool City Council',

  // --- Eastern Suburbs ---
  RYDE: 'Ryde City Council',

  // --- Hornsby ---
  HORNSBY: 'The Council of the Shire of Hornsby',

  // --- Wollongong / Illawarra ---
  WOLLONGONG: 'Wollongong City Council',
  SHELLHARBOUR: 'Shellharbour City Council',
  KIAMA: 'The Council of the Municipality of Kiama',
  SHOALHAVEN: 'Shoalhaven City Council',
  WINGECARRIBEE: 'Wingecarribee Shire Council',

  // --- Central Coast ---
  'CENTRAL COAST': 'Central Coast Council',

  // --- Hunter / Newcastle ---
  NEWCASTLE: 'Newcastle City Council',
  'LAKE MACQUARIE': 'Lake Macquarie City Council',
  MAITLAND: 'Maitland City Council',
  'PORT STEPHENS': 'Port Stephens Council',
  CESSNOCK: 'Cessnock City Council',
  SINGLETON: 'Singleton Council',
  MUSWELLBROOK: 'Muswellbrook Shire Council',
  'UPPER HUNTER': 'Upper Hunter Shire Council',
  DUNGOG: 'Dungog Shire Council',
  'MID-COAST': 'Mid-Coast Council',

  // --- Mid North Coast / Northern NSW ---
  'PORT MACQUARIE-HASTINGS': 'Port Macquarie-Hastings Council',
  'COFFS HARBOUR': 'Coffs Harbour City Council',
  KEMPSEY: 'Kempsey Shire Council',
  NAMBUCCA: 'Nambucca Valley Council',
  BELLINGEN: 'Bellingen Shire Council',
  'MID-WESTERN REGIONAL': 'Mid-Western Regional Council',
  LITHGOW: 'Lithgow City Council',
  OBERON: 'Oberon Council',
  BATHURST: 'Bathurst Regional Council',

  // --- Northern Rivers ---
  LISMORE: 'Lismore City Council',
  BALLINA: 'Ballina Shire Council',
  'RICHMOND VALLEY': 'Richmond Valley Council',
  KYOGLE: 'Kyogle Council',
  TWEED: 'Tweed Shire Council',
  BYRON: 'Byron Shire Council',
  'GLEN INNES SEVERN': 'Glen Innes Severn Shire Council',
  TENTERFIELD: 'Tenterfield Shire Council',
  INVERELL: 'Inverell Shire Council',

  // --- New England / North West ---
  TAMWORTH: 'Tamworth Regional Council',
  ARMIDALE: 'Armidale Regional Council',
  GUNNEDAH: 'Gunnedah Shire Council',
  NARRABRI: 'Narrabri Shire Council',
  MOREE: 'Moree Plains Shire Council',
  GWYDIR: 'Gwydir Shire Council',
  WALCHA: 'Walcha Council',
  URALLA: 'Uralla Council',

  // --- Central West ---
  ORANGE: 'Orange City Council',
  DUBBO: 'Dubbo Regional Council',
  PARKES: 'Parkes Shire Council',
  FORBES: 'Forbes Shire Council',
  COWRA: 'Cowra Shire Council',
  BLAYNEY: 'Blayney Shire Council',
  CABONNE: 'Cabonne Shire Council',
  LACHLAN: 'Lachlan Shire Council',
  'UPPER LACHLAN': 'Upper Lachlan Shire Council',
  NARRANDERA: 'Narrandera Shire Council',
  GRIFFITH: 'Griffith City Council',
  LEETON: 'Leeton Shire Council',
  COOLAMON: 'Coolamon Shire Council',

  // --- South East / Tablelands ---
  GOULBURN: 'Goulburn Mulwaree Council',
  'QUEANBEYAN-PALERANG': 'Queanbeyan-Palerang Regional Council',
  'YASS VALLEY': 'Yass Valley Council',
  HILLTOPS: 'Hilltops Council',
  'SNOWY MONARO': 'Snowy Monaro Regional Council',
  EUROBODALLA: 'Eurobodalla Shire Council',
  'BEGA VALLEY': 'Bega Valley Shire Council',

  // --- Riverina / Murray ---
  'WAGGA WAGGA': 'Wagga Wagga City Council',
  ALBURY: 'Albury City Council',
  FEDERATION: 'Federation Council',
  'MURRAY RIVER': 'Murray River Council',
  'SNOWY VALLEYS': 'Snowy Valleys Council',
  TEMORA: 'Temora Shire Council',
  JUNEE: 'Junee Shire Council',
  'GREATER HUME': 'Greater Hume Shire Council',
  LOCKHART: 'Lockhart Shire Council',
  MURRUMBIDGEE: 'Murrumbidgee Council',

  // --- Far West ---
  'BROKEN HILL': 'Broken Hill City Council',
  'CENTRAL DARLING': 'Central Darling Shire Council',
  COBAR: 'Cobar Shire Council',
  BOURKE: 'Bourke Shire Council',
  BREWARRINA: 'Brewarrina Shire Council',
  WALGETT: 'Walgett Shire Council',
  NARROMINE: 'Narromine Shire Council',
  WENTWORTH: 'Wentworth Shire Council',
  HAY: 'Hay Shire Council',
  CARRATHOOL: 'Carrathool Shire Council',
  BERRIGAN: 'Berrigan Shire Council',
  EDWARD: 'Edward River Council',
  'EDWARD RIVER': 'Edward River Council',
  WARREN: 'Warren Shire Council',
  COONAMBLE: 'Coonamble Shire Council',
  BOGAN: 'Bogan Shire Council',
  'COOTAMUNDRA-GUNDAGAI': 'Cootamundra-Gundagai Regional Council',
  BLAND: 'Bland Shire Council',
  WEDDIN: 'Weddin Shire Council',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map an uppercase LGA name (as returned by `resolveLga`) to the exact
 * `CouncilName` string required by the NSW ePlanning Online DA API.
 *
 * Returns `null` for unmapped LGAs — the caller should degrade gracefully
 * to "planning data unavailable for this council" (§7.17).
 *
 * The lookup is case-insensitive on the key: it normalises the input to
 * uppercase before lookup, so "Mosman" and "MOSMAN" both resolve.
 */
export function lgaToCouncil(lga: string): string | null {
  return LGA_TO_COUNCIL[lga.toUpperCase()] ?? null;
}
