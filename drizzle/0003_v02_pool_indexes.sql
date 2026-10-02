CREATE INDEX IF NOT EXISTS `knowledge_wordlist_status_idx`
ON `knowledge_items` (`learner_id`, `wordlist_id`, `status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `knowledge_pool_page_idx`
ON `knowledge_items` (`learner_id`, `status`, `updated_at`, `id`);
