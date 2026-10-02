-- Deterministically repair legacy goal rows before enforcing one primary per learner.
UPDATE `goals`
SET `is_primary` = 0,
    `priority` = CASE WHEN `priority` = 1 THEN 2 ELSE `priority` END;
--> statement-breakpoint
UPDATE `goals`
SET `is_primary` = 1, `priority` = 1
WHERE `id` IN (
  SELECT `id`
  FROM `goals` AS candidate
  WHERE candidate.`status` = 'active'
    AND candidate.`id` = (
      SELECT selected.`id`
      FROM `goals` AS selected
      WHERE selected.`learner_id` = candidate.`learner_id`
        AND selected.`status` = 'active'
      ORDER BY selected.`priority` ASC, selected.`created_at` ASC, selected.`id` ASC
      LIMIT 1
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `goals_one_primary_uidx`
ON `goals` (`learner_id`) WHERE `is_primary` = 1;
--> statement-breakpoint
-- Keep every attempt but clear duplicate idempotency keys before adding the constraint.
UPDATE `import_export_history`
SET `file_hash` = NULL,
    `errors` = json_array(json_object('row', 0, 'reason', '历史重复导入记录，哈希已规范化'))
WHERE `type` = 'import'
  AND `file_hash` IS NOT NULL
  AND `id` NOT IN (
    SELECT MIN(`id`)
    FROM `import_export_history`
    WHERE `type` = 'import' AND `file_hash` IS NOT NULL
    GROUP BY `learner_id`, `file_hash`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ie_history_import_hash_uidx`
ON `import_export_history` (`learner_id`, `file_hash`)
WHERE `type` = 'import' AND `file_hash` IS NOT NULL;
