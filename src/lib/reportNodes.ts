// src/lib/reportNodes.ts — single source of truth for the graph's user-facing
// node order + step labels. Imported by both the progress API route
// (percentage) and the client stepper (labels) so they can never drift, and by
// their tests. Order is approximate for the progress bar only — several nodes
// run concurrently (§15.2). Keep in sync with the graph wiring in agents/graph.ts.

export const NODE_ORDER = [
  'resolveAddress',
  'fetchCandidateComps',
  'visionComps',
  'visionSubject',
  'streetView',
  'fetchRisks',
  'fetchPlanning',
  'fetchDemographics',
  'fetchSchools',
  'fetchCatchments',
  'fetchZoning',
  'fetchProximity',
  'reasonAndSelect',
  'triangulate',
  'compose',
  'render',
] as const;

export type NodeKey = (typeof NODE_ORDER)[number];

// Keyed by the node names that appear in reports.currentNode.
export const NODE_LABELS: Record<string, string> = {
  resolveAddress: 'Resolving address…',
  fetchCandidateComps: 'Finding comparable sales…',
  visionComps: 'Inspecting comparable photos…',
  visionSubject: 'Inspecting property photos…',
  streetView: 'Assessing the street…',
  fetchRisks: 'Assessing risks…',
  fetchPlanning: 'Pulling planning activity…',
  fetchDemographics: 'Gathering suburb demographics…',
  fetchSchools: 'Finding nearby schools…',
  fetchCatchments: 'Checking school catchments…',
  fetchZoning: 'Checking zoning & overlays…',
  fetchProximity: 'Measuring proximity (lines, freeways)…',
  reasonAndSelect: 'Selecting best comparables…',
  triangulate: 'Triangulating value…',
  compose: 'Writing the report…',
  render: 'Rendering PDF…',
};
