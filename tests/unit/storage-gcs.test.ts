// tests/unit/storage-gcs.test.ts — unit cover for the GCS storage module.
// Replaces storage-s3.test.ts. The @google-cloud/storage client is mocked so
// these tests need no credentials and make no network calls.

import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const save = vi.fn();
const download = vi.fn();
const exists = vi.fn();
const getMetadata = vi.fn();
const createReadStream = vi.fn();
const file = vi.fn(() => ({ save, download, exists, getMetadata, createReadStream }));
const bucket = vi.fn(() => ({ file }));

vi.mock('@google-cloud/storage', () => ({
  Storage: vi.fn(() => ({ bucket })),
}));

import { getPdf, getPdfStream, uploadPdf } from '@/tools/storage/gcs';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GCS_BUCKET = 'propsearch-reports';
  exists.mockResolvedValue([true]);
  download.mockResolvedValue([Buffer.from([1, 2, 3])]);
  getMetadata.mockResolvedValue([{ size: '3' }]);
  createReadStream.mockReturnValue(Readable.from(Buffer.from([1, 2, 3])));
  save.mockResolvedValue(undefined);
});

describe('uploadPdf', () => {
  it('writes to the configured bucket and returns the key', async () => {
    const key = await uploadPdf('reports/r1/v1.pdf', new Uint8Array([1, 2, 3]));

    expect(key).toBe('reports/r1/v1.pdf');
    expect(bucket).toHaveBeenCalledWith('propsearch-reports');
    expect(file).toHaveBeenCalledWith('reports/r1/v1.pdf');
    expect(save).toHaveBeenCalledWith(
      Buffer.from([1, 2, 3]),
      expect.objectContaining({ contentType: 'application/pdf', resumable: false }),
    );
  });

  it('throws a clear error when GCS_BUCKET is unset', async () => {
    process.env.GCS_BUCKET = '';
    await expect(uploadPdf('k', new Uint8Array())).rejects.toThrow('GCS_BUCKET');
  });
});

describe('getPdf', () => {
  it('returns the object bytes', async () => {
    const result = await getPdf('reports/r1/v1.pdf');
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });

  it('throws when the object is absent rather than returning empty bytes', async () => {
    exists.mockResolvedValue([false]);
    await expect(getPdf('reports/missing/v1.pdf')).rejects.toThrow('GCS object not found');
  });

  it('throws a clear error when GCS_BUCKET is unset', async () => {
    process.env.GCS_BUCKET = '';
    await expect(getPdf('k')).rejects.toThrow('GCS_BUCKET');
  });
});

describe('getPdfStream', () => {
  it('returns a readable stream and the object size', async () => {
    const { stream, size } = await getPdfStream('reports/r1/v1.pdf');

    expect(size).toBe(3);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    expect(Array.from(Buffer.concat(chunks))).toEqual([1, 2, 3]);
  });

  it('throws when the object is absent, so the route 404s instead of streaming nothing', async () => {
    exists.mockResolvedValue([false]);
    await expect(getPdfStream('reports/missing/v1.pdf')).rejects.toThrow('GCS object not found');
  });

  it('treats missing size metadata as 0 rather than NaN', async () => {
    getMetadata.mockResolvedValue([{}]);
    const { size } = await getPdfStream('reports/r1/v1.pdf');
    expect(size).toBe(0);
  });
});
