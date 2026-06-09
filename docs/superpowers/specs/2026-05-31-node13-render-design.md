# Design: Node 13 `render` + S3 storage

- **Date:** 2026-05-31
- **Status:** Design (autonomous; storage = AWS S3, provider-agnostic)
- **Scope:** The render graph node — map graph state → `ReportData` → HTML → PDF → upload to S3 — plus a provider-agnostic S3 storage client. Template/HTML/PDF driver already exist (`ReportDocument.tsx`, `render.ts`, `pdf.ts`).

---

## 1. Context

The template (`ReportDocument.tsx`), HTML SSR (`renderReportHtml`), and the Puppeteer driver (`renderReportPdf`, `src/report/pdf.ts`) are built and the look is approved (sample rendered via local Chrome). This increment connects the graph to them and stores the result:

```
compose → render: state → ReportData → renderReportHtml → renderReportPdf → uploadPdf(S3) → { pdfUrl }
```

Charts + self-hosted fonts are **separate later sub-increments** (owner sequence: node → charts → fonts).

## 2. Storage client — `src/tools/storage/s3.ts`

Provider-agnostic, S3-API. Add dependency **`@aws-sdk/client-s3`**. Config from `S3_*` env (works for AWS S3; set `S3_ENDPOINT` for R2).

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function makeClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  return new S3Client({
    region: process.env.S3_REGION ?? 'ap-southeast-2',
    endpoint,
    forcePathStyle: Boolean(endpoint), // R2/MinIO want path-style
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

/** Upload PDF bytes; returns the object key (the proxied-download route signs it later, §7.15). */
export async function uploadPdf(key: string, bytes: Uint8Array): Promise<string> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is not set');
  await makeClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/pdf' }),
  );
  return key;
}
```

Returns the **key** (not a public URL) — the bucket stays private; the future download route fetches via a short-lived signed URL (§7.15/R47).

## 3. State → ReportData — `src/report/toReportData.ts`

Pure mapping. `toReportData(state): ReportData | null` (null when `resolvedAddress` or `subject` is missing).

```ts
export function toReportData(state: GraphState): ReportData | null {
  const { resolvedAddress: a, subject, triangulation, comparables, prose } = state;
  if (!a || !subject) return null;
  return {
    address: a.normalizedAddress,
    suburb: a.suburb,
    state: a.state,
    postcode: a.postcode,
    subject: subject.attrs,
    triangulation: triangulation
      ? { low: triangulation.low, high: triangulation.high, reconciled: triangulation.reconciled,
          confidence: triangulation.confidence, uncertaintyNote: triangulation.uncertaintyNote }
      : null,
    comparables,
    prose,
    generatedAt: new Date().toISOString(),
  };
}
```

## 4. Render node — `src/agents/nodes/13_render.ts`

```ts
export async function render(state: GraphState): Promise<Partial<GraphState>> {
  const data = toReportData(state);
  if (!data) return { errors: [{ code: 'PARTIAL_DATA', message: 'render: missing resolvedAddress or subject' }] };
  const html = renderReportHtml(data);
  const pdf = await renderReportPdf(html);
  const key = await uploadPdf(`reports/${state.reportId}/v1.pdf`, pdf);
  return { pdfUrl: key };
}
```

Render/upload failures **propagate** (the report fails; retryable later under Inngest). Key format `reports/{reportId}/v1.pdf` (§7.15 versioning; v1 for now).

## 5. Graph wiring

- **`annotation.ts`:** add `pdfUrl: Annotation<string | null>({ reducer: (_c, u) => u, default: () => null })`.
- **`graph.ts`:** `… → compose → render → END`.

## 6. Testing

- **`tests/unit/toReportData.test.ts`** (pure): full state → ReportData with the right fields; missing subject/address → null.
- **`tests/unit/storage-s3.test.ts`**: `vi.mock('@aws-sdk/client-s3')` — assert `uploadPdf` constructs a `PutObjectCommand` with the bucket, the `reports/<id>/v1.pdf` key, `ContentType: application/pdf`, and returns the key; throws when `S3_BUCKET` unset.
- **`tests/unit/render.test.ts`** (node): `vi.mock('@/report/pdf')` (fake `renderReportPdf` → `Uint8Array`) + `vi.mock('@/tools/storage/s3')` (fake `uploadPdf` → key). Seed a full `graphState` (subject + comps + triangulation + prose); assert `pdfUrl === 'reports/<id>/v1.pdf'` and `renderReportPdf` got an HTML string; missing-subject → `PARTIAL_DATA`, no upload.
- **Update `tests/unit/graph.test.ts`**: add `vi.mock('@/report/pdf')` + `vi.mock('@/tools/storage/s3')`; assert the run ends with `state.pdfUrl` set.

## 7. Out of scope (later sub-increments)

- **Charts** (Observable Plot dot-plot) and **self-hosted fonts** (Inter/General Sans woff2).
- The **proxied download route** (`/reports/[id]/pdf`) + signed URLs (needs the Next.js route + `@aws-sdk/s3-request-presigner`).
- Real S3 upload validation (needs the owner's bucket + creds).
- Inngest step / checkpointer; `report_versions` row + DB `reports.pdfUrl` write (graph-only here).
- Report enrichment (photos, deeper analysis) — tracked separately.

## 8. Definition of done

- `@aws-sdk/client-s3` added; `uploadPdf`, `toReportData`, `render` node, `pdfUrl` channel; graph runs `… → render → END`.
- New unit tests + updated graph test; `pnpm typecheck && pnpm lint && pnpm test` green.
- `scripts/render-sample.ts` still produces a local PDF (unaffected).
- Changes limited to the files above; `CLAUDE.md` untouched.
