export const parseEventRaw = (raw: unknown): Record<string, unknown> | undefined => {
  if (!raw) return undefined;

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, unknown>;
  }

  return undefined;
};

export const hasExtractedEvents = (raw: unknown): boolean => {
  const parsed = parseEventRaw(raw);
  if (!parsed) return false;

  const events = (parsed as { events?: unknown }).events;
  return Array.isArray(events) && events.length > 0;
};
