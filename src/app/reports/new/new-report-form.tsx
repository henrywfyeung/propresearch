'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Pure helper — builds the POST body from form values.
// Extracted so it can be unit-tested independently of the DOM.
// ---------------------------------------------------------------------------

export interface NewReportFormValues {
  rawAddress: string;
  beds: string;
  baths: string;
  parking: string;
  landArea: string;
  buildingArea: string;
  propertyType: string;
}

export interface NewReportBody {
  rawAddress: string;
  subject: {
    beds: number;
    baths: number;
    parking: number;
    landArea: number | null;
    buildingArea: number | null;
    propertyType: string;
  };
}

export function buildPostBody(values: NewReportFormValues): NewReportBody {
  return {
    rawAddress: values.rawAddress.trim(),
    subject: {
      beds: Number(values.beds),
      baths: Number(values.baths),
      parking: Number(values.parking),
      landArea: values.landArea !== '' ? Number(values.landArea) : null,
      buildingArea: values.buildingArea !== '' ? Number(values.buildingArea) : null,
      propertyType: values.propertyType,
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// `value` MUST stay in sync with CanonicalPropertyTypeSchema (src/schemas/state.ts) —
// it's what buildSubject validates; `label` is display-only. Earlier this list had
// values like 'Apartment'/'Terrace'/'Rural' that aren't in the canonical vocab, so
// picking them failed buildSubject downstream.
const PROPERTY_TYPES = [
  { value: 'House', label: 'House' },
  { value: 'ApartmentUnitFlat', label: 'Apartment / Unit / Flat' },
  { value: 'Townhouse', label: 'Townhouse' },
  { value: 'Villa', label: 'Villa' },
  { value: 'Land', label: 'Land' },
  { value: 'Other', label: 'Other' },
] as const;

export function NewReportForm() {
  const router = useRouter();
  const [values, setValues] = useState<NewReportFormValues>({
    rawAddress: '',
    beds: '',
    baths: '',
    parking: '',
    landArea: '',
    buildingArea: '',
    propertyType: 'House',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(field: keyof NewReportFormValues, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const body = buildPostBody(values);
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: unknown };
        setError(
          typeof data.error === 'string' ? data.error : 'Something went wrong. Please try again.',
        );
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/reports/${id}` as Route);
    } catch {
      setError('Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Address */}
      <div>
        <label className="block text-sm font-medium text-ink mb-1.5" htmlFor="rawAddress">
          Property address <span className="text-danger">*</span>
        </label>
        <input
          id="rawAddress"
          type="text"
          required
          placeholder="e.g. 12 Smith Street, Mosman NSW 2088"
          value={values.rawAddress}
          onChange={(e) => set('rawAddress', e.target.value)}
          className="w-full rounded-md border border-black/15 bg-bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
      </div>

      {/* Property type */}
      <div>
        <label className="block text-sm font-medium text-ink mb-1.5" htmlFor="propertyType">
          Property type
        </label>
        <select
          id="propertyType"
          value={values.propertyType}
          onChange={(e) => set('propertyType', e.target.value)}
          className="w-full rounded-md border border-black/15 bg-bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        >
          {PROPERTY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* Bedrooms / bathrooms / parking */}
      <div className="grid grid-cols-3 gap-4">
        {(
          [
            { id: 'beds', label: 'Bedrooms', placeholder: '3', required: true },
            { id: 'baths', label: 'Bathrooms', placeholder: '2', required: true },
            { id: 'parking', label: 'Parking', placeholder: '1', required: true },
          ] as const
        ).map(({ id, label, placeholder }) => (
          <div key={id}>
            <label className="block text-sm font-medium text-ink mb-1.5" htmlFor={id}>
              {label} <span className="text-danger">*</span>
            </label>
            <input
              id={id}
              type="number"
              required
              min={0}
              step={1}
              placeholder={placeholder}
              value={values[id]}
              onChange={(e) => set(id, e.target.value)}
              className="w-full rounded-md border border-black/15 bg-bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        ))}
      </div>

      {/* Land area / building area */}
      <div className="grid grid-cols-2 gap-4">
        {(
          [
            { id: 'landArea', label: 'Land area (m²)', placeholder: '650' },
            { id: 'buildingArea', label: 'Building area (m²)', placeholder: '220' },
          ] as const
        ).map(({ id, label, placeholder }) => (
          <div key={id}>
            <label className="block text-sm font-medium text-ink mb-1.5" htmlFor={id}>
              {label} <span className="text-xs font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id={id}
              type="number"
              min={0}
              step={1}
              placeholder={placeholder}
              value={values[id]}
              onChange={(e) => set(id, e.target.value)}
              className="w-full rounded-md border border-black/15 bg-bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-muted/60 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p className="rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {/* Submit */}
      <div className="flex items-center justify-between pt-2">
        <a href="/" className="text-sm text-ink-muted hover:text-ink transition">
          Cancel
        </a>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {submitting ? 'Generating…' : 'Generate report'}
        </button>
      </div>
    </form>
  );
}
