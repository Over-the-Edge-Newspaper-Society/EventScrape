-- Migration: Add scheduleId to exports table
-- This allows tracking which exports were created by scheduled jobs vs manual exports

ALTER TABLE exports ADD COLUMN schedule_id UUID REFERENCES schedules(id);
CREATE INDEX exports_schedule_id_idx ON exports(schedule_id);
