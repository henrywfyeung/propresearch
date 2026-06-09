// tests/unit/reports-db.test.ts
import {
  createReport,
  listReportsForUser,
  markFailed,
  markNode,
  markRunning,
  markSucceeded,
} from '@/db/reports';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so these mock fns are initialised before the hoisted vi.mock
// factory below references them (otherwise: "Cannot access 'insert' before
// initialization"). Identities/chaining are unchanged.
const {
  insertReturning,
  insertValues,
  insert,
  updateWhere,
  updateSet,
  update,
  selectFrom,
  selectWhere,
  selectOrderBy,
  selectQuery,
} = vi.hoisted(() => {
  const insertReturning = vi.fn();
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const insert = vi.fn(() => ({ values: insertValues }));
  const updateWhere = vi.fn();
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  // select chain: db.select({}).from().where().orderBy()
  const selectOrderBy = vi.fn();
  const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const selectQuery = vi.fn(() => ({ from: selectFrom }));
  return {
    insertReturning,
    insertValues,
    insert,
    updateWhere,
    updateSet,
    update,
    selectFrom,
    selectWhere,
    selectOrderBy,
    selectQuery,
  };
});
vi.mock('@/db/client-worker', () => ({ workerDb: { insert, update } }));
// @/db/client is imported by getReportStatus and listReportsForUser; mock it
// so the module-level DATABASE_URL guard doesn't throw in the test environment.
vi.mock('@/db/client', () => ({ db: { select: selectQuery, update: vi.fn() } }));

beforeEach(() => {
  insertReturning.mockReset().mockResolvedValue([{ id: 'rid-1' }]);
  insertValues.mockClear();
  insert.mockClear();
  updateWhere.mockReset().mockResolvedValue(undefined);
  updateSet.mockClear();
  update.mockClear();
  selectOrderBy.mockReset().mockResolvedValue([]);
  selectWhere.mockClear();
  selectFrom.mockClear();
  selectQuery.mockClear();
});

describe('reports persistence', () => {
  it('createReport inserts a queued row and returns its id', async () => {
    const id = await createReport('user-1');
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', status: 'queued' }),
    );
    expect(id).toBe('rid-1');
  });

  it('createReport throws when no row is returned', async () => {
    insertReturning.mockResolvedValue([]);
    await expect(createReport('user-1')).rejects.toThrow();
  });

  it('markRunning sets status running', async () => {
    await markRunning('rid-1');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    expect(updateWhere).toHaveBeenCalledOnce();
  });

  it('markSucceeded sets status + pdfUrl + subjectAddress + completedAt', async () => {
    await markSucceeded('rid-1', { pdfUrl: 'reports/rid-1/v1.pdf', subjectAddress: '12 X St' });
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        pdfUrl: 'reports/rid-1/v1.pdf',
        subjectAddress: '12 X St',
      }),
    );
  });

  it('markFailed sets status failed + errorMessage', async () => {
    await markFailed('rid-1', 'boom');
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: 'boom' }),
    );
  });

  it('markNode sets currentNode + updatedAt', async () => {
    await markNode('rid-1', 'compose');
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ currentNode: 'compose' }));
    expect(updateWhere).toHaveBeenCalledOnce();
  });
});

describe('listReportsForUser', () => {
  it('returns empty array when no reports exist', async () => {
    selectOrderBy.mockResolvedValue([]);
    const rows = await listReportsForUser('user-1');
    expect(rows).toEqual([]);
  });

  it('selects id, subjectAddress, status, createdAt from reports', async () => {
    selectOrderBy.mockResolvedValue([]);
    await listReportsForUser('user-1');
    // Verify the chain: select → from → where → orderBy
    expect(selectQuery).toHaveBeenCalledOnce();
    expect(selectFrom).toHaveBeenCalledOnce();
    expect(selectWhere).toHaveBeenCalledOnce();
    expect(selectOrderBy).toHaveBeenCalledOnce();
  });

  it('returns the rows returned by drizzle', async () => {
    const fakeRows = [
      {
        id: 'r1',
        subjectAddress: '12 X St',
        status: 'succeeded',
        createdAt: new Date('2026-01-01'),
      },
      { id: 'r2', subjectAddress: null, status: 'queued', createdAt: new Date('2026-01-02') },
    ];
    selectOrderBy.mockResolvedValue(fakeRows);
    const rows = await listReportsForUser('user-1');
    expect(rows).toEqual(fakeRows);
  });
});
