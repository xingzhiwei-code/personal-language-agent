-- v0.4 M2: backfill goal_type for goals created before the goal_type column.
-- v0.4 shipped without a user-facing goal-type control, so every pre-existing
-- goal still carries the default 'general'. Re-classify using the same rule the
-- creation path uses (detectGoalType: title + rawInput contain an IELTS
-- keyword). Data-only and idempotent: non-matching rows stay 'general', and
-- matched rows are no longer 'general' on the next run, so the result never
-- changes.

UPDATE `goals`
SET `goal_type` = 'ielts'
WHERE `goal_type` = 'general'
  AND (
    LOWER(`title` || ' ' || `raw_input`) LIKE '%雅思%'
    OR LOWER(`title` || ' ' || `raw_input`) LIKE '%ielts%'
  );
