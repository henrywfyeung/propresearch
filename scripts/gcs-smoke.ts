// scripts/s3-smoke.ts — prove the live S3 upload path works end-to-end.
// Reads the sample PDF and uploads it to the configured bucket via uploadPdf (GCS).
// Usage: pnpm tsx scripts/s3-smoke.ts   (loads S3_* from .env.local)

import { readFileSync } from 'node:fs';
import process from 'node:process';
import { uploadPdf } from '@/tools/storage/gcs';

process.loadEnvFile('.env.local');

async function main() {
  const bytes = new Uint8Array(readFileSync('/tmp/sample-report.pdf'));
  const key = await uploadPdf('reports/_smoketest/sample.pdf', bytes);
  console.log(
    `OK — uploaded ${bytes.length} bytes to s3 key "${key}" (bucket ${process.env.S3_BUCKET}, region ${process.env.S3_REGION}).`,
  );
}

main().catch((e) => {
  console.error('S3 SMOKE FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
