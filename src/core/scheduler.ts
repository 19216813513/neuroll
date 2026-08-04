/**
 * Frame-accurate scheduling for stimulus presentation.
 *
 * `setTimeout` is unsuitable here on two counts: it is clamped to 4ms after a few
 * nested calls, and it is throttled hard in background tabs. It also fires at
 * arbitrary points relative to the display refresh, so a stimulus scheduled for
 * "500ms" can land anywhere within a frame. Everything here is driven by
 * `requestAnimationFrame`, which is tied to the actual vsync.
 */

import { now } from "./clock";

/**
 * Resolves on the first animation frame at or after `targetTime`.
 * Resolves with that frame's timestamp, which will usually overshoot the target
 * slightly — the caller should record the returned value, not the target.
 */
export function waitUntil(targetTime: number, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortError());
      return;
    }
    let handle = 0;
    const onAbort = (): void => {
      cancelAnimationFrame(handle);
      reject(new AbortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const step = (timestamp: number): void => {
      if (timestamp >= targetTime) {
        signal?.removeEventListener("abort", onAbort);
        resolve(timestamp);
      } else {
        handle = requestAnimationFrame(step);
      }
    };
    handle = requestAnimationFrame(step);
  });
}

/** Frame-driven delay relative to the current time. */
export const delay = (ms: number, signal?: AbortSignal): Promise<number> =>
  waitUntil(now() + ms, signal);

export class AbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

export interface FrameStats {
  frames: number;
  /** Wall time the monitor was running, in ms. */
  durationMs: number;
  medianIntervalMs: number;
  /**
   * Frames the browser failed to deliver on time. Counted as the number of extra
   * refresh periods that elapsed between consecutive callbacks, so one callback
   * arriving three periods late counts as two dropped frames.
   */
  droppedFrames: number;
  /** Longest gap between consecutive frames. A proxy for the worst hitch. */
  worstGapMs: number;
  /** Gaps beyond 50ms, i.e. long tasks that blocked rendering. */
  longStalls: number;
}

/**
 * Records frame delivery during a session.
 *
 * This is the instrument for the Phase 0 exit criterion "zero dropped frames" —
 * without it we would be asserting smoothness by feel. It is cheap enough
 * (one number pushed per frame, no allocation after warmup) to leave on always.
 */
export class FrameMonitor {
  private intervals: number[] = [];
  private handle = 0;
  private previous = 0;
  private startedAt = 0;
  private stoppedAt = 0;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.intervals = [];
    this.previous = 0;
    this.startedAt = now();

    const step = (timestamp: number): void => {
      if (!this.running) return;
      if (this.previous !== 0) this.intervals.push(timestamp - this.previous);
      this.previous = timestamp;
      this.handle = requestAnimationFrame(step);
    };
    this.handle = requestAnimationFrame(step);
  }

  stop(): void {
    this.running = false;
    this.stoppedAt = now();
    cancelAnimationFrame(this.handle);
  }

  stats(): FrameStats {
    const intervals = this.intervals;
    const durationMs = (this.stoppedAt || now()) - this.startedAt;
    if (intervals.length === 0) {
      return {
        frames: 0,
        durationMs,
        medianIntervalMs: 0,
        droppedFrames: 0,
        worstGapMs: 0,
        longStalls: 0,
      };
    }

    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] as number;

    // Judge drops against the observed median rather than an assumed 60Hz, so
    // 120Hz and 144Hz displays are not scored as permanently dropping frames.
    let dropped = 0;
    let worst = 0;
    let stalls = 0;
    for (const interval of intervals) {
      if (interval > worst) worst = interval;
      if (interval > 50) stalls++;
      // 1.5x median tolerates normal jitter; beyond that a refresh was missed.
      if (interval > median * 1.5) dropped += Math.round(interval / median) - 1;
    }

    return {
      frames: intervals.length + 1,
      durationMs,
      medianIntervalMs: median,
      droppedFrames: dropped,
      worstGapMs: worst,
      longStalls: stalls,
    };
  }
}
