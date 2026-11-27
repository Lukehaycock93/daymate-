-- Where an appointment takes place (free text address). Used for the Google / Apple Maps buttons.
alter table public.appointments add column if not exists location text check (location is null or char_length(location) <= 200);
alter table public.reminders    add column if not exists location text check (location is null or char_length(location) <= 200);
