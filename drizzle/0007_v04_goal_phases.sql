-- v0.4 M2: goal phases (G2). Additive only.

CREATE TABLE `goal_phases` (
  `id` text PRIMARY KEY NOT NULL,
  `goal_id` text NOT NULL,
  `seq` integer NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `topic_sequence` text NOT NULL DEFAULT '[]',
  `entry_criteria` text NOT NULL DEFAULT '{}',
  `exit_criteria` text NOT NULL DEFAULT '{}',
  `status` text NOT NULL DEFAULT 'locked',
  `progress_cache` text NOT NULL DEFAULT '{}',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goal_phases_goal_idx` ON `goal_phases` (`goal_id`, `seq`);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_phases_one_active_uidx` ON `goal_phases` (`goal_id`) WHERE `status` = 'active';
