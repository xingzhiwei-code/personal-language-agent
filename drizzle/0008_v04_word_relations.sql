-- v0.4 M3: offline word relations (G3). Additive only.

CREATE TABLE `word_relations` (
  `id` text PRIMARY KEY NOT NULL,
  `word_lemma` text NOT NULL,
  `related_lemma` text NOT NULL,
  `relation_type` text NOT NULL,
  `topic` text,
  `source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `word_relations_lemma_idx` ON `word_relations` (`word_lemma`, `relation_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `word_relations_unique_idx` ON `word_relations` (`word_lemma`, `related_lemma`, `relation_type`, `topic`);
