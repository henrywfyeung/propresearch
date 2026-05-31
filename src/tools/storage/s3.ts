// src/tools/storage/s3.ts — provider-agnostic S3 PDF storage (CLAUDE.md §7.15).
// AWS S3 by default; set S3_ENDPOINT for an S3-compatible provider (R2/MinIO).
// Returns the object key; the bucket stays private and the download route signs it.

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

function makeClient(): S3Client {
  const endpoint = process.env.S3_ENDPOINT || undefined;
  return new S3Client({
    region: process.env.S3_REGION ?? 'ap-southeast-2',
    endpoint,
    forcePathStyle: Boolean(endpoint),
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  });
}

export async function uploadPdf(key: string, bytes: Uint8Array): Promise<string> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is not set');
  await makeClient().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'application/pdf' }),
  );
  return key;
}
