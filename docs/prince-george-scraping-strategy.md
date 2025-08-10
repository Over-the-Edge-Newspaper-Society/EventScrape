# Prince George Events Scraping Strategy

## Overview
The City of Prince George events calendar presents a complex but valuable data source with multiple challenges that our scraper handles intelligently.

## Data Source Analysis

### 1. Calendar List View (Main Page)
**URL**: `https://www.princegeorge.ca/community-culture/events/events-calendar`

**Structure**:
- Uses FullCalendar JavaScript widget
- Two view modes: Month grid and **List view** (we use list view)
- Events organized by date headings
- Each event shows: time range, title, and link to detail page

**Sample Calendar Entry**:
```html
<tr class="fc-list-heading" data-date="2025-08-01">
  <td class="fc-widget-header" colspan="3">
    <span class="fc-list-heading-main">August 1, 2025</span>
    <span class="fc-list-heading-alt">Friday</span>
  </td>
</tr>
<tr class="fc-list-item fc-has-url">
  <td class="fc-list-item-time fc-widget-content">11:00am - 3:00pm</td>
  <td class="fc-list-item-marker fc-widget-content">
    <span class="fc-event-dot" style="background-color:#003a79"></span>
  </td>
  <td class="fc-list-item-title fc-widget-content">
    <a href="/community-culture/arts-events/events-calendar/foodie-fridays">Foodie Fridays</a>
  </td>
</tr>
```

### 2. Event Detail Pages (Sub-pages)
**URL Pattern**: `/community-culture/arts-events/events-calendar/{event-slug}`

**Key Challenge**: **Recurring Events with Multiple Dates**

Many events (like Foodie Fridays) occur on multiple dates and are represented as a single event with multiple date instances:

```html
<div class="field field--name-field-when field--type-smartdate field--label-hidden field__items">
  <div class="field__item">
    <time datetime="2025-07-04T11:00:00-07:00" class="datetime">Fri, Jul 4 2025, 11am</time> - 
    <time datetime="2025-07-04T15:00:00-07:00" class="datetime">3pm</time>
  </div>
  <div class="field__item">
    <time datetime="2025-07-18T11:00:00-07:00" class="datetime">Fri, Jul 18 2025, 11am</time> - 
    <time datetime="2025-07-18T15:00:00-07:00" class="datetime">3pm</time>
  </div>
  <div class="field__item">
    <time datetime="2025-08-01T11:00:00-07:00" class="datetime">Fri, Aug 1 2025, 11am</time> - 
    <time datetime="2025-08-01T15:00:00-07:00" class="datetime">3pm</time>
  </div>
  <!-- ... more dates ... -->
</div>
```

## Scraping Strategy

### Phase 1: Calendar Discovery
1. **Navigate to calendar page**
2. **Ensure list view is active** (click list button if needed)
3. **Wait for FullCalendar to render** (`.fc-list-table` selector)
4. **Extract all event links** with their basic info:
   - Event title
   - Calendar display time (may be approximate)
   - Calendar date
   - Link to detail page

### Phase 2: Event Detail Extraction
For each event link discovered:

1. **Navigate to detail page**
2. **Extract comprehensive event data**:
   - **Multiple date instances** (recurring events)
   - **Precise ISO timestamps** with timezone
   - **Event classification** (Civic Centre Event, Special Events, etc.)
   - **Location details** (venue name, implicit city/province/country)
   - **Rich description** (HTML content with vendors, entertainment, etc.)
   - **Event images** and promotional content
   - **Contact information** (organizer details)

3. **Create separate event records** for each date instance

## Data Normalization Challenges

### 1. Multiple Date Formats
We handle various date/time representations:

**Calendar View**: `"11:00am - 3:00pm"`
**Detail Page**: `datetime="2025-08-01T11:00:00-07:00"`
**Human Readable**: `"Fri, Aug 1 2025, 11am"`

**Our Solution**: Prioritize precise ISO timestamps from detail pages, fallback to calendar data if unavailable.

### 2. Recurring Events
**Challenge**: One event page represents multiple occurrences
**Solution**: Create separate event records for each date instance while preserving shared metadata

**Example Output**:
```json
[
  {
    "title": "Foodie Fridays",
    "start": "2025-07-04T11:00:00-07:00",
    "end": "2025-07-04T15:00:00-07:00",
    "venueName": "Canada Games Plaza",
    "city": "Prince George",
    "region": "British Columbia",
    "country": "Canada",
    "organizer": "City of Prince George",
    "category": "Civic Centre Event",
    "tags": ["Special Events"],
    "url": "https://www.princegeorge.ca/.../foodie-fridays"
  },
  {
    "title": "Foodie Fridays",
    "start": "2025-07-18T11:00:00-07:00",
    "end": "2025-07-18T15:00:00-07:00",
    // ... same metadata, different date
  }
]
```

### 3. Event Classification
**Primary Type**: `.field--name-field-types .field__item` (e.g., "Civic Centre Event")
**Secondary Type**: `.field--name-field-types2 .field__item` (e.g., "Special Events")

**Our Mapping**:
- `category` = Primary type
- `tags` = Secondary types (array)

### 4. Location Normalization
**Venue**: Extracted from location field
**City**: Always "Prince George" (implicit)
**Region**: Always "British Columbia" (implicit)
**Country**: Always "Canada" (implicit)
**Organizer**: Always "City of Prince George" (implicit)

## Error Handling & Resilience

### 1. Calendar Loading Issues
- Wait up to 15 seconds for FullCalendar
- Retry with different selectors if initial load fails
- Fallback to month view if list view unavailable

### 2. Detail Page Failures
- Continue with remaining events if one fails
- Create fallback event record from calendar data
- Log warnings for failed extractions

### 3. Rate Limiting
- 2-second delays between requests (with 50% jitter)
- Respect the City's servers with polite crawling
- Exponential backoff for failures

## Expected Output

### Quantity
- **30-50 events per month** typically displayed
- **Multiple instances** for recurring events
- **100+ total event records** after expanding recurring events

### Quality Metrics
- **✅ Rich metadata**: Types, locations, descriptions
- **✅ Precise timestamps**: ISO format with timezone
- **✅ Full provenance**: Source URLs for every event
- **✅ Media assets**: Event images and promotional content
- **✅ Categorization**: Event types for filtering/organization

## Technical Implementation

### Key Selectors
```typescript
// Calendar list items
'.fc-list-item': Event rows
'.fc-list-item-title a': Event links
'.fc-list-item-time': Time display
'.fc-list-heading-main': Date headings

// Detail page fields
'.field--name-field-when .field__item time[datetime]': Precise timestamps
'.field--name-field-types .field__item': Event type
'.field--name-field-contact-information .field__item': Location
'.field--name-body .field__item': Description
'.field--name-field-media-image img': Event image
```

### Data Flow
1. **Calendar Parsing** → Event URLs + Basic Info
2. **Detail Extraction** → Rich Metadata + Multiple Dates  
3. **Normalization** → Standardized Event Records
4. **Database Storage** → Full Attribution + Duplicate Detection

This strategy ensures we capture the full richness of Prince George's event data while handling the complex recurring event formats and maintaining data quality throughout the process.