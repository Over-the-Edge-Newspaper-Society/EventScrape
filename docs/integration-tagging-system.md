# Integration Tagging System Documentation

## Overview

The EventScrape application uses a flexible tagging system to categorize different scraper modules based on their integration methods and capabilities. This system allows the UI to dynamically adapt and provide appropriate configuration options for each source.

## Core Concepts

### Integration Tags
Each scraper module can have multiple integration tags that describe how it interacts with the target website:

- `calendar` - Calendar-based interface with date range selection
- `csv` - CSV/spreadsheet data processing capability  
- `page-navigation` - Traditional pagination through multiple pages
- `api` - REST API integration (future use)
- `rss` - RSS/XML feed processing (future use)

### Pagination Types
The pagination type determines the primary scraping method:

- `'page'` - Page-based pagination with numbered pages
- `'calendar'` - Calendar-based with date range filtering
- `'none'` - Single page scraping without pagination

## Implementation Structure

### Type Definitions

```typescript
export interface ScraperModule {
  key: string;               
  label: string;             
  startUrls: string[];       
  mode?: 'scrape' | 'upload' | 'hybrid'; 
  paginationType?: 'page' | 'calendar' | 'none'; 
  integrationTags?: ('calendar' | 'csv' | 'page-navigation' | 'api' | 'rss')[]; 
  uploadConfig?: {
    supportedFormats: ('csv' | 'json' | 'xlsx')[];
    instructions?: string;    
    downloadUrl?: string;      
  };
  run(ctx: RunContext): Promise<RawEvent[]>; 
  processUpload?(content: string, format: 'csv' | 'json' | 'xlsx', logger: any): Promise<RawEvent[]>;
}
```

### Module Examples

#### Single Tag Module (Calendar Only)
```typescript
const tourismPgModule: ScraperModule = {
  key: 'tourismpg_com',
  label: 'Tourism Prince George Events',
  paginationType: 'calendar',
  integrationTags: ['calendar'], // Single tag
  // ... other config
};
```

#### Multi-Tag Module (Calendar + CSV)
```typescript
const unbcTimberwolvesModule: ScraperModule = {
  key: 'unbctimberwolves_com',
  label: 'UNBC Timberwolves Athletics',
  mode: 'hybrid',
  paginationType: 'calendar',
  integrationTags: ['calendar', 'csv'], // Multiple tags
  uploadConfig: {
    supportedFormats: ['csv'],
    instructions: '...',
  },
  // ... other config
};
```

#### Page-Based Module
```typescript
const unbcModule: ScraperModule = {
  key: 'unbc_ca',
  label: 'University of Northern British Columbia Events',
  paginationType: 'page',
  integrationTags: ['page-navigation'], // Page-based only
  // ... other config
};
```

## UI Behavior Mapping

### Tag-Based UI Components

The admin interface dynamically renders components based on integration tags:

#### Calendar Tag (`calendar`)
- **UI Elements**: Date range pickers, preset time range buttons
- **Controls**: Start date, end date, quick presets (Last Week, Last Month, etc.)
- **Badge**: Green badge with calendar icon
- **Functionality**: Filters events by date range

#### CSV Tag (`csv`)  
- **UI Elements**: File upload input, textarea for content pasting
- **Controls**: File picker, manual content paste, download instructions
- **Badge**: Orange badge with spreadsheet icon
- **Functionality**: Processes uploaded CSV data directly

#### Page Navigation Tag (`page-navigation`)
- **UI Elements**: Page limit controls, "scrape all pages" toggle
- **Controls**: Max pages input, scrape all pages switch
- **Badge**: Blue badge with layers icon
- **Functionality**: Navigates through paginated results

### Dynamic UI Logic

```typescript
// Tag detection
const getModuleIntegrationTags = (moduleKey: string): string[] => {
  const integrationTagsMap: Record<string, string[]> = {
    'tourismpg_com': ['calendar'],
    'unbctimberwolves_com': ['calendar', 'csv'],
    'unbc_ca': ['page-navigation'],
  }
  return integrationTagsMap[moduleKey] || []
}

// Upload capability detection
const moduleSupportsUpload = (moduleKey: string): boolean => {
  const tags = getModuleIntegrationTags(moduleKey)
  return tags.includes('csv')
}

// Pagination type detection
const getSourcePaginationType = (moduleKey: string): 'page' | 'calendar' | 'none' => {
  const paginationMap: Record<string, 'page' | 'calendar' | 'none'> = {
    'tourismpg_com': 'calendar',
    'unbctimberwolves_com': 'calendar', 
    'unbc_ca': 'page',
  }
  return paginationMap[moduleKey] || 'none'
}
```

## Run Mode Selection

### Hybrid Modules (Multiple Integration Methods)

For modules with multiple tags (e.g., `['calendar', 'csv']`), the UI presents run mode options:

1. **Scrape from Website Mode**
   - Uses the primary pagination type (`calendar` or `page`)
   - Shows appropriate controls (date pickers or page limits)
   - Scrapes data directly from the website

2. **Upload CSV File Mode**  
   - Bypasses website scraping entirely
   - Shows file upload interface and instructions
   - Processes uploaded data using `processUpload()` method

### Mode-Specific UI Rendering

```typescript
// Show run mode selection only for modules that support uploads
{currentModuleSupportsUpload && (
  <RadioGroup value={runMode} onValueChange={setRunMode}>
    <RadioGroupItem value="scrape" id="scrape-mode" />
    <Label>Scrape from Website</Label>
    
    <RadioGroupItem value="upload" id="upload-mode" />
    <Label>Upload CSV File</Label>
  </RadioGroup>
)}

// Conditional rendering based on run mode
{runMode === 'scrape' && /* Show pagination controls */}
{runMode === 'upload' && /* Show upload interface */}
```

## Badge System

### Visual Indicators
Each integration tag renders as a colored badge to quickly identify capabilities:

- **Calendar**: Green badge, calendar icon, "Calendar" text
- **CSV**: Orange badge, spreadsheet icon, "CSV" text  
- **Page Navigation**: Blue badge, layers icon, "Page Nav" text

### Badge Rendering Logic
```typescript
const renderIntegrationTags = (tags: string[]) => {
  return tags.map((tag) => {
    switch (tag) {
      case 'calendar':
        return <Badge className="bg-green-100 text-green-800">
          <Calendar className="h-3 w-3 mr-1" />Calendar</Badge>
      case 'csv':
        return <Badge className="bg-orange-100 text-orange-800">
          <FileSpreadsheet className="h-3 w-3 mr-1" />CSV</Badge>
      case 'page-navigation':
        return <Badge className="bg-blue-100 text-blue-800">
          <Layers className="h-3 w-3 mr-1" />Page Nav</Badge>
    }
  })
}
```

## Data Flow

### Scrape Mode Data Flow
```
User selects source → UI detects tags → Shows appropriate controls → 
User configures options → API receives pagination/date options → 
Module executes with configuration → Returns scraped events
```

### Upload Mode Data Flow  
```
User selects source → UI detects CSV tag → Shows upload interface →
User uploads file → File content read → API receives upload data →
Module processUpload() method executes → Returns processed events
```

### API Integration
The job data structure supports both modes:

```typescript
interface ScrapeJobData {
  sourceId: string;
  runId: string;
  scrapeMode?: 'full' | 'incremental';
  
  // For scrape mode
  paginationOptions?: {
    type: 'page' | 'calendar';
    scrapeAllPages?: boolean;
    maxPages?: number;
    startDate?: string;
    endDate?: string;
  };
  
  // For upload mode
  uploadedFile?: {
    format: 'csv' | 'json' | 'xlsx';
    content: string;
    path: string;
  };
}
```

## Extension Guidelines

### Adding New Integration Tags

1. **Define the tag** in the type system:
   ```typescript
   integrationTags?: ('calendar' | 'csv' | 'page-navigation' | 'api' | 'rss' | 'NEW_TAG')[];
   ```

2. **Add tag mapping** in UI functions:
   ```typescript
   const integrationTagsMap: Record<string, string[]> = {
     'new_module': ['NEW_TAG'],
   }
   ```

3. **Create badge rendering**:
   ```typescript
   case 'NEW_TAG':
     return <Badge className="bg-purple-100 text-purple-800">
       <Icon className="h-3 w-3 mr-1" />New Feature</Badge>
   ```

4. **Implement UI controls** for the new tag's functionality

5. **Update module implementation** to support the new integration method

### Best Practices

1. **Single Responsibility**: Each tag should represent one clear integration method
2. **Combinable Tags**: Tags should work well together (e.g., calendar + csv)
3. **Clear Semantics**: Tag names should be self-explanatory
4. **Consistent UI**: New tags should follow existing badge and control patterns
5. **Backward Compatibility**: New tags shouldn't break existing modules

## Current Module Inventory

| Module | Pagination Type | Integration Tags | Capabilities |
|--------|----------------|------------------|-------------|
| `tourismpg_com` | `calendar` | `['calendar']` | Date range scraping |
| `unbctimberwolves_com` | `calendar` | `['calendar', 'csv']` | Date range + CSV upload |
| `unbc_ca` | `page` | `['page-navigation']` | Multi-page scraping |

This tagging system provides flexibility for future expansion while maintaining clear separation of concerns and intuitive user interfaces.