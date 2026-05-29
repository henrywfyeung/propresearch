import { SignOutButton } from '@/components/SignOutButton';
import { requireAllowedUser } from '@/lib/auth/user';

// Dashboard skeleton — Phase A5. Protected by requireAllowedUser() (Node
// runtime), which is the R5 allow-list re-check path (middleware can't do it
// on Edge). The real list-with-filters lands in E5.

export default async function DashboardPage() {
  const { email } = await requireAllowedUser();

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">PropResearch</h1>
          <p className="mt-1 text-sm text-ink-muted">Internal due-diligence dashboard</p>
        </div>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <span className="font-mono text-xs">{email}</span>
          <SignOutButton />
        </div>
      </header>
      <section className="rounded-lg border border-black/5 bg-bg-card p-8 shadow-sm">
        <p className="text-sm text-ink-muted">
          No reports yet. The New Report flow lands in Phase E1.
        </p>
      </section>
    </main>
  );
}
