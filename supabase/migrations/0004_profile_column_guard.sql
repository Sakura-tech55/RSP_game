-- Column-level guard for client-side profile edits.
--
-- `profiles_update_own` lets a signed-in player update their own row with the
-- anon key, but a row policy alone covers every column — including `credits`,
-- `is_guest`, and `deleted_at`, and it skips the server's display-name rules.
-- Only presentation fields are client-editable; everything else is written by
-- the service role, which these grants do not affect.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_seed, champion_key) on public.profiles to authenticated;

-- New-user trigger, revised:
--   * Guests are anonymous Supabase users (see lib/auth/session.js); mark
--     their profile as such from the moment it is created.
--   * The email's local part is only a usable display name when it satisfies
--     `display_name_length` (2-24 chars). Before, a one-character or very long
--     local part violated the check and aborted the sign-up itself.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  base text := left(coalesce(split_part(new.email, '@', 1), ''), 24);
begin
  insert into public.profiles (id, display_name, email, avatar_seed, is_guest)
  values (
    new.id,
    case when char_length(base) >= 2 then base else 'Challenger' end,
    new.email,
    new.id::text,
    coalesce(new.is_anonymous, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;
