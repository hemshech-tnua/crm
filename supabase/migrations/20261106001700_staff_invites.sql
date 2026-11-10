-- First entry by a personal link: an admin (or, for the first admins, the person setting up the system) creates a
-- one-time link for a staff member; opening it, the person types their own email and is signed in. From then on
-- they sign in with a code sent to that email. Only the link's hash is stored; it works once and expires.
-- Read and written only by the staff-admin Edge Function (service role): RLS on, no policies, no grants.
create table public.staff_invites (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz
);
create index staff_invites_user_idx on public.staff_invites (user_id);
alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from public, anon, authenticated;
