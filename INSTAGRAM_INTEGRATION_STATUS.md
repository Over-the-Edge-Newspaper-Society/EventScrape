# Instagram Integration - Implementation Status

## ✅ Completed (Phase 1: Database & Core Logic)

### 1. Database Schema Changes
- **File**: `apps/api/src/db/schema.ts`
- Added `sourceTypeEnum` ('website' | 'instagram')
- Added `classificationModeEnum` ('manual' | 'auto')
- Extended `sources` table with Instagram fields:
  - `sourceType`, `instagramUsername`, `classificationMode`, `lastChecked`
- Extended `eventsRaw` table with Instagram metadata:
  - `instagramPostId`, `instagramCaption`, `localImagePath`
  - `classificationConfidence`, `isEventPoster`
- Created `instagramSessions` table for auth
- Added TypeScript types for all new tables

### 2. Database Migration
- **File**: `apps/api/src/db/migrations/0011_instagram_integration.sql`
- Creates enums and adds columns with proper indexes
- Ready to run with `pnpm db:migrate`

### 3. Gemini Extraction Module
- **Files**:
  - `worker/src/modules/instagram/gemini-extractor.ts`
  - `worker/src/modules/instagram/gemini-prompt.md`
- Full TypeScript port of Python extraction logic
- Supports image buffer + file path extraction
- Includes caption and timestamp context
- Proper error handling and typing

---

## 🚧 In Progress / Remaining

### 4. Instagram Scraper Module
- **Location**: `worker/src/modules/instagram/scraper.ts`
- **Todo**:
  - Install `instagram-private-api` package
  - Port Instaloader logic to TypeScript
  - Implement rate limiting & backoff
  - Session file support

### 5. Classification Module
- **Location**: `worker/src/modules/instagram/classifier.ts`
- **Todo**:
  - Port keyword-based classifier
  - Simple regex for event indicators
  - Return boolean + confidence score

### 6. API Routes
- **Location**: `apps/api/src/routes/instagram-sources.ts`
- **Todo**:
  - CRUD endpoints for Instagram sources
  - Manual fetch trigger
  - Session upload/management

### 7. Worker Job Handler
- **Location**: `worker/src/modules/instagram/instagram-job.ts`
- **Todo**:
  - BullMQ job handler
  - Orchestrate: fetch → classify → extract → store

### 8. Admin UI
- **Location**: `apps/admin/src/pages/InstagramSources.tsx`
- **Todo**:
  - Table of Instagram accounts
  - Add/edit/delete UI
  - Session file upload component
  - Manual fetch button

### 9. Dependencies
- **Todo**:
  - Add to `worker/package.json`:
    - `instagram-private-api`
    - `@google/generative-ai`
  - Add to `apps/api/package.json`:
    - `@google/generative-ai` (if API needs it)

### 10. Cleanup
- **Todo**:
  - Remove `apps/api/src/routes/poster-import.ts`
  - Remove poster import UI references
  - Update navigation

---

## Next Steps

1. **Add dependencies** to package.json files
2. **Create Instagram scraper** module
3. **Create classifier** module
4. **Build API routes** for Instagram sources
5. **Create worker job handler**
6. **Build admin UI** components
7. **Run migration** and test end-to-end

---

## Migration Command

```bash
cd /Users/ahmadjalil/Github/EventScrape
pnpm db:migrate
```

---

## Environment Variables Needed

```bash
GEMINI_API_KEY=your_key_here
INSTAGRAM_SESSION_PATH=/data/instagram_sessions  # Optional
```
