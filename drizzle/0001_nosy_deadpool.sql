CREATE TABLE `import_export_history` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`type` text NOT NULL,
	`method` text NOT NULL,
	`source_label` text NOT NULL,
	`file_hash` text,
	`format` text DEFAULT 'json' NOT NULL,
	`total_count` integer DEFAULT 0 NOT NULL,
	`added_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`failed_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'success' NOT NULL,
	`errors` text DEFAULT '[]' NOT NULL,
	`wordlist_id` text,
	`goal_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ie_history_learner_idx` ON `import_export_history` (`learner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `ie_history_hash_idx` ON `import_export_history` (`learner_id`,`file_hash`);--> statement-breakpoint
CREATE TABLE `knowledge_operation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`operation` text NOT NULL,
	`knowledge_item_id` text,
	`item_text` text,
	`changes` text DEFAULT '{}' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `op_log_learner_idx` ON `knowledge_operation_log` (`learner_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `op_log_item_idx` ON `knowledge_operation_log` (`knowledge_item_id`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`goal_id` text,
	`parent_id` text,
	`name` text NOT NULL,
	`type` text DEFAULT 'big' NOT NULL,
	`time_context` text DEFAULT 'null',
	`status` text DEFAULT 'active' NOT NULL,
	`knowledge_item_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scenarios_learner_idx` ON `scenarios` (`learner_id`,`status`);--> statement-breakpoint
CREATE INDEX `scenarios_goal_idx` ON `scenarios` (`goal_id`);--> statement-breakpoint
CREATE INDEX `scenarios_parent_idx` ON `scenarios` (`parent_id`);--> statement-breakpoint
CREATE TABLE `wordlists` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`name` text NOT NULL,
	`language_code` text DEFAULT 'en' NOT NULL,
	`goal_id` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`source_file` text,
	`item_count` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `wordlists_learner_idx` ON `wordlists` (`learner_id`);--> statement-breakpoint
CREATE INDEX `wordlists_goal_idx` ON `wordlists` (`goal_id`);--> statement-breakpoint
ALTER TABLE `knowledge_items` ADD `wordlist_id` text;--> statement-breakpoint
ALTER TABLE `knowledge_items` ADD `entry_method` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_items` ADD `frequency_rank` real;