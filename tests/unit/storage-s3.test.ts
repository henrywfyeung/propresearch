// tests/unit/storage-s3.test.ts
import { getPdf, uploadPdf } from '@/tools/storage/s3';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send })),
  PutObjectCommand: vi.fn((args: unknown) => ({ args })),
  GetObjectCommand: vi.fn((args: unknown) => ({ args })),
}));

beforeEach(() => {
  send.mockReset().mockResolvedValue({});
  vi.mocked(PutObjectCommand).mockClear();
  process.env.S3_BUCKET = 'test-bucket';
  process.env.S3_REGION = 'ap-southeast-2';
  process.env.S3_ACCESS_KEY_ID = 'k';
  process.env.S3_SECRET_ACCESS_KEY = 's';
});

describe('uploadPdf', () => {
  it('puts the PDF and returns the key', async () => {
    const key = await uploadPdf('reports/r1/v1.pdf', new Uint8Array([1, 2, 3]));
    expect(key).toBe('reports/r1/v1.pdf');
    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'reports/r1/v1.pdf',
        ContentType: 'application/pdf',
      }),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it('throws when S3_BUCKET is unset', async () => {
    process.env.S3_BUCKET = '';
    await expect(uploadPdf('k', new Uint8Array())).rejects.toThrow('S3_BUCKET');
  });
});

describe('getPdf', () => {
  it('returns the bytes from Body.transformToByteArray', async () => {
    const expected = new Uint8Array([37, 80, 68, 70]); // %PDF
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => expected },
    });

    const result = await getPdf('reports/r1/v1.pdf');

    expect(result).toEqual(expected);
    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Bucket: 'test-bucket', Key: 'reports/r1/v1.pdf' }),
    );
    expect(send).toHaveBeenCalledOnce();
  });

  it('throws when S3_BUCKET is unset', async () => {
    process.env.S3_BUCKET = '';
    await expect(getPdf('k')).rejects.toThrow('S3_BUCKET');
  });

  it('throws when Body is missing (object not found)', async () => {
    send.mockResolvedValueOnce({ Body: undefined });
    await expect(getPdf('reports/missing/v1.pdf')).rejects.toThrow('S3 object not found');
  });
});
