import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// Replaces the BullMQ repeatable-job scheduler. A single dispatcher runs every
// minute and fires any active schedule whose cron expression matches the current
// minute in its timezone (see schedules.runDue + cronMatch.ts).
const crons = cronJobs();

crons.interval(
  "schedule-dispatcher",
  { minutes: 1 },
  internal.schedules.runDue,
  {},
);

export default crons;
