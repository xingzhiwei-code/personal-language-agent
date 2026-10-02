import type { KnowledgeOperationLog } from '@/domain/entities';
import type { KnowledgeEntryMethod, KnowledgeOperationType } from '@/domain/enums';
import type { AppContext } from './types';

export async function recordKnowledgeOperation(
  ctx: AppContext,
  input: {
    learnerId: string;
    operation: KnowledgeOperationType;
    knowledgeItemId?: string | null;
    itemText?: string | null;
    changes?: Record<string, unknown>;
    source?: KnowledgeEntryMethod;
    note?: string | null;
  },
): Promise<KnowledgeOperationLog> {
  const entry: KnowledgeOperationLog = {
    id: ctx.ids.next(),
    learnerId: input.learnerId,
    operation: input.operation,
    knowledgeItemId: input.knowledgeItemId ?? null,
    itemText: input.itemText?.slice(0, 400) ?? null,
    changes: input.changes ?? {},
    source: input.source ?? 'manual',
    note: input.note?.slice(0, 500) ?? null,
    createdAt: ctx.clock.nowIso(),
  };
  return ctx.repos.operationLog.append(entry);
}

export async function listImportExportHistory(
  ctx: AppContext,
  learnerId: string,
  limit = 100,
) {
  return ctx.repos.importExportHistory.listByLearner(learnerId, Math.min(200, Math.max(1, limit)));
}

export async function listKnowledgeOperationLogs(
  ctx: AppContext,
  input: {
    learnerId: string;
    operations?: KnowledgeOperationType[];
    limit?: number;
    offset?: number;
  },
) {
  return ctx.repos.operationLog.listByLearner(
    input.learnerId,
    Math.min(200, Math.max(1, input.limit ?? 100)),
    Math.max(0, input.offset ?? 0),
    input.operations,
  );
}
