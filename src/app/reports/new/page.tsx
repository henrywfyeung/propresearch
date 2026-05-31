import { requireAllowedUser } from '@/lib/auth/user';
import type { Route } from 'next';
import Link from 'next/link';
import { NewReportForm } from './new-report-form';

// Server component — auth gate; renders the client-side form.
export default async function NewReportPage() {
  await requireAllowedUser();

  return (
    <main className="mx-auto max-w-xl px-6 py-12">
      <div className="mb-8">
        <Link href={'/' as Route} className="text-sm text-ink-muted hover:text-ink transition">
          &larr; Back to dashboard
        </Link>
        <h1 className="mt-4 font-display text-2xl font-semibold text-ink">New report</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Enter the property you are personally researching. The report takes around 3–5 minutes.
        </p>
      </div>

      <section className="rounded-lg border border-black/5 bg-bg-card p-6 shadow-sm">
        <NewReportForm />
      </section>
    </main>
  );
}
