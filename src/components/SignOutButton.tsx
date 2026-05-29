// Minimal sign-out control — POSTs to /auth/signout (POST-only so prefetch
// can't trigger it).
export function SignOutButton() {
  return (
    <form action="/auth/signout" method="post">
      <button
        type="submit"
        className="rounded-md border border-black/10 px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-black/[0.03]"
      >
        Sign out
      </button>
    </form>
  );
}
