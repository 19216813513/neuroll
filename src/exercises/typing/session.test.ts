// @vitest-environment happy-dom

/**
 * End-to-end test of the typing session loop.
 *
 * Same approach as the N-back session test: rAF and `performance.now()` are
 * replaced with a virtual clock, so a sixty-second run finishes in milliseconds
 * and the things a screenshot could never show become observable — that the loop
 * terminates, that the deadline is honoured to the millisecond, that the timer
 * starts on the first keystroke rather than on the reveal, and that nothing is
 * left attached to the window afterwards.
 *
 * The typist is written to be stateless: every frame it reads the caret out of
 * the DOM and types whatever character the caret is sitting on. That matters
 * because the session needs a couple of frames to paint and attach its listener,
 * so the first keystrokes can land before anything is listening. A typist that
 * tracked its own position would silently desynchronise from the text; this one
 * simply retypes the same character until the caret moves, exactly as a person
 * would if a key did not register.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRng } from "~/core/rng";
import type { Config, RunResult } from "~/exercises/types";
import { defaultConfig } from "~/exercises/types";
import { typingDef } from "./def";

const FRAME_MS = 1000 / 60;

const DEVICE_PROFILE = {
  deviceClass: "desktop-keyboard",
  refreshRateHz: 60,
  refreshRateMeasured: true,
  clockResolutionMs: 0.005,
  screen: { width: 1920, height: 1080, dpr: 1 },
  platform: "test",
  measuredAt: 0,
} as const;

type Policy = (context: { frame: number; typed: number }) => string[] | null;

/**
 * Reads the next key to press straight out of the rendered text.
 * Returns null when there is nothing to type — before the session starts, and
 * after it has torn its view down.
 */
function nextKey(root: HTMLElement): string | null {
  const word = root.querySelector(".tp-word.is-active");
  if (!word) return null;
  if (word.classList.contains("is-caret-end")) return " ";
  const caret = word.querySelector(".tp-char.is-caret");
  return caret?.textContent ?? null;
}

interface Harness {
  run(config: Config, signal?: AbortSignal): Promise<RunResult>;
}

function createHarness(root: HTMLElement, policy?: Policy): Harness {
  let now = 0;
  let frame = 0;
  let typed = 0;
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

    const override = policy?.({ frame, typed });
    const keys = override ?? (nextKey(root) === null ? [] : [nextKey(root) as string]);
    for (const key of keys) {
      typed += 1;
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }

    for (const cb of due) cb(now);
  };

  return {
    async run(config, signal) {
      const controller = new AbortController();
      signal?.addEventListener("abort", () => controller.abort());
      let settled = false;
      const promise = typingDef
        .run({
          config,
          rng: createRng("harness-seed"),
          seed: "harness-seed",
          deviceProfile: { ...DEVICE_PROFILE },
          root,
          signal: controller.signal,
        })
        .finally(() => {
          settled = true;
        });

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", bubbles: true }));

      for (let i = 0; i < 200_000 && !settled; i++) {
        pump();
        await Promise.resolve();
      }

      return promise;
    },
  };
}

function config(overrides: Config = {}): Config {
  return { ...defaultConfig(typingDef), ...overrides };
}

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  root.remove();
});

describe("typing session", () => {
  it("runs a word-count session to completion and scores every word", async () => {
    const harness = createHarness(root);
    const result = await harness.run(config({ endMode: "words", wordCount: 10 }));

    expect(result.aborted).toBeFalsy();
    expect(result.metrics.words).toBe(10);
    // Typed straight off the caret, so there is nothing to get wrong.
    expect(result.metrics.accuracy).toBeCloseTo(100, 6);
    expect(result.metrics.errors).toBe(0);
    expect(result.primaryScore).toBeGreaterThan(0);
  }, 30_000);

  it("ends a timed session exactly on the deadline", async () => {
    // Ten keystrokes, then the participant stops. The run must still last the
    // full fifteen seconds rather than ending when the typing does.
    const harness = createHarness(root, ({ typed }) => {
      if (typed >= 10) return [];
      const key = nextKey(root);
      return key === null ? [] : [key];
    });
    const result = await harness.run(config({ endMode: "time", durationSec: 15 }));

    expect(result.aborted).toBeFalsy();
    const chars = result.metrics.chars as number;
    expect(chars).toBeGreaterThan(0);
    expect(chars).toBeLessThan(15);
    // WPM is characters / 5 / minutes. Asserting the identity is what pins the
    // elapsed window to exactly 15s: any other value moves this number.
    expect(result.metrics.wpm).toBeCloseTo(chars / 5 / (15 / 60), 6);
  }, 30_000);

  it("starts the clock on the first keystroke, not when the text appears", async () => {
    // Idle for a second of virtual time before typing anything. If the reveal
    // started the clock, that second would be charged to the score.
    const idleFrames = 60;
    const harness = createHarness(root, ({ frame, typed }) => {
      if (frame < idleFrames) return [];
      if (typed >= 10) return [];
      const key = nextKey(root);
      return key === null ? [] : [key];
    });
    const result = await harness.run(config({ endMode: "time", durationSec: 15 }));

    const chars = result.metrics.chars as number;
    expect(result.metrics.wpm).toBeCloseTo(chars / 5 / (15 / 60), 6);
    // The session as a whole ran longer than the measured window by the wait.
    expect(result.durationMs).toBeGreaterThan(15_000 + (idleFrames - 1) * FRAME_MS);
  }, 30_000);

  it("records one trial per keystroke, with the interval on the response", async () => {
    const harness = createHarness(root);
    const result = await harness.run(config({ endMode: "words", wordCount: 5 }));

    expect(result.trials.length).toBeGreaterThan(10);
    for (const trial of result.trials) {
      // Deliberately null: scores/validate.ts reads rtMs as a reaction latency
      // and flags anything under 100ms, which would condemn every good typing
      // run. The interval lives on the response instead.
      expect(trial.rtMs).toBeNull();
    }
    const intervals = result.trials
      .map((trial) => (trial.response as { ikiMs: number | null }).ikiMs)
      .filter((iki): iki is number => iki !== null);
    expect(intervals.length).toBe(result.trials.length - 1);
    for (const iki of intervals) expect(Number.isFinite(iki)).toBe(true);
  }, 30_000);

  it("scores a mistyped character as an error without stopping in free mode", async () => {
    const harness = createHarness(root, ({ typed }) => {
      const key = nextKey(root);
      if (key === null) return [];
      // One wrong letter, early on, in a word rather than on a space.
      if (typed === 2 && key !== " ") return [key === "z" ? "q" : "z"];
      return [key];
    });
    const result = await harness.run(config({ endMode: "words", wordCount: 6, onMiss: "free" }));

    expect(result.aborted).toBeFalsy();
    expect(result.metrics.words).toBe(6);
    expect(result.metrics.errors as number).toBeGreaterThan(0);
    expect(result.metrics.accuracy as number).toBeLessThan(100);
    // Net WPM counts what stands; gross counts what was attempted.
    expect(result.metrics.wpm as number).toBeLessThan(result.metrics.wpmGross as number);
  }, 30_000);

  it("shows the character that was typed, not the one that was wanted", async () => {
    let shown = "";
    let restored = "";
    const harness = createHarness(root, ({ frame }) => {
      const key = nextKey(root);
      if (key === null) return [];
      if (frame === 8 && key !== " ") return ["\u0071" === key ? "z" : "q"];
      if (frame === 9) {
        // The wrong letter is on screen as the letter the fingers actually hit.
        shown = root.querySelector(".tp-char.is-wrong")?.textContent ?? "";
        return ["Backspace"];
      }
      if (frame === 10) {
        // And undoing it puts the prompt back, rather than leaving the typo.
        restored = root.querySelector(".tp-word.is-active")?.textContent ?? "";
        return [];
      }
      return [key];
    });
    const result = await harness.run(config({ endMode: "words", wordCount: 5 }));

    expect(["q", "z"]).toContain(shown);
    expect(restored).not.toContain(shown);
    expect(restored).toMatch(/^[a-z]+$/);
    // The correction cost accuracy but left the text clean.
    expect(result.metrics.errors).toBe(0);
    expect(result.metrics.corrections as number).toBeGreaterThan(0);
    expect(result.metrics.accuracy as number).toBeLessThan(100);
  }, 30_000);

  it("refuses to advance past a wrong character in strict mode", async () => {
    let rejected = 0;
    const harness = createHarness(root, ({ frame }) => {
      const key = nextKey(root);
      if (key === null) return [];
      // Spend ten frames pushing a wrong letter before typing correctly.
      if (frame > 5 && frame <= 15 && key !== " ") {
        rejected += 1;
        return [key === "z" ? "q" : "z"];
      }
      return [key];
    });
    const result = await harness.run(config({ endMode: "words", wordCount: 5, onMiss: "strict" }));

    expect(rejected).toBeGreaterThan(0);
    // Every rejected keystroke cost accuracy, and none of them reached the text.
    expect(result.metrics.errors).toBe(0);
    expect(result.metrics.accuracy as number).toBeLessThan(100);
    expect(result.metrics.words).toBe(5);
  }, 30_000);

  it("warns instead of scoring when the IME is on", async () => {
    let warned = "";
    const harness = createHarness(root, ({ frame }) => {
      if (frame < 10) return ["Process"];
      if (frame === 10) warned = root.querySelector(".tp-warning")?.textContent ?? "";
      const key = nextKey(root);
      return key === null ? [] : [key];
    });
    const result = await harness.run(config({ endMode: "words", wordCount: 4 }));

    // Composition keys carry no character, so a run that scored them would be
    // measuring nothing. Saying so beats dropping the keys silently.
    expect(warned).not.toBe("");
    expect(result.metrics.accuracy).toBeCloseTo(100, 6);
    expect(result.metrics.words).toBe(4);
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

    const harness = createHarness(root);
    await harness.run(config({ endMode: "words", wordCount: 4 }));

    // A leaked keydown listener would keep eating keys on the results screen,
    // where Space is the retry button.
    expect(removed.length).toBeGreaterThanOrEqual(added.length);
    expect(root.innerHTML).toBe("");
  }, 30_000);

  it("stops promptly when aborted", async () => {
    const controller = new AbortController();
    const harness = createHarness(root, ({ frame }) => {
      if (frame === 30) controller.abort();
      const key = nextKey(root);
      return key === null ? [] : [key];
    });
    const result = await harness.run(
      config({ endMode: "time", durationSec: 120 }),
      controller.signal,
    );

    expect(result.aborted).toBe(true);
    expect(Number.isNaN(result.primaryScore)).toBe(true);
    // The trials typed before quitting are still handed back, so an aborted run
    // can be inspected even though it is never scored.
    expect(result.trials.length).toBeGreaterThan(0);
    expect(root.innerHTML).toBe("");
  }, 30_000);
});
