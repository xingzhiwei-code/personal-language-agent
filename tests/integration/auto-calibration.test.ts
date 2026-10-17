import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acknowledgeAutoCalibration,
  applyAutoCalibration,
  getAutoCalibrationView,
  isAutoCalibrationEnabled,
  setAutoCalibrationEnabled,
} from '@/application/auto-calibration';
import { recordPlacementOverride, recordSelfReportPlacement } from '@/application/placement';
import { LOCAL_LEARNER_ID } from '@/application/types';
import { createTestHarness, type TestHarness } from '../helpers/context';

describe('auto-calibration (v0.5 §W3)', () => {
  let h: TestHarness;

  beforeEach(async () => {
    h = await createTestHarness();
  });

  afterEach(() => h.cleanup());

  it('manual override pauses auto-calibration until re-enabled', async () => {
    const { ctx } = h;
    await setAutoCalibrationEnabled(ctx, LOCAL_LEARNER_ID, true);
    expect(await isAutoCalibrationEnabled(ctx, LOCAL_LEARNER_ID)).toBe(true);

    await recordPlacementOverride(ctx, LOCAL_LEARNER_ID, 5.0);
    expect(await isAutoCalibrationEnabled(ctx, LOCAL_LEARNER_ID)).toBe(false);
  });

  it('reading the view never writes a placement (不点不生效)', async () => {
    const { ctx } = h;
    await setAutoCalibrationEnabled(ctx, LOCAL_LEARNER_ID, true);
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');

    await getAutoCalibrationView(ctx, LOCAL_LEARNER_ID);

    const rows = await ctx.repos.placements.listByLearner(LOCAL_LEARNER_ID, 20);
    expect(rows.filter((placement) => placement.type === 'auto_calibration')).toHaveLength(0);
  });

  it('apply writes an auto_calibration placement (点更新生效)', async () => {
    const { ctx } = h;
    const placement = await applyAutoCalibration(ctx, LOCAL_LEARNER_ID, 5.5, 'medium');

    expect(placement).not.toBeNull();
    expect(placement!.type).toBe('auto_calibration');
    expect(placement!.evidence).toEqual(['auto_calibration']);

    const latest = await ctx.repos.placements.findLatest(LOCAL_LEARNER_ID);
    expect(latest!.overallLevel).toBe(5.5);
  });

  it('acknowledge (保持不变) writes no placement', async () => {
    const { ctx } = h;
    await recordSelfReportPlacement(ctx, LOCAL_LEARNER_ID, 'cet4');
    await acknowledgeAutoCalibration(ctx, LOCAL_LEARNER_ID, 5.0);

    const rows = await ctx.repos.placements.listByLearner(LOCAL_LEARNER_ID, 20);
    expect(rows.filter((placement) => placement.type === 'auto_calibration')).toHaveLength(0);
  });
});
