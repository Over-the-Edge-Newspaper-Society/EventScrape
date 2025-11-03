#!/usr/bin/env node
/**
 * Cleanup orphaned Instagram images
 *
 * This script removes images from the Docker volume that don't have
 * corresponding posts in the database.
 *
 * Usage: node cleanup-orphaned-images.js
 */

import { db } from './apps/api/src/db/connection.js';
import { eventsRaw } from './apps/api/src/db/schema.js';
import { isNotNull } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';

const INSTAGRAM_IMAGES_DIR = process.env.INSTAGRAM_IMAGES_DIR || './data/instagram_images';

async function main() {
  try {
    console.log('Fetching valid image paths from database...');

    // Get all local_image_path values from the database
    const dbImages = await db
      .select({ localImagePath: eventsRaw.localImagePath })
      .from(eventsRaw)
      .where(isNotNull(eventsRaw.localImagePath));

    const validImages = new Set(dbImages.map(row => row.localImagePath).filter(Boolean));
    console.log(`Found ${validImages.size} valid images in database`);

    // Get all image files from the directory
    const allFiles = await fs.readdir(INSTAGRAM_IMAGES_DIR);
    console.log(`Found ${allFiles.length} total image files`);

    // Find orphaned images
    const orphanedImages = allFiles.filter(filename => !validImages.has(filename));
    console.log(`Found ${orphanedImages.length} orphaned images to delete`);

    if (orphanedImages.length === 0) {
      console.log('No orphaned images to delete. Exiting.');
      return;
    }

    // Ask for confirmation
    console.log('\nOrphaned images (showing first 10):');
    orphanedImages.slice(0, 10).forEach(img => console.log(`  - ${img}`));
    if (orphanedImages.length > 10) {
      console.log(`  ... and ${orphanedImages.length - 10} more`);
    }

    console.log('\nDeleting orphaned images...');
    let deletedCount = 0;

    for (const filename of orphanedImages) {
      try {
        await fs.unlink(path.join(INSTAGRAM_IMAGES_DIR, filename));
        deletedCount++;
      } catch (error) {
        console.error(`Failed to delete ${filename}:`, error.message);
      }
    }

    console.log(`\nCleanup complete!`);
    console.log(`  Deleted: ${deletedCount} images`);
    console.log(`  Remaining: ${allFiles.length - deletedCount} images`);

  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
