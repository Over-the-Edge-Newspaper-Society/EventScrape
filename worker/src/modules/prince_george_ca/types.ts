export type CalendarEventLink = {
  url: string;
  title: string;
  time: string;
  date: string;
  dataStart?: string | null;
  dataEnd?: string | null;
  rawDateText?: string | null;
};

export type DetailPageSeriesEntry = {
  start?: string | null;
  end?: string | null;
  rawText?: string | null;
};

