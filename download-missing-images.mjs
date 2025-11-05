import postgres from 'postgres';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

const INSTAGRAM_IMAGES_DIR = process.env.INSTAGRAM_IMAGES_DIR || '/data/instagram_images';

// Ensure directory exists
if (!fs.existsSync(INSTAGRAM_IMAGES_DIR)) {
  fs.mkdirSync(INSTAGRAM_IMAGES_DIR, { recursive: true });
}

// Database connection - use DATABASE_URL if available, otherwise construct from parts
const sql = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL)
  : postgres({
      host: process.env.POSTGRES_HOST || 'postgres',
      port: Number(process.env.POSTGRES_PORT) || 5432,
      database: process.env.POSTGRES_DB || 'eventscrape',
      username: process.env.POSTGRES_USER || 'eventscrape',
      password: process.env.POSTGRES_PASSWORD || 'eventscrape_dev',
    });

/**
 * Check if URL is a direct Instagram CDN URL (which expire quickly)
 */
function isInstagramCDN(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes('cdninstagram.com');
  } catch {
    return false;
  }
}

async function downloadImage(imageUrl, postId) {
  // Skip direct Instagram CDN URLs - they expire and return 403
  // Only download Apify proxy URLs (images.apifyusercontent.com) which are stable
  if (isInstagramCDN(imageUrl)) {
    console.log(`  ⊘ Skipping expired Instagram CDN URL`);
    return null;
  }

  try {
    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    // Extract extension from URL or use jpg as default
    const urlPath = new URL(imageUrl).pathname;
    const ext = path.extname(urlPath) || '.jpg';
    const filename = `${postId}${ext}`;
    const filepath = path.join(INSTAGRAM_IMAGES_DIR, filename);

    // Save the image
    await pipeline(response.data, fs.createWriteStream(filepath));

    return filename;
  } catch (error) {
    console.error(`Failed to download image for post ${postId}:`, error.message);
    return null;
  }
}

async function main() {
  console.log('Starting image download for existing posts...');

  // Get posts without local images
  const posts = await sql`
    SELECT id, instagram_post_id, image_url
    FROM events_raw
    WHERE instagram_post_id IS NOT NULL
      AND image_url IS NOT NULL
      AND (local_image_path IS NULL OR local_image_path = '')
    ORDER BY scraped_at DESC
  `;

  console.log(`Found ${posts.length} posts that need images downloaded`);

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    console.log(`[${i + 1}/${posts.length}] Downloading image for post ${post.instagram_post_id}...`);

    const filename = await downloadImage(post.image_url, post.instagram_post_id);

    if (filename) {
      // Update database with local path
      await sql`
        UPDATE events_raw
        SET local_image_path = ${filename}
        WHERE id = ${post.id}
      `;
      successCount++;
      console.log(`  ✓ Saved as ${filename}`);
    } else {
      failCount++;
      console.log(`  ✗ Failed to download`);
    }

    // Small delay to avoid rate limiting
    if (i < posts.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log('\nDownload complete!');
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);

  await sql.end();
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
