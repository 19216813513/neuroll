// @vitest-environment happy-dom

/**
 * The audio engine's failure modes, which are the interesting part.
 *
 * A browser that declines to start audio does not say so: `resume()` returns a
 * promise that never settles. Awaiting that where an exercise awaits it — before
 * the first paint, before the abort signal is ever checked — leaves a blank
 * session that Escape cannot leave. That is the case these tests pin down; the
 * tone rendering itself is verified by ear, not here.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio";

type ContextState = "suspended" | "running" | "closed";

/** The parts of AudioContext the engine touches, and nothing else. */
class FakeAudioContext {
  state: ContextState = "suspended";
  sampleRate = 48_000;
  destination = {};
  resumeCalls = 0;

  constructor(private readonly resumeBehaviour: "never" | "resolves") {}

  resume(): Promise<void> {
    this.resumeCalls++;
    if (this.resumeBehaviour === "never") {
      // Chrome's actual behaviour without a user gesture: not a rejection, just
      // a promise that is never settled.
      return new Promise<void>(() => {});
    }
    this.state = "running";
    return Promise.resolve();
  }

  createGain() {
    return { gain: { value: 0 }, connect: () => {} };
  }

  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }

  createBufferSource() {
    return { buffer: null, connect: () => {}, start: () => {} };
  }

  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }
}

function stubAudioContext(behaviour: "never" | "resolves"): { last: FakeAudioContext | null } {
  const made: { last: FakeAudioContext | null } = { last: null };
  class TrackedAudioContext extends FakeAudioContext {
    constructor() {
      super(behaviour);
      made.last = this;
    }
  }
  vi.stubGlobal("AudioContext", TrackedAudioContext);
  return made;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AudioEngine.init", () => {
  it("gives up on a context that never starts, instead of hanging forever", async () => {
    vi.useFakeTimers();
    stubAudioContext("never");
    const engine = new AudioEngine();

    let settled = false;
    const init = engine.init().then(() => {
      settled = true;
    });

    // Before the deadline it is still waiting, which is correct: audio that takes
    // a moment to start should be waited for.
    await vi.advanceTimersByTimeAsync(1000);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(600);
    await init;
    expect(settled).toBe(true);
  });

  it("reports itself not ready when the context never started", async () => {
    vi.useFakeTimers();
    stubAudioContext("never");
    const engine = new AudioEngine();

    const init = engine.init();
    await vi.advanceTimersByTimeAsync(2000);
    await init;

    // The buffers exist and `play()` would be accepted, but nothing would be
    // heard. Exercises read this to decide whether to show the glyph instead, so
    // a false "ready" here is a dual n-back quietly scored as if it had sound.
    expect(engine.ready).toBe(false);
  });

  it("is ready once the context actually starts", async () => {
    stubAudioContext("resolves");
    const engine = new AudioEngine();

    await engine.init();

    expect(engine.ready).toBe(true);
  });

  it("retries a context that has not started yet, so a later gesture can revive it", async () => {
    vi.useFakeTimers();
    const made = stubAudioContext("never");
    const engine = new AudioEngine();

    const first = engine.init();
    await vi.advanceTimersByTimeAsync(2000);
    await first;

    const second = engine.init();
    await vi.advanceTimersByTimeAsync(2000);
    await second;

    // Same context, asked again — not discarded, and not a second context piling
    // up on a page that is only allowed one.
    expect(made.last?.resumeCalls).toBe(2);
  });
});
