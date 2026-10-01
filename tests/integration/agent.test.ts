import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgentTurn } from '@/agent/chat';
import { routeMessage } from '@/agent/router';
import { createGoalFromText } from '@/application/goals';
import { createKnowledgeItem } from '@/application/knowledge';
import { getHomeView } from '@/application/home';
import { startSession } from '@/application/sessions';
import { createAgentTools } from '@/application/tools';
import { LOCAL_LEARNER_ID } from '@/application/types';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('AI router', () => {
  it('handles explicit commands without an LLM', () => {
    expect(routeMessage({ text: '不要纠正我的语法', aiAvailable: true })).toMatchObject({
      kind: 'deterministic',
      action: 'disable_correction',
    });
    expect(routeMessage({ text: '我只有 3 分钟', aiAvailable: true })).toMatchObject({
      kind: 'deterministic',
      action: 'set_time',
      minutes: 3,
    });
    expect(routeMessage({ text: '今天只想聊天', aiAvailable: true })).toMatchObject({
      kind: 'deterministic',
      action: 'chat_only',
    });
  });

  it('uses the LLM only for real language tasks', () => {
    expect(routeMessage({ text: "What does 'figure out' mean?", aiAvailable: true })).toMatchObject(
      { kind: 'llm', task: 'explain' },
    );
    expect(routeMessage({ text: '我昨天去爬山了', aiAvailable: true })).toMatchObject({
      kind: 'llm',
      task: 'chat',
    });
  });

  it('degrades instead of failing when no provider is configured', () => {
    expect(routeMessage({ text: '我昨天去爬山了', aiAvailable: false })).toMatchObject({
      kind: 'degraded',
      reason: 'ai_unconfigured',
    });
    // Commands still work without AI.
    expect(routeMessage({ text: '不要纠正我', aiAvailable: false })).toMatchObject({
      kind: 'deterministic',
    });
  });
});

describe('agent turns', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = createTestHarness();
    await createGoalFromText(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想提高英语口语',
    });
  });

  afterEach(() => harness.cleanup());

  async function chatSession() {
    const { session } = await startSession(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      activityType: 'conversation',
      clientToken: `chat-${Math.random()}`,
    });
    return session;
  }

  it('"don\'t correct my grammar" really changes the session, with zero LLM calls', async () => {
    const session = await chatSession();
    const result = await runAgentTurn(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      text: '不要纠正我的语法',
    });

    expect(result.usedLlm).toBe(false);
    expect(harness.llm.calls).toBe(0);
    expect(result.action).toBe('disable_correction');

    const updated = await harness.ctx.repos.sessions.findById(session.id);
    expect(updated?.correctionEnabled).toBe(false);
  });

  it('"我只有 3 分钟" changes the recommendation, not just the wording', async () => {
    await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      meaning: '弄清楚',
    });
    const session = await chatSession();
    await runAgentTurn(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      text: '我只有 3 分钟',
    });

    const home = await getHomeView(harness.ctx, LOCAL_LEARNER_ID);
    expect(home.context?.availableMinutes).toBe(3);
    expect(home.primary?.plannedDurationMinutes ?? 99).toBeLessThanOrEqual(3);
    expect(harness.llm.calls).toBe(0);
  });

  it('saves an expression on request and records provenance', async () => {
    const session = await chatSession();
    const result = await runAgentTurn(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      text: '把「figure out」保存起来',
    });

    expect(result.usedLlm).toBe(false);
    const items = await harness.ctx.repos.knowledge.search({
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      limit: 5,
    });
    expect(items).toHaveLength(1);
    expect(items[0]?.aiGenerated).toBe(false);
    expect(items[0]?.sourceType).toBe('chat_session');
  });

  it('calls the LLM for a genuine conversation turn and stores provenance', async () => {
    const session = await chatSession();
    harness.llm.reply = '听起来很棒！你昨天爬的是哪座山？';
    const result = await runAgentTurn(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      text: '我昨天去爬山了',
    });

    expect(result.usedLlm).toBe(true);
    expect(harness.llm.calls).toBe(1);
    const messages = await harness.ctx.repos.chat.listBySession(session.id);
    const assistant = messages.find((message) => message.role === 'assistant');
    expect(assistant?.aiGenerated).toBe(true);
  });

  it('degrades gracefully on provider failure and keeps local features usable', async () => {
    await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'give up',
      meaning: '放弃',
    });
    const session = await chatSession();
    harness.llm.failWith = 'timeout';

    const result = await runAgentTurn(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      text: '我昨天去爬山了',
    });

    expect(result.degraded).toBe(true);
    expect(result.reply).toContain('复习');
    expect(result.suggestions.some((entry) => entry.kind === 'start_review')).toBe(true);

    // Local capabilities still work.
    const home = await getHomeView(harness.ctx, LOCAL_LEARNER_ID);
    expect(home.stats.knowledgeCount).toBe(1);
    const items = await harness.ctx.repos.knowledge.search({
      learnerId: LOCAL_LEARNER_ID,
      limit: 10,
    });
    expect(items).toHaveLength(1);

    const telemetry = harness.telemetry.stats();
    expect(telemetry.aiFailures).toBeGreaterThan(0);
  });

  it('records "I already know this" through the agent and updates state', async () => {
    const { item } = await createKnowledgeItem(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: 'figure out',
      meaning: '弄清楚',
    });
    const session = await chatSession();
    await runAgentTurn(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      sessionId: session.id,
      text: '「figure out」这个我已经会了',
    });

    const state = await harness.ctx.repos.states.find(
      LOCAL_LEARNER_ID,
      'knowledge_item',
      item.id,
    );
    expect(state?.userDeclaredMastered).toBe(true);
    expect(state?.mastery).toBeGreaterThanOrEqual(0.6);
    // Self-report must not create false certainty.
    expect(state?.confidence).toBeLessThanOrEqual(0.45);
  });
});

describe('agent tools', () => {
  let harness: TestHarness;

  beforeEach(() => {
    harness = createTestHarness();
  });

  afterEach(() => harness.cleanup());

  it('exposes only validated application services', async () => {
    await createGoalFromText(harness.ctx, {
      learnerId: LOCAL_LEARNER_ID,
      text: '我想提高英语听力',
    });
    const tools = createAgentTools(harness.ctx, LOCAL_LEARNER_ID);

    expect(await tools.getGoals()).toHaveLength(1);
    expect((await tools.getWeakSkills({ limit: 3 })).length).toBeGreaterThan(0);
    expect(await tools.getUserContext()).toBeNull();

    const item = await tools.saveKnowledge({ text: 'catch up', meaning: '赶上' });
    expect(item.aiGenerated).toBe(true);
    expect(item.origin).toBe('ai_generated');

    const result = await tools.submitAssessment({
      subjectId: item.id,
      modality: 'recognition',
      score: 1,
      idempotencyKey: 'tool-test-1',
    });
    expect(result.mastery).toBeGreaterThan(0);

    // Invalid input is rejected by the tool layer, not passed to the database.
    await expect(
      tools.submitAssessment({
        subjectId: item.id,
        modality: 'not-a-modality',
        score: 5,
        idempotencyKey: 'tool-test-2',
      }),
    ).rejects.toThrow();

    await expect(tools.createSession({ activityType: 'telepathy', clientToken: 'x' })).rejects.toThrow();
  });
});
