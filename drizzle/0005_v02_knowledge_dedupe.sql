-- v0.1 legitimately allowed the same normalised content under different types.
-- Preserve those rows during upgrade, but prevent any new cross-type duplicates.
-- Application services merge into the deterministic first match.
CREATE TRIGGER IF NOT EXISTS `knowledge_normalized_unique_insert`
BEFORE INSERT ON `knowledge_items`
WHEN EXISTS (
  SELECT 1 FROM `knowledge_items`
  WHERE `learner_id` = NEW.`learner_id`
    AND `language_code` = NEW.`language_code`
    AND `normalized_text` = NEW.`normalized_text`
)
BEGIN
  SELECT RAISE(ABORT, 'duplicate normalized knowledge');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `knowledge_normalized_unique_update`
BEFORE UPDATE OF `learner_id`, `language_code`, `normalized_text` ON `knowledge_items`
WHEN EXISTS (
  SELECT 1 FROM `knowledge_items`
  WHERE `learner_id` = NEW.`learner_id`
    AND `language_code` = NEW.`language_code`
    AND `normalized_text` = NEW.`normalized_text`
    AND `id` <> NEW.`id`
)
BEGIN
  SELECT RAISE(ABORT, 'duplicate normalized knowledge');
END;
