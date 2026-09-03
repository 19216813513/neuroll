// @vitest-environment happy-dom

/**
 * End-to-end test of the N-back session loop.
 *
 * The exercise loops on `requestAnimationFrame`, which never fires in a headless
 * browser pane, so the interactive path could not be verified by driving a real
 * page. Here rAF and `performance.now()` are replaced with a virtual clock, which
 * lets a full session run in milliseconds and makes the parts that a screenshot
 * could never prove observable: that the loop terminates, that exactly the
 * requested number of trials is scored, that responses land on the right trial,
 * and that no listeners survive the run.
 *
 * The trade-off is honest: this proves the control flow, not that the stimulus is
 * visible or the timing is accurate on real hardware. Those still need a human.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRng } from "~/core/rng";
import type { Config, RunResult } from "~/exercises/types";
import { defaultConfig } from "~/exercises/types";
import { nbackDef } from "./def";

/** Milliseconds the virtual clock advances per animation frame. */
const FRAME_MS = 1000 / 60;

interface Harness {
  /** Runs the session to completion, driving frames until the promise settles. */
  run(config: Config): Promise<RunResult>;
}

/**
 * Replaces rAF and performance.now with a clock the test advances itself.
 * Frames are pumped from a macrotask loop so awaited promises interleave the way
 * they do in a browser.
 */
function createHarness(
  root: HTMLElement,
  respond: (context: { litCellIndex: number | null; frame: number }) => string[],
): Harness {
  let now = 0;
  let frame = 0;
  let callbacks: FrameRequestCallback[] = [];

  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
    callbacks.push(cb);
    return callbacks.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});

  const pump = (): void => {
    const due = callbacks;
    callbacks = [];
    now += FRAME_MS;
    frame += 1;

    // Emit whatever keys the policy wants for the current on-screen state, so a
    // response is attributed to the trial that is actually being presented.
    const lit = root.querySelector(".nb-cell.is-lit");
    const litCellIndex = lit ? [...(lit.parentElement?.children ?? [])].indexOf(lit) : null;
    for (const key of respond({ litCellIndex, frame })) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }

    for (const cb of due) cb(now);
  };

  return {
    async run(config) {
      const controller = new AbortController();
      let settled = false;
      const promise = nbackDef
        .run({
          config,
          rng: createRng("harness-seed"),
          seed: "harness-seed",
          deviceProfile: {
            deviceClass: "desktop-keyboard",
            refreshRateHz: 60,
            refreshRateMeasured: true,
            clockResolutionMs: 0.005,
            screen: { width: 1920, height: 1080, dpr: 1 },
            platform: "test",
            measuredAt: 0,
          },
          root,
          signal: controller.signal,
        })
        .finally(() => {
          settled = true;
        });

      // The session waits for a keypress before the first trial.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

      // Bounded so a regression that hangs the loop fails the test instead of
      // hanging the suite.
      for (let i = 0; i < 200_000 && !settled; i++) {
        pump();
        if (i % 50 === 0) await Promise.resolve();
        await Promise.resolve();
      }

      return promise;
    },
  };
}

function config(overrides: Config = {}): Config {
  return { ...defaultConfig(nbackDef), ...overrides };
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

describe("N-back session", () => {
  it("runs to completion and scores exactly the requested number of trials", async () => {
    const harness = createHarness(root, () => []);
    const result = await harness.run(
      config({ modalities: ["position"], n: 2, trials: 10, stimulusMs: 300, isiMs: 300 }),
    );

    expect(result.aborted).toBeFalsy();
    // trials + n are presented, but only `trials` are scored.
    expect(result.trials).toHaveLength(10);
    expect(result.metrics.trials).toBe(10);
    expect(result.durationMs).toBeGreaterThan(0);
  }, 30_000);

  it("produces a finite d-prime when never responding", async () => {
    const harness = createHarness(root, () => []);
    const result = await harness.run(
      config({ modalities: ["position"], n: 2, trials: 10, stimulusMs: 300, isiMs: 300 }),
    );

    // Never pressing must not yield NaN or Infinity — the log-linear correction
    // in computeSdt exists precisely for this case.
    expect(Number.isFinite(result.primaryScore)).toBe(true);
    expect(result.trials.every((t) => t.response !== null)).toBe(true);
  }, 30_000);

  it("records a response on the trial that was on screen when the key was pressed", async () => {
    // Press only while a stimulus is lit, so every press belongs to a real trial.
    const harness = createHarness(root, ({ litCellIndex }) => (litCellIndex === null ? [] : ["a"]));
    const result = await harness.run(
      config({ modalities: ["position"], n: 2, trials: 10, stimulusMs: 300, isiMs: 300 }),
    );

    expect(result.trials).toHaveLength(10);
    const responded = result.trials.filter(
      (t) => (t.response as Record<string, boolean>).position === true,
    );
    expect(responded.length).toBe(10);
    // A reaction time must exist and be plausible for every registered press.
    for (const trial of responded) {
      expect(trial.rtMs).not.toBeNull();
      expect(trial.rtMs as number).toBeGreaterThanOrEqual(0);
    }
  }, 30_000);

  it("keeps the two streams separate in dual mode", async () => {
    const harness = createHarness(root, () => []);
    const result = await harness.run(
      config({
        modalities: ["position", "audio"],
        audioMode: "visual",
        n: 2,
        trials: 10,
        stimulusMs: 300,
        isiMs: 300,
      }),
    );

    expect(result.trials).toHaveLength(10);
    expect(Number.isFinite(result.metrics.dPrime_position as number)).toBe(true);
    expect(Number.isFinite(result.metrics.dPrime_audio as number)).toBe(true);
  }, 30_000);

  it("keeps a 2x2 grid to its four positions and uses all of them", async () => {
    const seen = new Set<number>();
    let cells = 0;
    // Sampled only while something is lit: the view is torn down before the last
    // frame, so a reading taken unconditionally would just record the empty root.
    const harness = createHarness(root, ({ litCellIndex }) => {
      if (litCellIndex !== null) {
        cells = root.querySelectorAll(".nb-cell").length;
        seen.add(litCellIndex);
      }
      return [];
    });

    const result = await harness.run(
      config({
        modalities: ["position"],
        gridSize: "2",
        n: 1,
        trials: 20,
        stimulusMs: 200,
        isiMs: 200,
      }),
    );

    expect(result.trials).toHaveLength(20);
    expect(cells).toBe(4);
    // A position past the end of the grid lights no cell at all, so the session
    // would run to completion with nothing on screen — scoring a blank stream.
    expect([...seen].every((index) => index >= 0 && index < 4)).toBe(true);
    expect(seen.size).toBe(4);
  }, 30_000);

  it("collapses the grid to one cell when nothing is positional", async () => {
    const drawn = new Set<string>();
    let cells = 0;
    let fixations = 0;
    let strayShape = false;
    const harness = createHarness(root, ({ litCellIndex }) => {
      const paths = [...root.querySelectorAll(".nb-shape path")]
        .map((path) => path.getAttribute("d"))
        .filter((d): d is string => d !== null && d !== "");
      if (litCellIndex === null) {
        // A path left behind would still be on screen during the blank interval
        // and would then reappear under the next trial's colour.
        if (paths.length > 0) strayShape = true;
      } else {
        // Sampled while lit for the same reason as above: the view is gone by the
        // final frame.
        cells = root.querySelectorAll(".nb-cell").length;
        fixations = root.querySelectorAll(".nb-fixation").length;
        for (const d of paths) drawn.add(d);
      }
      return [];
    });

    const result = await harness.run(
      config({ modalities: ["shape"], n: 1, trials: 12, stimulusMs: 200, isiMs: 200 }),
    );

    expect(result.trials).toHaveLength(12);
    // One cell, and no fixation mark to sit on top of the stimulus inside it.
    expect(cells).toBe(1);
    expect(fixations).toBe(0);
    expect(strayShape).toBe(false);
    // The alphabet is actually being used, rather than the same path every trial.
    expect(drawn.size).toBeGreaterThan(2);
    for (const d of drawn) expect(d.startsWith("M")).toBe(true);
  }, 30_000);

  it("leaves no key listeners or DOM behind when it finishes", async () => {
    const added: string[] = [];
    const removed: string[] = [];
    const originalAdd = window.addEventListener.bind(window);
    const originalRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, ...rest) => {
      if (type === "keydown") added.push(type);
      return originalAdd(type, ...(rest as [EventListenerOrEventListenerObject]));
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((type, ...rest) => {
      if (type === "keydown") removed.push(type);
      return originalRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
    });

    const harness = createHarness(root, () => []);
    await harness.run(
      config({ modalities: ["position"], n: 1, trials: 5, stimulusMs: 200, isiMs: 200 }),
    );

    // A leaked keydown listener would keep responding to keys on the results
    // screen, silently corrupting the next session.
    expect(removed.length).toBeGreaterThanOrEqual(added.length);
    expect(root.innerHTML).toBe("");
  }, 30_000);

  it("stops promptly when aborted", async () => {
    let now = 0;
    let callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("performance", { now: () => now });
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
      callbacks.push(cb);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});

    const controller = new AbortController();
    const promise = nbackDef.run({
      config: config({ modalities: ["position"], n: 2, trials: 50 }),
      rng: createRng("abort"),
      seed: "abort",
      deviceProfile: {
        deviceClass: "desktop-keyboard",
        refreshRateHz: 60,
        refreshRateMeasured: true,
        clockResolutionMs: 0.005,
        screen: { width: 1920, height: 1080, dpr: 1 },
        platform: "test",
        measuredAt: 0,
      },
      root,
      signal: controller.signal,
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    for (let i = 0; i < 200; i++) {
      const due = callbacks;
      callbacks = [];
      now += FRAME_MS;
      for (const cb of due) cb(now);
      await Promise.resolve();
    }

    controller.abort();

    for (let i = 0; i < 200; i++) {
      const due = callbacks;
      callbacks = [];
      now += FRAME_MS;
      for (const cb of due) cb(now);
      await Promise.resolve();
    }

    const result = await promise;
    expect(result.aborted).toBe(true);
    expect(root.innerHTML).toBe("");
  }, 30_000);
});
