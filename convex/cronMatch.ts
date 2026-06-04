// Minimal 5-field cron matcher (minute hour day-of-month month day-of-week),
// evaluated against a given instant in a given IANA timezone. Replaces BullMQ's
// repeatable-job cron handling. Supports: *, */n, a, a-b, a,b,c and combinations.
// Day-of-week: 0-6 (Sun=0); also accepts 7 as Sunday.

function parseField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart ? parseInt(stepPart, 10) : 1;
    let lo = min;
    let hi = max;
    if (rangePart !== "*" && rangePart !== "") {
      if (rangePart.includes("-")) {
        const [a, b] = rangePart.split("-");
        lo = parseInt(a, 10);
        hi = parseInt(b, 10);
      } else {
        lo = hi = parseInt(rangePart, 10);
      }
    }
    if (Number.isNaN(lo) || Number.isNaN(hi) || Number.isNaN(step) || step <= 0) continue;
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) out.add(v);
    }
  }
  return out;
}

// Extract calendar fields for an instant as seen in a specific timezone.
export function partsInZone(
  epochMs: number,
  timeZone: string,
): { minute: number; hour: number; day: number; month: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0; // some environments emit 24 for midnight
  return {
    minute: parseInt(get("minute"), 10),
    hour,
    day: parseInt(get("day"), 10),
    month: parseInt(get("month"), 10),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

export function cronMatches(cron: string, epochMs: number, timeZone: string): boolean {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [m, h, dom, mon, dow] = fields;
  const t = partsInZone(epochMs, timeZone);

  const minuteOk = parseField(m, 0, 59).has(t.minute);
  const hourOk = parseField(h, 0, 23).has(t.hour);
  const monthOk = parseField(mon, 1, 12).has(t.month);

  // Day-of-month and day-of-week: standard cron uses OR when both are
  // restricted, AND when one is '*'.
  const domSet = parseField(dom, 1, 31);
  const dowSetRaw = parseField(dow, 0, 7);
  const dowSet = new Set([...dowSetRaw].map((d) => (d === 7 ? 0 : d)));
  const domRestricted = dom !== "*";
  const dowRestricted = dow !== "*";
  const domOk = domSet.has(t.day);
  const dowOk = dowSet.has(t.weekday);
  let dayOk: boolean;
  if (domRestricted && dowRestricted) dayOk = domOk || dowOk;
  else dayOk = (domRestricted ? domOk : true) && (dowRestricted ? dowOk : true);

  return minuteOk && hourOk && monthOk && dayOk;
}
