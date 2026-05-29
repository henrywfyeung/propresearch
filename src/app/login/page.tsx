import { GoogleSignInButton } from './login-button';

// Login page. Public (excluded from the auth redirect). Shows the Google
// sign-in button and renders allow-list / OAuth error states from the query
// string (CLAUDE.md §15.1).

const ERROR_MESSAGES: Record<string, string> = {
  not_allowed: 'That Google account is not on the access list. Contact an admin.',
  oauth: 'Sign-in failed. Please try again.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const message = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong.') : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-black/5 bg-bg-card p-8 shadow-sm">
        <h1 className="font-display text-2xl font-semibold text-ink">PropResearch</h1>
        <p className="mt-1 text-sm text-ink-muted">Internal due-diligence tool</p>

        {message ? (
          <div className="mt-6 rounded-md border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger">
            {message}
          </div>
        ) : null}

        <div className="mt-8">
          <GoogleSignInButton />
        </div>

        <p className="mt-6 text-xs text-ink-muted">Access is restricted to approved accounts.</p>
      </div>
    </main>
  );
}
