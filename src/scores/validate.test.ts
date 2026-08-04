import { describe, expect, it } from "vitest";
import type { TrialRecord } from "~/exercises/types";
import { validateRun } from "./validate";

function trialsWithRts(rts: (number | null)[]): TrialRecord[] {
  return rts.map((rtMs, i) => ({
    i,
    stimulus: null,
    isTarget: true,
    response: rtMs === null ? null : "space",
    correct: rtMs !== null,
    rtMs,
    presentedAt: i * 1000,
  }));
}

const healthy = {
  trials: trialsWithRts([245, 268, 231, 289, 254, 276, 240, 262, 258, 271]),
  actualDurationMs: 30000,
  hiddenMs: 0,
  droppedFrames: 0,
};

describe("validateRun", () => {
  it("passes a clean run with no flags", () => {
    const result = validateRun(healthy);
    expect(result.valid).toBe(true);
    expect(result.suspicion).toEqual([]);
  });

  it("invalidates a run where the tab was hidden", () => {
    const result = validateRun({ ...healthy, hiddenMs: 1500 });
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("非表示");
  });

  it("invalidates a run with responses that had no stimulus", () => {
    const result = validateRun({ ...healthy, orphanResponses: 2 });
    expect(result.valid).toBe(false);
    expect(result.invalidReason).toContain("刺激に対応しない");
  });

  it("flags but keeps a run with many implausibly fast responses", () => {
    const result = validateRun({
      ...healthy,
      trials: trialsWithRts([20, 30, 25, 40, 250, 260, 255, 248, 262, 251]),
    });
    expect(result.valid).toBe(true);
    expect(result.suspicion.some((s) => s.includes("100ms未満"))).toBe(true);
  });

  it("does not flag a small number of fast responses", () => {
    // One fast trial in ten is under the 15% threshold — real people do this.
    const result = validateRun({
      ...healthy,
      trials: trialsWithRts([90, 250, 260, 255, 248, 262, 251, 244, 266, 259]),
    });
    expect(result.suspicion.some((s) => s.includes("100ms未満"))).toBe(false);
  });

  it("flags machine-like consistency", () => {
    const result = validateRun({
      ...healthy,
      trials: trialsWithRts([250, 250, 250, 251, 250, 249, 250, 250, 251, 250]),
    });
    expect(result.suspicion.some((s) => s.includes("自動入力"))).toBe(true);
  });

  it("does not flag normal human variability", () => {
    expect(validateRun(healthy).suspicion.some((s) => s.includes("自動入力"))).toBe(false);
  });

  it("needs at least 10 trials before judging consistency", () => {
    const result = validateRun({
      ...healthy,
      trials: trialsWithRts([250, 250, 250]),
    });
    expect(result.suspicion.some((s) => s.includes("自動入力"))).toBe(false);
  });

  it("flags a duration that disagrees with the theoretical one", () => {
    const result = validateRun({ ...healthy, expectedDurationMs: 20000 });
    expect(result.suspicion.some((s) => s.includes("ずれ"))).toBe(true);
  });

  it("accepts a duration within 5% of expectation", () => {
    const result = validateRun({ ...healthy, expectedDurationMs: 29000 });
    expect(result.suspicion.some((s) => s.includes("ずれ"))).toBe(false);
  });

  it("reports dropped frames", () => {
    const result = validateRun({ ...healthy, droppedFrames: 4 });
    expect(result.suspicion.some((s) => s.includes("フレーム落ち 4"))).toBe(true);
  });

  it("survives a run with no usable reaction times", () => {
    const result = validateRun({ ...healthy, trials: trialsWithRts([null, null]) });
    expect(result.valid).toBe(true);
  });
});
