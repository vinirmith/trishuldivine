-- Adds the 7 new gemstone bracelet photos (images/Bracelet/*.JPG) as products.
-- Run this once in the Supabase SQL editor after schema.sql has already been run.
-- Prices are dummy placeholders — edit them (or the description/images) any time
-- from the admin panel at admin.html.

insert into public.products (name, description, price, category, sizes, images, in_stock)
values
  ('Azurite Bracelet', 'Deep blue Azurite bracelet, prized for calm focus and quiet reflection.', 1350, 'bracelets', array['Free size'], array['images/Bracelet/azurite.jpg'], true),
  ('Black Obsidian Bracelet', 'Black Obsidian bracelet, a grounding volcanic-glass stone often used for protection.', 1200, 'bracelets', array['Free size'], array['images/Bracelet/black-obsidian.jpg'], true),
  ('Green Tiger Eye Bracelet', 'Green Tiger Eye bracelet with a silky shimmer, linked to confidence and clarity.', 1500, 'bracelets', array['Free size'], array['images/Bracelet/green-tiger-eye.jpg'], true),
  ('Natural Citrine Bracelet', 'Natural Citrine bracelet, golden quartz associated with positivity and abundance.', 1600, 'bracelets', array['Free size'], array['images/Bracelet/natural-citrine.jpg'], true),
  ('Pink Tiger Eye Bracelet', 'Pink Tiger Eye bracelet, a gentle rose-toned stone for calm and warmth.', 1450, 'bracelets', array['Free size'], array['images/Bracelet/pink-tiger-eye.jpg'], true),
  ('Red Tiger Eye Bracelet', 'Red Tiger Eye bracelet, a bold reddish stone linked to vitality and courage.', 1450, 'bracelets', array['Free size'], array['images/Bracelet/red-tiger-eye.jpg'], true),
  ('Selenite Bracelet', 'Selenite bracelet, a translucent white crystal known for its calming, cleansing energy.', 1300, 'bracelets', array['Free size'], array['images/Bracelet/selenite.jpg'], true);
