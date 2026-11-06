// First administrator for a new installation (after that, admins create users in Settings → משתמשים).
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<secret> \
//   node scripts/create-admin.mjs <email> "<full name>"
// Prints a one-time temporary password; the admin must replace it at first sign-in.
// The service-role key bypasses all security rules: run this on a trusted machine and never commit the key.
import { randomInt } from 'node:crypto';

const [email, fullName] = process.argv.slice(2);
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !email || !fullName) {
  console.error('usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/create-admin.mjs <email> "<full name>"');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const existing = await fetch(`${url}/rest/v1/staff?role=eq.admin&is_active=eq.true&select=email`, { headers }).then((r) => r.json());
if (Array.isArray(existing) && existing.length && !process.argv.includes('--another')) {
  console.error(`there is already an active admin (${existing.map((a) => a.email).join(', ')}). Use Settings in the app, or pass --another.`);
  process.exit(1);
}

const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
let password = '';
while (!/\d/.test(password) || !/[A-Za-z]/.test(password)) {
  password = Array.from({ length: 14 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

const created = await fetch(`${url}/auth/v1/admin/users`, { method: 'POST', headers, body: JSON.stringify({ email, password, email_confirm: true }) });
const user = await created.json();
if (!created.ok) {
  console.error('could not create the user:', user.msg ?? user.message ?? created.status);
  process.exit(1);
}
const staff = await fetch(`${url}/rest/v1/staff`, {
  method: 'POST', headers: { ...headers, Prefer: 'return=minimal' },
  body: JSON.stringify({ user_id: user.id, full_name: fullName, email: email.toLowerCase(), role: 'admin', must_change_password: true }),
});
if (!staff.ok) {
  await fetch(`${url}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers });
  console.error('could not create the staff record:', await staff.text());
  process.exit(1);
}
console.log(`admin created: ${email}\ntemporary password (shown once): ${password}`);
