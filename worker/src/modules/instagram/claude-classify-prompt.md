# AI Prompt for Event Poster Classification

## Task
Decide whether the provided Instagram post is advertising an event. You will receive the poster image plus optional caption text and metadata.

## Output Format
Return **only** a valid JSON object (no markdown) with this exact structure:

```json
{
  "isEventPoster": true,
  "confidence": 0.93,
  "reasoning": "Concise explanation referencing the strongest cues.",
  "cues": [
    "Key supporting evidence from the poster or caption"
  ],
  "shouldExtractEvents": true
}
```

### Field Requirements
- `isEventPoster`: `true` if the post clearly promotes an event (date/time/location or explicit invitation); otherwise `false`.
- `confidence`: Number between 0 and 1 representing how certain you are in the decision.
- `reasoning`: One or two sentences summarising the decisive clues you used.
- `cues`: Array of short bullet-style strings highlighting the most important evidence. Use at least one entry when marking as an event. Use an empty array if no meaningful cues exist.
- `shouldExtractEvents`: Set to `true` when the content is an event and the event details seem extractable. Set to `false` if the post is not an event or details are too vague.

## Guidance
- Consider both the image and caption. Treat large blocks of repeated text as supportive evidence.
- Strong event indicators include: explicit dates or times, venues/addresses, registration or ticket language, phrases like "join us", "RSVP", "save the date", "opening night", etc.
- Treat giveaways, general promotions, sponsor shout-outs, or pure recaps as **not events** unless an upcoming event is clearly advertised.
- When unsure or details conflict, lean toward `false` with lower confidence and explain why in `reasoning`.
- Never invent information. If the poster lacks a date/time/location, only mark it as an event when the caption explicitly states it is announcing a future gathering and provides some timing clue.

Respond with the JSON object only.
