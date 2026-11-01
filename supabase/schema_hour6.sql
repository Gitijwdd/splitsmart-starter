-- SplitSmart · Hour 6 — groups + membership + multi-tenant Row-Level Security
--
-- HOW TO RUN THIS (after you've already run schema.sql in Hour 5):
--   1. Supabase → left sidebar → SQL Editor → + New query
--   2. Paste everything in this file → Run (Cmd/Ctrl + Enter)
--   3. You should see "Success. No rows returned."
--
-- Safe to run more than once.

-- a GROUP is one "tenant" (Goa Trip, Flat 304, ...). join_code lets friends join.
create table if not exists groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  join_code  text not null unique default upper(substr(md5(random()::text), 1, 6)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- who belongs to which group
create table if not exists group_members (
  group_id  uuid not null references groups(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

-- create a group and its creator membership together
create or replace function create_group(group_name text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  new_group_id uuid;
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'You must be signed in to create a group';
  end if;
  if nullif(trim(group_name), '') is null then
    raise exception 'Group name cannot be empty';
  end if;

  insert into groups (name, created_by)
  values (trim(group_name), current_user_id)
  returning id into new_group_id;

  insert into group_members (group_id, user_id)
  values (new_group_id, current_user_id);

  return new_group_id;
end; $$;

revoke all on function create_group(text) from public;
grant execute on function create_group(text) to authenticated;

-- every expense now belongs to a group
alter table expenses add column if not exists group_id uuid references groups(id) on delete cascade;
alter table expenses
  add column if not exists paid_by_user_id uuid references auth.users(id) on delete set null;
alter table expenses
  add column if not exists shares jsonb not null default '[]'::jsonb;

-- helper: "is the logged-in person a member of this group?"
-- SECURITY DEFINER lets it check membership WITHOUT tripping RLS recursion.
create or replace function is_group_member(gid uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (select 1 from group_members
                 where group_id = gid and user_id = auth.uid());
$$;

-- join a group by its code (runs as owner, so it can find the group)
create or replace function join_group(code text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare gid uuid;
begin
  select id into gid from groups where join_code = upper(trim(code));
  if gid is null then raise exception 'No group with that code'; end if;
  insert into group_members (group_id, user_id) values (gid, auth.uid())
    on conflict do nothing;
  return gid;
end; $$;

-- turn on Row-Level Security, then the rules (safe to re-run)
alter table groups        enable row level security;
alter table group_members enable row level security;
alter table expenses      enable row level security;

drop policy if exists "see my groups"         on groups;
drop policy if exists "create groups"         on groups;
drop policy if exists "rename groups"         on groups;
drop policy if exists "see my memberships"    on group_members;
drop policy if exists "join groups"           on group_members;
drop policy if exists "leave groups"          on group_members;
drop policy if exists "see group expenses"    on expenses;
drop policy if exists "add group expenses"    on expenses;
drop policy if exists "delete group expenses" on expenses;

create policy "see my groups"      on groups for select using (is_group_member(id));
create policy "create groups"      on groups for insert with check (auth.uid() = created_by);
create policy "rename groups"      on groups for update using (is_group_member(id)) with check (is_group_member(id));
revoke update on groups from anon, authenticated;
grant update (name) on groups to authenticated;

create policy "see my memberships" on group_members for select using (user_id = auth.uid());
create policy "join groups"        on group_members for insert with check (user_id = auth.uid());
create policy "leave groups"       on group_members for delete using (user_id = auth.uid());

create policy "see group expenses"    on expenses for select using (is_group_member(group_id));
create policy "add group expenses"    on expenses for insert with check (is_group_member(group_id));
drop policy if exists "update group expenses" on expenses;
create policy "update group expenses" on expenses
  for update using (is_group_member(group_id)) with check (is_group_member(group_id));
create policy "delete group expenses" on expenses for delete using (is_group_member(group_id));
grant update (paid_by, paid_by_user_id) on expenses to authenticated;

create or replace function can_view_group_profile(profile_user_id uuid)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists (
    select 1
    from group_members viewer
    join group_members profile_member on profile_member.group_id = viewer.group_id
    where viewer.user_id = auth.uid()
      and profile_member.user_id = profile_user_id
  );
$$;

revoke all on function can_view_group_profile(uuid) from public;
grant execute on function can_view_group_profile(uuid) to authenticated;

create table if not exists group_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  username   text not null check (char_length(btrim(username)) between 1 and 40),
  updated_at timestamptz not null default now()
);

create index if not exists group_members_user_id_group_id_idx
  on group_members (user_id, group_id);

alter table group_profiles enable row level security;

drop policy if exists "see group profiles" on group_profiles;
drop policy if exists "create own group profile" on group_profiles;
drop policy if exists "update own group profile" on group_profiles;

create policy "see group profiles" on group_profiles
  for select using (user_id = auth.uid() or can_view_group_profile(user_id));
create policy "create own group profile" on group_profiles
  for insert with check (user_id = auth.uid());
create policy "update own group profile" on group_profiles
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on group_profiles from anon, authenticated;
grant select, insert, update on group_profiles to authenticated;

create or replace function get_group_members(gid uuid)
returns table (user_id uuid, username text)
language sql security definer stable
set search_path = public as $$
  select gm.user_id,
         coalesce(nullif(btrim(gp.username), ''), 'Member ' || left(gm.user_id::text, 6)) as username
  from group_members gm
  left join group_profiles gp on gp.user_id = gm.user_id
  where gm.group_id = gid
    and is_group_member(gid)
  order by lower(coalesce(nullif(btrim(gp.username), ''), 'Member ' || left(gm.user_id::text, 6)));
$$;

revoke all on function get_group_members(uuid) from public;
grant execute on function get_group_members(uuid) to authenticated;

update expenses e
set paid_by_user_id = case
  when e.paid_by = 'You' then e.user_id
  else (
    select gm.user_id
    from group_members gm
    join group_profiles gp on gp.user_id = gm.user_id
    where gm.group_id = e.group_id
      and lower(gp.username) = lower(e.paid_by)
    order by gm.joined_at, gm.user_id
    limit 1
  )
end
where e.paid_by_user_id is null;

-- group chat messages are visible only to members; authors cannot impersonate another user.
create table if not exists group_messages (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references groups(id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  message    text not null check (char_length(btrim(message)) between 1 and 1000),
  created_at timestamptz not null default now()
);

alter table group_messages enable row level security;

drop policy if exists "see group messages" on group_messages;
drop policy if exists "send group messages" on group_messages;
drop policy if exists "clear group messages" on group_messages;

create policy "see group messages" on group_messages
  for select using (is_group_member(group_id));
create policy "send group messages" on group_messages
  for insert with check (user_id = auth.uid() and is_group_member(group_id));
create policy "clear group messages" on group_messages
  for delete using (is_group_member(group_id));

revoke all on group_messages from anon, authenticated;
grant select, insert, delete on group_messages to authenticated;

create table if not exists debt_reminders (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references groups(id) on delete cascade,
  debtor_user_id uuid not null references auth.users(id) on delete cascade,
  payer_user_id  uuid references auth.users(id) on delete set null,
  payer_name     text not null check (char_length(btrim(payer_name)) > 0),
  payer_key      text not null,
  amount_cents   bigint not null default 0 check (amount_cents >= 0),
  paid_at        timestamptz,
  updated_at     timestamptz not null default now(),
  unique (group_id, debtor_user_id, payer_key)
);

alter table debt_reminders
  add column if not exists payer_user_id uuid references auth.users(id) on delete set null;
alter table debt_reminders add column if not exists paid_at timestamptz;

alter table debt_reminders enable row level security;

drop policy if exists "see my debt reminders" on debt_reminders;
create policy "see my debt reminders" on debt_reminders
  for select using (debtor_user_id = auth.uid() and is_group_member(group_id));

revoke all on debt_reminders from anon, authenticated;
grant select on debt_reminders to authenticated;

create or replace function sync_debt_reminders(gid uuid, reminders jsonb)
returns void language plpgsql security definer
set search_path = public as $$
declare
  reminder jsonb;
  debtor_id uuid;
  payer_id uuid;
  reminder_payer text;
  reminder_amount bigint;
begin
  if auth.uid() is null or not is_group_member(gid) then
    raise exception 'You must be a group member to sync payment reminders';
  end if;
  if jsonb_typeof(reminders) is distinct from 'array' then
    raise exception 'Payment reminders must be an array';
  end if;

  for reminder in select value from jsonb_array_elements(reminders)
  loop
    debtor_id := nullif(reminder->>'debtor_user_id', '')::uuid;
    payer_id := nullif(reminder->>'payer_user_id', '')::uuid;
    reminder_payer := nullif(btrim(reminder->>'payer_name'), '');
    reminder_amount := (reminder->>'amount_cents')::bigint;
    if debtor_id is null
       or debtor_id <> auth.uid()
       or reminder_payer is null
       or reminder_amount is null
       or reminder_amount <= 0 then
      raise exception 'Payment reminder details are invalid';
    end if;
    if not exists (
      select 1 from group_members
      where group_id = gid and user_id = debtor_id
    ) then
      raise exception 'Payment reminder recipient is not a group member';
    end if;
  end loop;

  update debt_reminders existing
  set amount_cents = 0, paid_at = null, updated_at = now()
  where existing.group_id = gid
    and existing.debtor_user_id = auth.uid()
    and existing.amount_cents > 0
    and not exists (
      select 1
      from jsonb_array_elements(reminders) as reminder_item(value)
      where (reminder_item.value->>'debtor_user_id')::uuid = existing.debtor_user_id
        and lower(btrim(reminder_item.value->>'payer_name')) = existing.payer_key
        and (reminder_item.value->>'amount_cents')::bigint > 0
    );

  for reminder in select value from jsonb_array_elements(reminders)
  loop
    debtor_id := (reminder->>'debtor_user_id')::uuid;
    payer_id := nullif(reminder->>'payer_user_id', '')::uuid;
    if payer_id is not null and not exists (
      select 1 from group_members
      where group_id = gid and user_id = payer_id
    ) then
      payer_id := null;
    end if;
    reminder_payer := btrim(reminder->>'payer_name');
    reminder_amount := (reminder->>'amount_cents')::bigint;
    insert into debt_reminders (group_id, debtor_user_id, payer_user_id, payer_name, payer_key, amount_cents)
    values (gid, debtor_id, payer_id, reminder_payer, lower(reminder_payer), reminder_amount)
    on conflict (group_id, debtor_user_id, payer_key) do update
      set payer_user_id = excluded.payer_user_id,
          payer_name = excluded.payer_name,
          amount_cents = excluded.amount_cents,
          paid_at = case
            when debt_reminders.amount_cents is distinct from excluded.amount_cents
              or debt_reminders.payer_user_id is distinct from excluded.payer_user_id
            then null
            else debt_reminders.paid_at
          end,
          updated_at = now()
      where debt_reminders.amount_cents is distinct from excluded.amount_cents
         or debt_reminders.payer_user_id is distinct from excluded.payer_user_id
         or debt_reminders.payer_name is distinct from excluded.payer_name;
  end loop;
end; $$;

revoke all on function sync_debt_reminders(uuid, jsonb) from public;
grant execute on function sync_debt_reminders(uuid, jsonb) to authenticated;

create table if not exists payment_notifications (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references groups(id) on delete cascade,
  recipient_user_id  uuid not null references auth.users(id) on delete cascade,
  debtor_user_id     uuid not null references auth.users(id) on delete cascade,
  debtor_name        text not null,
  amount_cents       bigint not null check (amount_cents > 0),
  notification_type  text not null default 'payment_reported',
  payer_name         text,
  read_at            timestamptz,
  created_at         timestamptz not null default now()
);

alter table payment_notifications
  add column if not exists notification_type text not null default 'payment_reported';
alter table payment_notifications add column if not exists payer_name text;
alter table payment_notifications add column if not exists read_at timestamptz;

alter table payment_notifications enable row level security;

drop policy if exists "see my payment notifications" on payment_notifications;
drop policy if exists "mark my payment notifications read" on payment_notifications;
create policy "see my payment notifications" on payment_notifications
  for select using (recipient_user_id = auth.uid() and is_group_member(group_id));
create policy "mark my payment notifications read" on payment_notifications
  for update using (recipient_user_id = auth.uid() and is_group_member(group_id))
  with check (recipient_user_id = auth.uid() and is_group_member(group_id));

revoke all on payment_notifications from anon, authenticated;
grant select, update (read_at) on payment_notifications to authenticated;

drop function if exists confirm_debt_reminder_paid(uuid);
create function confirm_debt_reminder_paid(reminder_id uuid)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  reminder_row debt_reminders%rowtype;
  debtor_name_value text;
  marked_notification_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to confirm a payment';
  end if;

  update debt_reminders
  set paid_at = now(), updated_at = now()
  where id = reminder_id
    and debtor_user_id = auth.uid()
    and amount_cents > 0
    and paid_at is null
  returning * into reminder_row;

  if not found then
    raise exception 'This reminder is no longer active or its payer cannot be notified';
  end if;
  if not is_group_member(reminder_row.group_id) then
    raise exception 'You must still be a member of this group to confirm payment';
  end if;

  select coalesce(nullif(btrim(username), ''), 'A group member')
  into debtor_name_value
  from group_profiles
  where user_id = auth.uid();
  debtor_name_value := coalesce(debtor_name_value, 'A group member');

  if reminder_row.payer_user_id is not null
     and exists (
       select 1 from group_members
       where group_id = reminder_row.group_id
         and user_id = reminder_row.payer_user_id
     ) then
    insert into payment_notifications (
      group_id, recipient_user_id, debtor_user_id, debtor_name, amount_cents,
      notification_type, payer_name, read_at
    ) values (
      reminder_row.group_id,
      reminder_row.payer_user_id,
      auth.uid(),
      debtor_name_value,
      reminder_row.amount_cents,
      'payment_reported',
      reminder_row.payer_name,
      null
    );
  end if;

  insert into payment_notifications (
    group_id, recipient_user_id, debtor_user_id, debtor_name, amount_cents,
    notification_type, payer_name, read_at
  ) values (
    reminder_row.group_id,
    auth.uid(),
    auth.uid(),
    debtor_name_value,
    reminder_row.amount_cents,
    'marked_as_paid',
    reminder_row.payer_name,
    now()
  ) returning id into marked_notification_id;
  return marked_notification_id;
end; $$;

revoke all on function confirm_debt_reminder_paid(uuid) from public;
grant execute on function confirm_debt_reminder_paid(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'group_messages'
     ) then
    alter publication supabase_realtime add table public.group_messages;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'group_profiles'
     ) then
    alter publication supabase_realtime add table public.group_profiles;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'debt_reminders'
     ) then
    alter publication supabase_realtime add table public.debt_reminders;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'payment_notifications'
     ) then
    alter publication supabase_realtime add table public.payment_notifications;
  end if;
end $$;
