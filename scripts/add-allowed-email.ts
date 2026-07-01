// scripts/add-allowed-email.ts — add an address to the login allow-list
// (allowed_emails). Run against whatever DATABASE_URL is in .env.local.
//
// Usage: pnpm tsx scripts/add-allowed-email.ts <email> [note]

import process from 'node:process';

process.loadEnvFile('.env.local');

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.error('usage: pnpm tsx scripts/add-allowed-email.ts <email> [note]');
    process.exit(1);
  }
  const note = process.argv[3] ?? null;

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set (.env.local)');
    process.exit(1);
  }

  const postgres = (await import('postgres')).default;
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql`
      INSERT INTO allowed_emails (email, added_by, note)
      VALUES (${email}, 'admin-cli', ${note})
      ON CONFLICT (email) DO UPDATE
        SET note = COALESCE(EXCLUDED.note, allowed_emails.note)
    `;
    const rows = await sql<{ email: string }[]>`SELECT email FROM allowed_emails ORDER BY added_at`;
    console.log(`OK — ${email} is on the allow-list. ${rows.length} total:`);
    for (const r of rows) console.log('  -', r.email);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
