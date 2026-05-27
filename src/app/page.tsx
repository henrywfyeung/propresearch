// Dashboard skeleton — Phase A5. The real list-with-filters lands in E5.
// For now: prove the auth-gated shell renders for an allow-listed user.

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10">
        <h1 className="font-display text-3xl font-semibold text-ink">PropResearch</h1>
        <p className="mt-1 text-sm text-ink-muted">Internal due-diligence dashboard</p>
      </header>
      <section className="rounded-lg border border-black/5 bg-bg-card p-8 shadow-sm">
        <p className="text-sm text-ink-muted">
          No reports yet. The New Report flow lands in Phase E1.
        </p>
      </section>
    </main>
  );
}
