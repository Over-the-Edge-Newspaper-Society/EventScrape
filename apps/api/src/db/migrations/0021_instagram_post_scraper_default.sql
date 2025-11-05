ALTER TABLE instagram_settings
  ALTER COLUMN apify_actor_id SET DEFAULT 'apify/instagram-post-scraper';

UPDATE instagram_settings
SET apify_actor_id = 'apify/instagram-post-scraper'
WHERE apify_actor_id IS NULL
   OR apify_actor_id = ''
   OR apify_actor_id = 'apify/instagram-profile-scraper';
