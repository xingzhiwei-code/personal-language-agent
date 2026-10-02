-- v0.1 allowed a learner's only active goal to be non-primary.
-- Promote exactly one active goal only when that learner has no existing primary.
-- The predicates make this migration idempotent and avoid choosing among multiple goals.
UPDATE `goals`
SET `is_primary` = 1, `priority` = 1
WHERE `status` = 'active'
  AND `is_primary` = 0
  AND `learner_id` IN (
    SELECT `learner_id`
    FROM `goals`
    GROUP BY `learner_id`
    HAVING SUM(CASE WHEN `status` = 'active' THEN 1 ELSE 0 END) = 1
       AND SUM(CASE WHEN `is_primary` = 1 THEN 1 ELSE 0 END) = 0
  );
