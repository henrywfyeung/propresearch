// src/agents/subject.ts — boundary validator that turns the human-supplied raw
// subject payload into a SubjectProperty. Called before runGraph (not a graph
// node). propertyType is constrained to the canonical vocab so subject + comp
// types share one vocabulary for similarity scoring.

import { CanonicalPropertyTypeSchema } from '@/schemas/state';
import type { SubjectProperty } from '@/schemas/state';
import { ListingSchema } from '@/schemas/state';
import { z } from 'zod';

const RawSubjectSchema = z.object({
  attrs: z.object({
    beds: z.number().int().nonnegative(),
    baths: z.number().int().nonnegative(),
    parking: z.number().int().nonnegative(),
    landArea: z.number().nonnegative().nullable(),
    buildingArea: z.number().nonnegative().nullable(),
    propertyType: CanonicalPropertyTypeSchema,
  }),
  photos: z.array(z.string().url()),
  listing: ListingSchema.nullable().optional(),
});

export function buildSubject(raw: unknown): SubjectProperty {
  const p = RawSubjectSchema.parse(raw);
  return {
    attrs: p.attrs,
    photos: p.photos,
    floorplans: [],
    listing: p.listing ?? null,
    visionAnalysis: null,
    streetView: null,
  };
}
