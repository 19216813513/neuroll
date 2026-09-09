// @vitest-environment happy-dom

/**
 * End-to-end test of the reaction-time session loop, driven entirely by taps.
 *
 * The point is not the arithmetic — `score.test.ts` covers that — but the input
 * path. Every gate in this exercise (ready screen, the wait before the stimulus,
 * the response itself) used to listen for keys and nothing else, which meant a
 * phone could open the session and then sit on the ready screen forever. A
 * screenshot cannot prove that path is gone; running the loop with no key event
 * ever dispatched can.
 *
 * The virtual clock is the same idea as in the n-back session test: `rAF` never
 * fires in a headless browser pane, so time is advanced by the test itself.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRng } from "~/core/rng";
import type { Config, RunResult } from "~/exercises/types";
import { defaultConfig } from "~/exercises/types";
import { reactionTimeDef } from "./def";

const FRAME_MS = 1000 / 60;

const DEVICE_PROFILE = {
  // A phone is the case under test, so the profile says so.
  deviceClass: "mobile-touch",
  refreshRateHz: 60,
  refreshRateMeasured: true,
  clockResolutionMs: 0.005,
  screen: { width: 390, height: 844, dpr: 3 },
  platform: "test",
  measuredAt: 0,
} as const;

function tap(element: Element): void {
  element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
}

/**
 * Replaces rAF and `performance.now` with a clock the test advances itself.
 * `tick` runs `beforeFrame` while the previous frame is still on screen, which is
 * where a response belongs: the participant answers what they can currently see.
 */
function stubFrameClock(): { tick: (beforeFrame?: () => void) => void } {
  let now = 0;
  let callbacks: FrameRequestCallback[] = [];

  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});

  return {
    tick(beforeFrame) {
      const due = callbacks;
      callbacks = [];
      now += FRAME_MS;
      beforeFrame?.();
      for (const cb of due) cb(now);
    },
  };
}

/**
 * Runs a session to completion, tapping whenever the target is lit.
 *
 * Taps only while lit: a tap during the wait is a false start by design, and
 * restarting trials forever would hang the test rather than fail it. `where`
 * chooses whether the tap lands on the square or in the space around it, which
 * is the one thing the two modes treat differently.
 */
async function runWithTaps(
  root: HTMLElement,
  config: Config,
  where: "square" | "outside" = "square",
): Promise<RunResult> {
  const clock = stubFrameClock();
  const controller = new AbortController();
  let settled = false;
  const promise = reactionTimeDef
    .run({
      config,
      rng: createRng("tap-seed"),
      seed: "tap-seed",
      deviceProfile: DEVICE_PROFILE,
      root,
      signal: controller.signal,
    })
    .finally(() => {
      settled = true;
    });

  // The ready screen. On a phone this tap is the only way past it.
  tap(root);

  // Bounded so a regression that hangs the loop fails the test instead of the run.
  for (let i = 0; i < 200_000 && !settled; i++) {
    clock.tick(() => {
      const lit = root.querySelector(".rt-target.is-lit");
      if (lit) tap(where === "square" ? lit : root);
    });
    await Promise.resolve();
  }

  return promise;
}

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  root.remove();
});

describe("reaction time on a touchscreen", () => {
  it("completes a simple-reaction session with taps alone", async () => {
    const result = await runWithTaps(root, {
      ...defaultConfig(reactionTimeDef),
      mode: "simple",
      trials: 3,
      warmup: 0,
      minWait: 500,
      maxWait: 600,
    });

    expect(result.aborted).toBeFalsy();
    expect(result.trials).toHaveLength(3);
    // Every trial answered by tap, with a reaction time attached to it.
    for (const trial of result.trials) {
      expect(trial.correct).toBe(true);
      expect(String(trial.response)).toMatch(/^tap/);
      expect(Number.isFinite(trial.rtMs as number)).toBe(true);
      expect(trial.rtMs as number).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isFinite(result.primaryScore)).toBe(true);
  }, 30_000);

  it("takes a tap anywhere in simple mode", async () => {
    // Simple reaction asks "did you notice", not "which one", so missing the
    // square is not a wrong answer — a thumb landing beside it still counts.
    const result = await runWithTaps(
      root,
      {
        ...defaultConfig(reactionTimeDef),
        mode: "simple",
        trials: 3,
        warmup: 0,
        minWait: 500,
        maxWait: 600,
      },
      "outside",
    );

    expect(result.trials).toHaveLength(3);
    for (const trial of result.trials) {
      expect(trial.response).toBe("tap");
      expect(trial.correct).toBe(true);
    }
  }, 30_000);

  it("reads the left/right answer from which square was tapped", async () => {
    const result = await runWithTaps(root, {
      ...defaultConfig(reactionTimeDef),
      mode: "choice",
      trials: 4,
      warmup: 0,
      minWait: 500,
      maxWait: 600,
    });

    expect(result.trials).toHaveLength(4);
    for (const trial of result.trials) {
      const stimulus = trial.stimulus as { index: number };
      // Tapping the square that lit up is the touch equivalent of pressing the
      // matching key, so it has to be scored correct and carry which side it was.
      expect(trial.response).toBe(`tap:${stimulus.index}`);
      expect(trial.correct).toBe(true);
    }
  }, 30_000);
});
