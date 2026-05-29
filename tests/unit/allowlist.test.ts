// Unit tests for the allow-list 60s cache ([R5]). The cache governs how fast
// a revocation propagates, so its TTL behaviour is worth pinning down.
//
// We mock @/db/client so no real Postgres is needed; the mock counts how many
// times the DB is hit, which is what the cache is supposed to minimise.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable mock of the Drizzle query chain: db.select().from().where().limit()
const limitMock = vi.fn();
vi.mock('@/db/client', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: limitMock,
        }),
      }),
    }),
  },
}));

import { clearAllowlistCache, isAllowed, isAllowedCached } from '@/lib/auth/allowlist';

beforeEach(() => {
  limitMock.mockReset();
  clearAllowlistCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isAllowed', () => {
  it('returns true when a row exists, false otherwise', async () => {
    limitMock.mockResolvedValueOnce([{ email: 'a@example.com' }]);
    expect(await isAllowed('a@example.com')).toBe(true);

    limitMock.mockResolvedValueOnce([]);
    expect(await isAllowed('b@example.com')).toBe(false);
  });

  it('normalises case + whitespace before querying', async () => {
    limitMock.mockResolvedValueOnce([{ email: 'a@example.com' }]);
    expect(await isAllowed('  A@Example.com  ')).toBe(true);
  });
});

describe('isAllowedCached', () => {
  it('hits the DB once, then serves from cache within the 60s TTL', async () => {
    limitMock.mockResolvedValue([{ email: 'a@example.com' }]);

    expect(await isAllowedCached('a@example.com')).toBe(true);
    expect(await isAllowedCached('a@example.com')).toBe(true);
    expect(await isAllowedCached('a@example.com')).toBe(true);

    expect(limitMock).toHaveBeenCalledTimes(1); // cached after the first
  });

  it('re-queries after the TTL expires (revocation propagates)', async () => {
    vi.useFakeTimers();
    limitMock.mockResolvedValueOnce([{ email: 'a@example.com' }]); // first: allowed
    expect(await isAllowedCached('a@example.com')).toBe(true);

    // Simulate removal from allowed_emails + 61s passing.
    limitMock.mockResolvedValueOnce([]); // second: revoked
    vi.advanceTimersByTime(61_000);

    expect(await isAllowedCached('a@example.com')).toBe(false);
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  it('clearAllowlistCache forces an immediate re-query', async () => {
    limitMock.mockResolvedValueOnce([{ email: 'a@example.com' }]);
    expect(await isAllowedCached('a@example.com')).toBe(true);

    clearAllowlistCache('a@example.com');
    limitMock.mockResolvedValueOnce([]);
    expect(await isAllowedCached('a@example.com')).toBe(false);
    expect(limitMock).toHaveBeenCalledTimes(2);
  });
});
