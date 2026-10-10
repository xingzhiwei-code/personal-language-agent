-- v0.4 M1: level placement (G1) + goal_type column (G2 schema).
-- Additive only: no destructive changes, idempotent via the migration runner.

ALTER TABLE `goals` ADD COLUMN `goal_type` text NOT NULL DEFAULT 'general';
--> statement-breakpoint
CREATE TABLE `placements` (
  `id` text PRIMARY KEY NOT NULL,
  `learner_id` text NOT NULL,
  `type` text NOT NULL,
  `skills` text NOT NULL,
  `overall_level` real NOT NULL,
  `confidence` text NOT NULL,
  `evidence` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `placements_learner_idx` ON `placements` (`learner_id`, `created_at`);
