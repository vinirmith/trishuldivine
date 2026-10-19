-- Run once in the Supabase SQL editor: renames the existing "chains" category to "mala".
update public.products set category = 'mala' where category = 'chains';
