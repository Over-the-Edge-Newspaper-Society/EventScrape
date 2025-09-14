# AI Prompt for Event Poster Data Extraction

## Task
Extract all event information from this poster image and return it as structured JSON data.

## Instructions
Analyze the poster carefully and extract ALL available event information. If certain fields are not visible or clear, mark them as null rather than guessing.

## Required Output Format
Return ONLY a valid JSON object (no markdown, no explanation) in this exact structure:

```json
{
  "events": [
    {
      "title": "Event name as shown on poster",
      "description": "Full description or tagline from poster",
      "startDate": "YYYY-MM-DD",
      "startTime": "HH:MM (24-hour format)",
      "endDate": "YYYY-MM-DD (if different from start)",
      "endTime": "HH:MM (if specified)",
      "timezone": "America/Vancouver (or appropriate timezone)",
      "venue": {
        "name": "Venue name",
        "address": "Full street address if shown",
        "city": "City name",
        "region": "Province/State",
        "country": "Country"
      },
      "organizer": "Organization or person hosting",
      "category": "Concert/Workshop/Festival/Sports/Theatre/Community/etc",
      "price": "Price information as shown (e.g., '$20', 'Free', '$15-25')",
      "tags": ["tag1", "tag2"],
      "registrationUrl": "URL if shown",
      "contactInfo": {
        "phone": "Phone number if shown",
        "email": "Email if shown",
        "website": "Website if shown"
      },
      "additionalInfo": "Any other relevant details from poster"
    }
  ],
  "extractionConfidence": {
    "overall": 0.95,
    "notes": "Any issues or uncertainties in extraction"
  }
}
```

## Field Guidelines

### Dates and Times
- Extract dates in YYYY-MM-DD format
- Use 24-hour time format (HH:MM)
- If only month/day shown, assume current or next year based on context
- If time shows "7 PM" convert to "19:00"
- If date shows "Every Tuesday", note in additionalInfo and use next occurrence

### Venue Information
- Extract complete venue name (e.g., "Prince George Civic Centre")
- Include full address if visible
- Default to city shown on poster or organization location

### Categories (use one of these)
- Concert
- Workshop
- Festival
- Sports
- Theatre
- Comedy
- Conference
- Community
- Education
- Fundraiser
- Market
- Exhibition
- Other

### Price
- Keep original format shown on poster
- "Free" for no-cost events
- Include all pricing tiers if shown (e.g., "$20 advance, $25 door")

### Missing Information
- Set field to null if not present
- Don't invent or guess information
- Note any ambiguities in extractionConfidence.notes

## Examples

For a poster showing:
"SUMMER CONCERT SERIES
July 15, 2024 • 7:00 PM
Fort George Park
Featuring: Local Band
Free Admission"

Return:
```json
{
  "events": [{
    "title": "Summer Concert Series",
    "description": "Featuring: Local Band",
    "startDate": "2024-07-15",
    "startTime": "19:00",
    "endDate": null,
    "endTime": null,
    "timezone": "America/Vancouver",
    "venue": {
      "name": "Fort George Park",
      "address": null,
      "city": "Prince George",
      "region": "BC",
      "country": "Canada"
    },
    "organizer": null,
    "category": "Concert",
    "price": "Free",
    "tags": ["music", "outdoor", "summer"],
    "registrationUrl": null,
    "contactInfo": {
      "phone": null,
      "email": null,
      "website": null
    },
    "additionalInfo": null
  }],
  "extractionConfidence": {
    "overall": 0.90,
    "notes": "Organizer not specified on poster"
  }
}
```

Remember: Output ONLY the JSON object, no additional text or formatting.