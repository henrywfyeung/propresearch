// src/tools/storage/gcs.ts — private GCS storage for rendered PDFs
// (CLAUDE.md §7.15). Returns the object key; the bucket stays private and the
// download route proxies the bytes, so no public or signed URL ever exists.
//
// Auth is Application Default Credentials, i.e. the Cloud Run runtime service
// account. This is a deliberate improvement on the S3 client it replaces, which
// hardcoded `process.env.S3_ACCESS_KEY_ID ?? ''` and so could never fall back to
// the ambient credential chain — there are now no storage credentials in env.

import { type Storage as GcsStorage, Storage } from '@google-cloud/storage';

let cached: GcsStorage | null = null;

function client(): GcsStorage {
  cached ??= new Storage();
  return cached;
}

function bucketName(): string {
  const name = process.env.GCS_BUCKET;
  if (!name) throw new Error('GCS_BUCKET is not set');
  return name;
}

function file(key: string) {
  return client().bucket(bucketName()).file(key);
}

/** Download a stored PDF in full. Prefer getPdfStream for serving to clients. */
export async function getPdf(key: string): Promise<Uint8Array> {
  const [exists] = await file(key).exists();
  if (!exists) throw new Error(`GCS object not found: ${key}`);
  const [buffer] = await file(key).download();
  return new Uint8Array(buffer);
}

/**
 * Stream a stored PDF plus its size, so the download route can set
 * Content-Length without first buffering the whole file in memory.
 */
export async function getPdfStream(
  key: string,
): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
  const target = file(key);
  const [exists] = await target.exists();
  if (!exists) throw new Error(`GCS object not found: ${key}`);
  const [metadata] = await target.getMetadata();
  return { stream: target.createReadStream(), size: Number(metadata.size ?? 0) };
}

export async function uploadPdf(key: string, bytes: Uint8Array): Promise<string> {
  // resumable:false — these are single-digit-MB objects written once; a
  // resumable session would be two extra round trips for no benefit.
  await file(key).save(Buffer.from(bytes), {
    contentType: 'application/pdf',
    resumable: false,
  });
  return key;
}
