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
