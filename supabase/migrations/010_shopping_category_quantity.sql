-- Shopping list: an aisle/category and a free-text quantity for each item ("2", "500g", "2 litres").
-- Additive and safe: existing rows get category 'other' and an empty quantity; older app versions that don't send
-- these fields keep working (the defaults apply and their updates leave the new columns untouched).
alter table public.shopping_items
  add column if not exists category text not null default 'other'
    check (category in ('produce','dairy','bakery','meat','frozen','pantry','drinks','household','health','other'));
alter table public.shopping_items
  add column if not exists quantity text not null default ''
    check (char_length(quantity) <= 30);
