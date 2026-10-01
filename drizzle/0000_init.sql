CREATE TABLE `assessments` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`event_id` text NOT NULL,
	`session_id` text,
	`activity_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`modality` text NOT NULL,
	`score` real NOT NULL,
	`correct` integer NOT NULL,
	`difficulty` real,
	`response_time_ms` integer,
	`user_answer` text,
	`expected_answer` text,
	`source` text NOT NULL,
	`user_corrected` integer DEFAULT false NOT NULL,
	`occurred_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assessments_event_uidx` ON `assessments` (`event_id`);--> statement-breakpoint
CREATE INDEX `assessments_subject_idx` ON `assessments` (`learner_id`,`subject_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `assessments_session_idx` ON `assessments` (`session_id`);--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`learner_id` text NOT NULL,
	`role` text NOT NULL,
	`text` text NOT NULL,
	`ai_generated` integer DEFAULT false NOT NULL,
	`meta` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_session_idx` ON `chat_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `content_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text,
	`type` text NOT NULL,
	`origin` text NOT NULL,
	`title` text,
	`url` text,
	`extraction_method` text,
	`ai_generated` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `content_sources_learner_idx` ON `content_sources` (`learner_id`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`learner_id` text,
	`language_code` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contents_source_idx` ON `contents` (`source_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`language_code` text NOT NULL,
	`title` text NOT NULL,
	`raw_input` text DEFAULT '' NOT NULL,
	`description` text,
	`scenarios` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`priority` integer DEFAULT 3 NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `goals_learner_idx` ON `goals` (`learner_id`,`status`);--> statement-breakpoint
CREATE INDEX `goals_raw_input_idx` ON `goals` (`learner_id`,`raw_input`);--> statement-breakpoint
CREATE TABLE `knowledge_items` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`language_code` text NOT NULL,
	`type` text NOT NULL,
	`text` text NOT NULL,
	`normalized_text` text NOT NULL,
	`meaning` text,
	`notes` text,
	`examples` text DEFAULT '[]' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`origin` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text,
	`source_ref` text,
	`ai_generated` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_unique_idx` ON `knowledge_items` (`learner_id`,`language_code`,`type`,`normalized_text`);--> statement-breakpoint
CREATE INDEX `knowledge_learner_idx` ON `knowledge_items` (`learner_id`,`status`);--> statement-breakpoint
CREATE INDEX `knowledge_text_idx` ON `knowledge_items` (`normalized_text`);--> statement-breakpoint
CREATE TABLE `knowledge_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`from_item_id` text NOT NULL,
	`to_item_id` text NOT NULL,
	`type` text NOT NULL,
	`note` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `relations_unique_idx` ON `knowledge_relations` (`from_item_id`,`to_item_id`,`type`);--> statement-breakpoint
CREATE INDEX `relations_from_idx` ON `knowledge_relations` (`from_item_id`);--> statement-breakpoint
CREATE INDEX `relations_to_idx` ON `knowledge_relations` (`to_item_id`);--> statement-breakpoint
CREATE TABLE `learner_states` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`mastery` real DEFAULT 0 NOT NULL,
	`confidence` real DEFAULT 0 NOT NULL,
	`exposure_count` integer DEFAULT 0 NOT NULL,
	`successful_attempts` integer DEFAULT 0 NOT NULL,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`recent_performance` real DEFAULT 0 NOT NULL,
	`historical_performance` real DEFAULT 0 NOT NULL,
	`stability_days` real DEFAULT 0 NOT NULL,
	`ease_factor` real DEFAULT 2.5 NOT NULL,
	`repetitions` integer DEFAULT 0 NOT NULL,
	`retrieval_strength` real DEFAULT 0 NOT NULL,
	`modality_stats` text DEFAULT '{}' NOT NULL,
	`recent_evidence` text DEFAULT '[]' NOT NULL,
	`transfer_score` real,
	`transfer_confidence` real,
	`trend` text DEFAULT 'unknown' NOT NULL,
	`last_practiced_at` text,
	`next_review_at` text,
	`user_declared_mastered` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `states_subject_uidx` ON `learner_states` (`learner_id`,`subject_type`,`subject_id`);--> statement-breakpoint
CREATE INDEX `states_due_idx` ON `learner_states` (`learner_id`,`next_review_at`);--> statement-breakpoint
CREATE INDEX `states_mastery_idx` ON `learner_states` (`learner_id`,`subject_type`,`mastery`);--> statement-breakpoint
CREATE TABLE `learning_activities` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`learner_id` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`modality` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`prompt` text NOT NULL,
	`options` text,
	`expected_answer` text,
	`hint` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activities_session_idx` ON `learning_activities` (`session_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `activities_session_position_uidx` ON `learning_activities` (`session_id`,`position`);--> statement-breakpoint
CREATE TABLE `learning_events` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`session_id` text,
	`type` text NOT NULL,
	`occurred_at` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`source` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_idempotency_uidx` ON `learning_events` (`learner_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `events_learner_time_idx` ON `learning_events` (`learner_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `learning_events` (`session_id`);--> statement-breakpoint
CREATE TABLE `learning_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`confidence` real DEFAULT 0.3 NOT NULL,
	`evidence_count` integer DEFAULT 1 NOT NULL,
	`source` text DEFAULT 'inferred' NOT NULL,
	`last_observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preferences_key_uidx` ON `learning_preferences` (`learner_id`,`key`);--> statement-breakpoint
CREATE TABLE `learning_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`goal_id` text,
	`recommendation_id` text,
	`activity_type` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`planned_duration_minutes` integer,
	`correction_enabled` integer DEFAULT true NOT NULL,
	`started_at` text,
	`last_active_at` text,
	`paused_at` text,
	`ended_at` text,
	`summary` text,
	`client_token` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_uidx` ON `learning_sessions` (`learner_id`,`client_token`);--> statement-breakpoint
CREATE INDEX `sessions_learner_status_idx` ON `learning_sessions` (`learner_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `learning_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`learner_id` text NOT NULL,
	`skill` text NOT NULL,
	`importance` real DEFAULT 0.5 NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `targets_goal_idx` ON `learning_targets` (`goal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `targets_goal_skill_uidx` ON `learning_targets` (`goal_id`,`skill`);--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`content` text NOT NULL,
	`confidence` real DEFAULT 0.3 NOT NULL,
	`evidence_count` integer DEFAULT 1 NOT NULL,
	`last_observed_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memories_key_uidx` ON `memories` (`learner_id`,`key`);--> statement-breakpoint
CREATE TABLE `recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`goal_id` text,
	`activity_type` text NOT NULL,
	`score` real NOT NULL,
	`reason` text NOT NULL,
	`factors` text DEFAULT '{}' NOT NULL,
	`subject_ids` text DEFAULT '[]' NOT NULL,
	`planned_duration_minutes` integer NOT NULL,
	`estimated_item_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'offered' NOT NULL,
	`requires_ai` integer DEFAULT false NOT NULL,
	`generated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `recommendations_learner_idx` ON `recommendations` (`learner_id`,`generated_at`);--> statement-breakpoint
CREATE TABLE `transfer_evidences` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`goal_id` text,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`scenario` text NOT NULL,
	`evidence_type` text NOT NULL,
	`score` real NOT NULL,
	`confidence` real NOT NULL,
	`note` text,
	`occurred_at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transfer_learner_idx` ON `transfer_evidences` (`learner_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `user_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`learner_id` text NOT NULL,
	`captured_at` text NOT NULL,
	`available_minutes` integer,
	`device` text DEFAULT 'unknown' NOT NULL,
	`can_speak` integer DEFAULT true NOT NULL,
	`can_listen` integer DEFAULT true NOT NULL,
	`can_type` integer DEFAULT true NOT NULL,
	`can_read` integer DEFAULT true NOT NULL,
	`attention` text DEFAULT 'medium' NOT NULL,
	`intent` text DEFAULT 'unknown' NOT NULL,
	`note` text,
	`raw_input` text
);
--> statement-breakpoint
CREATE INDEX `contexts_learner_idx` ON `user_contexts` (`learner_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`native_language` text DEFAULT 'zh' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
