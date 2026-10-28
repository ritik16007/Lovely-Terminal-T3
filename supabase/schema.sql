-- Run once in Supabase Dashboard > SQL Editor.
-- Each signed-in passenger can only read and change their own bookings.
create table if not exists public.lounge_bookings (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  pass_id text not null,
  booking jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, pass_id)
);

alter table public.lounge_bookings enable row level security;

grant select, insert, update, delete on public.lounge_bookings to authenticated;

drop policy if exists "Passengers manage their own lounge bookings" on public.lounge_bookings;
create policy "Passengers manage their own lounge bookings"
on public.lounge_bookings
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
