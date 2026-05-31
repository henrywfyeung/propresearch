import { requireAllowedUser } from '@/lib/auth/user';
import type { Route } from 'next';
import Link from 'next/link';
import { ReportProgress } from './report-progress';

// Server component — auth gate + params unwrap; renders the client poller.
export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAllowedUser();
  const { id } = await params;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-8">
        <Link href={'/' as Route} className="text-sm text-ink-muted hover:text-ink transition">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-4 font-display text-2xl font-semibold text-ink">Report</h1>
        <p className="mt-1 font-mono text-xs text-ink-muted">{id}</p>
      </div>

      <ReportProgress id={id} />
    </main>
  );
}
