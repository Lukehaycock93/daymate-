-- Home town for Daymate AI weather answers. Set by the person (name + coordinates from a town search).
-- Only a town name and rounded coordinates are stored: never a street address.
alter table public.user_preferences add column if not exists home_name text check (home_name is null or char_length(home_name) <= 80);
alter table public.user_preferences add column if not exists home_lat  double precision check (home_lat between -90 and 90);
alter table public.user_preferences add column if not exists home_lon  double precision check (home_lon between -180 and 180);
