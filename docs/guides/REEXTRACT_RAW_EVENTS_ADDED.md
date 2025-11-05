# Re-Extract Button Added to Raw Events Page! ✨

## Summary

**YES!** The re-extract button is now available in the Raw Events page for all Instagram events.

## What Was Added

### Enhanced EventTable Component
**File:** [apps/admin/src/components/events/EventTable.tsx](file:///Users/ahmadjalil/Github/EventScrape/apps/admin/src/components/events/EventTable.tsx)

**New Features:**
1. ✅ `extractMutation` - Handles re-extraction API calls
2. ✅ `handleReExtract` - Extraction trigger function
3. ✅ `isInstagramEvent` - Checks if event source is Instagram
4. ✅ `hasLocalImage` - Checks if image is downloaded
5. ✅ `hasExtractedData` - Checks if already extracted
6. ✅ `renderReExtractButton` - Conditional button rendering
7. ✅ Loading state tracking with `extractingIds`

## Button Visibility Logic

The re-extract button **only appears** when:
```typescript
✅ Event is from Instagram source (sourceType === 'instagram')
✅ Event has a downloaded local image (localImagePath exists)
```

## Two Button States

### 1. Not Yet Extracted (First-time extraction)
```
┌──────────────────────────────────┐
│ ✨ Extract                        │
└──────────────────────────────────┘
```
- Purple-to-blue gradient button
- Sparkles icon
- Text: "Extract"
- Tooltip: "Extract event data with Gemini AI"

### 2. Already Extracted (Re-extraction)
```
┌──────────────────────────────────┐
│ ✨ Re-extract                     │
└──────────────────────────────────┘
```
- Outline button (subtle styling)
- Sparkles icon
- Text: "Re-extract"
- Tooltip: "Re-extract event data with Gemini AI"

### 3. Loading State
```
┌──────────────────────────────────┐
│ ⏳ Extract                        │
└──────────────────────────────────┘
```
- Spinning loader
- Button disabled
- Works independently for each event

## Visual Layout

The button appears in the **Actions column** alongside existing buttons:

```
┌─────────────────────────────────────────────────────────────┐
│  Raw Events Table                                            │
│                                                              │
│  Event  │  Date/Time  │  Location  │  Source  │  Actions   │
│  ─────────────────────────────────────────────────────────  │
│  Post   │  Jan 15     │  Vancouver │ Instagram │            │
│  Title  │  2:00 PM    │  BC        │           │            │
│         │             │            │           │ ┌─────────┐│
│         │             │            │           │ │✨Extract││  ← NEW!
│         │             │            │           │ └─────────┘│
│         │             │            │           │ Details    │
│         │             │            │           │ Original   │
└─────────────────────────────────────────────────────────────┘
```

## User Flow

### From Raw Events Page

```
1. Navigate to Raw Events page
   http://localhost:3000/raw-events
   ↓
2. Filter by Instagram source (optional)
   ↓
3. Find Instagram event in table
   ↓
4. See "Extract" or "Re-extract" button in Actions column
   ↓
5. Click button
   ↓
6. Button shows spinner during processing (~5-10 seconds)
   ↓
7. Toast notification shows success/error
   ↓
8. Table refreshes with updated data
   ↓
9. Button changes to "Re-extract" if successful
```

## Toast Notifications

### Success
```
✅ Extracted 2 event(s) from post
   Created 2 event record(s)
```

### Errors

#### No Gemini Key
```
❌ Gemini API key not configured
   Configure in Instagram Settings
```

#### No Image
```
❌ Post does not have a downloaded image
```

#### General Error
```
❌ Failed to extract event data
   [Error message]
```

## Features

### Intelligent Button Rendering
- Only shows for Instagram events
- Hides if no local image
- Shows different text based on extraction status
- Different styling for first-time vs re-extract

### Independent Loading States
- Each event tracks its own loading state
- Multiple extractions can run simultaneously
- Doesn't block other table interactions

### Automatic Refresh
- Table data refreshes after extraction
- Shows updated Gemini data immediately
- Maintains scroll position and filters

### Error Handling
- Helpful error messages
- Doesn't crash on failures
- Clears loading state on error

## Integration with Existing Features

### Works With Table Features
- ✅ Sorting (doesn't interfere)
- ✅ Filtering (button only shows for Instagram)
- ✅ Pagination (state persists across pages)
- ✅ Selection (doesn't affect checkboxes)
- ✅ Bulk actions (independent)

### Respects Gemini Data Display
The table already displays Gemini-extracted data when available:
- Title from Gemini
- Dates/times from Gemini
- Category, organizer, price from Gemini
- Re-extracting updates all these fields

## Code Architecture

### Component Structure
```typescript
EventTable
  ├─ extractMutation (React Query)
  ├─ extractingIds (Loading state)
  ├─ handleReExtract (Handler)
  ├─ isInstagramEvent (Check)
  ├─ hasLocalImage (Check)
  ├─ hasExtractedData (Check)
  └─ renderReExtractButton (Render)
```

### API Flow
```
Click Button
  ↓
handleReExtract(eventId)
  ↓
extractMutation.mutate({ id, overwrite: true })
  ↓
POST /api/instagram-review/:id/extract
  ↓
Gemini processes image
  ↓
Database updated
  ↓
Toast notification
  ↓
Table refreshes
```

## Comparison: Review Page vs Raw Events Page

| Feature | Review Page | Raw Events Page |
|---------|-------------|-----------------|
| **Shows Instagram only** | Yes | No (all sources) |
| **Extraction button** | ✅ Yes | ✅ Yes (NEW!) |
| **Filtering** | By classification | By source/date/city |
| **Sorting** | Date only | Title/Date/City/Source |
| **Bulk actions** | No | Yes (export, delete) |
| **Image preview** | Large | No |
| **Use case** | Review & classify | Manage all events |

## Testing

### Manual Test Steps

1. **Start application:**
   ```bash
   cd apps/admin
   pnpm dev
   ```

2. **Navigate to Raw Events:**
   ```
   http://localhost:3000/raw-events
   ```

3. **Filter to Instagram:**
   - Use source filter dropdown
   - Select your Instagram source

4. **Test extraction:**
   - Find event with "Extract" button
   - Click it
   - Wait for spinner to complete
   - Verify toast notification
   - Check button changes to "Re-extract"

5. **Test re-extraction:**
   - Click "Re-extract" on same event
   - Verify it overwrites existing data
   - Check toast notification

6. **Test multiple simultaneous:**
   - Click "Extract" on multiple events quickly
   - Verify each has independent spinner
   - Verify all complete successfully

## Edge Cases Handled

### Non-Instagram Events
- Button doesn't appear
- No confusion for users
- Clean UI

### Events Without Images
- Button doesn't appear
- Prevents API errors
- Clear requirements

### Already Extracted Events
- Button changes to "Re-extract"
- Outline styling (less prominent)
- User understands it's optional

### API Errors
- Loading state clears
- Error toast appears
- Button remains clickable for retry

## Files Modified

1. **[EventTable.tsx](file:///Users/ahmadjalil/Github/EventScrape/apps/admin/src/components/events/EventTable.tsx)** - Added re-extract button
   - New imports: `useState`, `useMutation`, `useQueryClient`, `Sparkles`, `Loader2`, `toast`
   - New state: `extractingIds`
   - New mutation: `extractMutation`
   - New functions: `handleReExtract`, `isInstagramEvent`, `hasLocalImage`, `hasExtractedData`, `renderReExtractButton`
   - Modified Actions column to include button

## API Endpoint Used

**Endpoint:** `POST /api/instagram-review/:id/extract`

**Already existed** - just added UI integration!

**Request:**
```json
{
  "overwrite": true,
  "createEvents": true
}
```

**Response:**
```json
{
  "success": true,
  "message": "Extracted 2 event(s) from post",
  "extraction": { ... },
  "eventsCreated": 2
}
```

## Related Documentation

- [Pipeline Flow](./INSTAGRAM_PIPELINE_FLOW.md) - When extraction occurs
- [Extraction Guide](./INSTAGRAM_EXTRACTION_GUIDE.md) - Complete guide
- [Extraction UI](./EXTRACTION_UI_FEATURE_ADDED.md) - Review page feature

## Before & After

### Before
- ❌ No way to extract from Raw Events page
- ❌ Had to go to Review page
- ❌ Couldn't re-extract existing events in bulk view
- ❌ No extraction status in table

### After
- ✅ One-click extraction from Raw Events
- ✅ Works on any Instagram event
- ✅ Re-extraction support
- ✅ Visual button states
- ✅ Independent loading for each event
- ✅ Toast notifications
- ✅ Automatic table refresh

## Summary

**Your Question:** "are we able to add the reextract button in the raw events page for the events that are from instagram?"

**Answer:** YES! ✅ It's done!

The re-extract button now appears in the Raw Events page for ALL Instagram events that have downloaded images. You can:

- Extract event data with one click
- Re-extract to update/improve existing data
- Process multiple events independently
- See clear visual feedback with loading states
- Get helpful error messages

**Works in both places:**
1. Instagram Review page (for classification workflow)
2. Raw Events page (for managing all events)

**Files Modified:**
- [apps/admin/src/components/events/EventTable.tsx](file:///Users/ahmadjalil/Github/EventScrape/apps/admin/src/components/events/EventTable.tsx)

Ready to use! 🚀
