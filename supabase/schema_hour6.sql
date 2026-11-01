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
drop policy if exists "see my memberships"    on group_members;
drop policy if exists "join groups"           on group_members;
drop policy if exists "leave groups"          on group_members;
drop policy if exists "see group expenses"    on expenses;
drop policy if exists "add group expenses"    on expenses;
drop policy if exists "delete group expenses" on expenses;

create policy "see my groups"      on groups for select using (is_group_member(id));
create policy "create groups"      on groups for insert with check (auth.uid() = created_by);

create policy "see my memberships" on group_members for select using (user_id = auth.uid());
create policy "join groups"        on group_members for insert with check (user_id = auth.uid());
create policy "leave groups"       on group_members for delete using (user_id = auth.uid());

create policy "see group expenses"    on expenses for select using (is_group_member(group_id));
create policy "add group expenses"    on expenses for insert with check (is_group_member(group_id));
create policy "delete group expenses" on expenses for delete using (is_group_member(group_id));

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

create policy "see group messages" on group_messages
  for select using (is_group_member(group_id));
create policy "send group messages" on group_messages
  for insert with check (user_id = auth.uid() and is_group_member(group_id));

revoke all on group_messages from anon, authenticated;
grant select, insert on group_messages to authenticated;

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
end $$;
