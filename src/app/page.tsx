import { SignOutButton } from '@/components/SignOutButton';
import { listReportsForUser } from '@/db/reports';
import { requireAllowedUser } from '@/lib/auth/user';
import type { Route } from 'next';
import Link from 'next/link';

// Dashboard — lists the signed-in user's reports, newest first.
// Top-level columns only (id, subjectAddress, status, createdAt) — satisfies
// the §4.3 cross-row ESLint guard. Server component; auth via requireAllowedUser.

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  queued: { label: 'Queued', className: 'bg-black/5 text-ink-muted' },
  running: { label: 'Running', className: 'bg-accent/10 text-accent' },
  succeeded: { label: 'Done', className: 'bg-green-100 text-green-800' },
  failed: { label: 'Failed', className: 'bg-danger/10 text-danger' },
  superseded: { label: 'Superseded', className: 'bg-black/5 text-ink-muted' },
};

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIP[status] ?? { label: status, className: 'bg-black/5 text-ink-muted' };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${chip.className}`}
    >
      {chip.label}
    </span>
  );
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default async function DashboardPage() {
  const { email, userId } = await requireAllowedUser();
  const rows = await listReportsForUser(userId);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Property research</h1>
          <p className="mt-1 text-sm text-ink-muted">My property dossiers</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <span className="font-mono text-xs">{email}</span>
          <SignOutButton />
        </div>
      </header>

      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-base font-semibold text-ink">Reports</h2>
        <Link
          href={'/reports/new' as Route}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition"
        >
          New report
        </Link>
      </div>

      {rows.length === 0 ? (
        <section className="rounded-lg border border-black/5 bg-bg-card p-12 shadow-sm text-center">
          <p className="text-sm text-ink-muted mb-4">No reports yet.</p>
          <Link
            href={'/reports/new' as Route}
            className="inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition"
          >
            Create your first report
          </Link>
        </section>
      ) : (
        <section className="rounded-lg border border-black/5 bg-bg-card shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-black/[0.02]">
                <th className="px-4 py-3 text-left font-medium text-ink-muted">Property</th>
                <th className="px-4 py-3 text-left font-medium text-ink-muted">Status</th>
                <th className="px-4 py-3 text-left font-medium text-ink-muted">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-black/[0.04] last:border-0 hover:bg-black/[0.015] transition"
                >
                  <td className="px-4 py-3">
                    <Link
                      href={`/reports/${row.id}` as Route}
                      className="font-medium text-ink hover:text-accent transition"
                    >
                      {row.subjectAddress ?? (
                        <span className="text-ink-muted italic">Address pending…</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <StatusChip status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-ink-muted font-mono text-xs">
                    {formatDate(row.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
