create table if not exists public.podcast_episodes (
  user_id uuid not null references auth.users (id) on delete cascade,
  episode_id text not null,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, episode_id)
);

alter table public.podcast_episodes enable row level security;

grant select, insert, update, delete on public.podcast_episodes to authenticated;

drop policy if exists "Users can read their own episodes" on public.podcast_episodes;
create policy "Users can read their own episodes"
on public.podcast_episodes
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can insert their own episodes" on public.podcast_episodes;
create policy "Users can insert their own episodes"
on public.podcast_episodes
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can update their own episodes" on public.podcast_episodes;
create policy "Users can update their own episodes"
on public.podcast_episodes
for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can delete their own episodes" on public.podcast_episodes;
create policy "Users can delete their own episodes"
on public.podcast_episodes
for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.touch_podcast_episodes_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists podcast_episodes_set_updated_at on public.podcast_episodes;
create trigger podcast_episodes_set_updated_at
before update on public.podcast_episodes
for each row
execute function public.touch_podcast_episodes_updated_at();

create table if not exists public.podcast_generation_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  episode_id text not null,
  chunk_index integer not null check (chunk_index >= 0),
  usage_category text not null check (usage_category in ('podcast_audio', 'summary_audio')),
  provider text not null,
  model text not null,
  response_id text,
  input_tokens integer not null check (input_tokens >= 0),
  output_tokens integer not null check (output_tokens >= 0),
  total_tokens integer not null check (total_tokens >= 0),
  input_cost_usd numeric(16, 10) not null check (input_cost_usd >= 0),
  output_cost_usd numeric(16, 10) not null check (output_cost_usd >= 0),
  total_cost_usd numeric(16, 10) not null check (total_cost_usd >= 0),
  pricing jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists podcast_generation_usage_episode_idx
on public.podcast_generation_usage (user_id, episode_id, created_at);

create unique index if not exists podcast_generation_usage_response_id_idx
on public.podcast_generation_usage (user_id, response_id)
where response_id is not null;

alter table public.podcast_generation_usage enable row level security;

grant select, insert on public.podcast_generation_usage to authenticated;

drop policy if exists "Users can read their own generation usage" on public.podcast_generation_usage;
create policy "Users can read their own generation usage"
on public.podcast_generation_usage
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can insert their own generation usage" on public.podcast_generation_usage;
create policy "Users can insert their own generation usage"
on public.podcast_generation_usage
for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create table if not exists public.podcast_demo_rate_limits (
  client_key text primary key,
  window_started_at timestamptz not null default timezone('utc', now()),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.podcast_demo_rate_limits enable row level security;

create or replace function public.claim_public_demo_generation(
  p_client_key text,
  p_max_requests integer default 1,
  p_window_seconds integer default 86400
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_limit public.podcast_demo_rate_limits%rowtype;
begin
  if p_client_key is null or length(p_client_key) < 10 or p_max_requests < 1 or p_window_seconds < 60 then
    return false;
  end if;

  insert into public.podcast_demo_rate_limits (client_key, request_count)
  values (p_client_key, 0)
  on conflict (client_key) do nothing;

  select *
  into current_limit
  from public.podcast_demo_rate_limits
  where client_key = p_client_key
  for update;

  if current_limit.window_started_at <= timezone('utc', now()) - make_interval(secs => p_window_seconds) then
    update public.podcast_demo_rate_limits
    set window_started_at = timezone('utc', now()),
        request_count = 1,
        updated_at = timezone('utc', now())
    where client_key = p_client_key;
    return true;
  end if;

  if current_limit.request_count < p_max_requests then
    update public.podcast_demo_rate_limits
    set request_count = request_count + 1,
        updated_at = timezone('utc', now())
    where client_key = p_client_key;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.claim_public_demo_generation(text, integer, integer) from public;
grant execute on function public.claim_public_demo_generation(text, integer, integer) to anon, authenticated;

insert into storage.buckets (id, name, public)
values ('Audio', 'Audio', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Users can read their own audio files" on storage.objects;
create policy "Users can read their own audio files"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'Audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can upload their own audio files" on storage.objects;
create policy "Users can upload their own audio files"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'Audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can update their own audio files" on storage.objects;
create policy "Users can update their own audio files"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'Audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'Audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete their own audio files" on storage.objects;
create policy "Users can delete their own audio files"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'Audio'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
