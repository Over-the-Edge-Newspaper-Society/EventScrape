import type { EventRaw, Source } from '../../db/schema.js';

export type InstagramPostWithSource = {
  event: EventRaw;
  source: Source;
};

export type ExtractionResult = {
  success: boolean;
  message: string;
  extraction: unknown;
  eventsCreated: number;
};
