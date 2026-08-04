/**
 * The single time source for the whole app.
 *
 * Rule: every timestamp that ends up in a Run comes from here, never from
 * `Date.now()`. `Date.now()` is wall-clock and jumps when NTP corrects it or the
 * user changes timezone — a jump of even a few ms would silently corrupt reaction
 * times. `performance.now()` is monotonic and shares its origin with DOM event
 * `timeStamp`, which is what lets us subtract the two directly (see input.ts).
 */

/** Monotonic time in milliseconds since page load. */
export const now = (): number => performance.now();

/** Wall-clock time, for "when did this run happen" only — never for durations. */
export const wallClock = (): number => Date.now();

/**
 * Measures the effective resolution of `performance.now()`.
 *
 * Browsers deliberately coarsen this clock as a Spectre mitigation (typically to
 * 5µs–100µs, sometimes 1ms with extra isolation disabled). We are measuring in
 * milliseconds so any of those is fine, but we record what we actually got so a
 * surprisingly coarse clock is visible in the data rather than hidden.
 */
export function probeClockResolutionMs(samples = 5000): number {
  let smallestDelta = Number.POSITIVE_INFINITY;
  let previous = performance.now();
  for (let i = 0; i < samples; i++) {
    const current = performance.now();
    const delta = current - previous;
    if (delta > 0 && delta < smallestDelta) smallestDelta = delta;
    previous = current;
  }
  return Number.isFinite(smallestDelta) ? smallestDelta : 0;
}

/**
 * Resolves on the frame *after* the callback paints, handing back that frame's
 * timestamp.
 *
 * This is how we date a stimulus. Mutating the DOM inside a rAF callback does not
 * put pixels on screen — the compositor does that at the next vsync. The following
 * rAF callback fires at (approximately) that vsync, so its timestamp is the closest
 * thing the platform gives us to "when the user could first see it".
 *
 * Using `now()` right after the DOM write instead would systematically report the
 * stimulus as earlier than it really was, inflating every reaction time by up to a
 * full frame.
 */
export function paintAndTimestamp(mutate: () => void): Promise<number> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      mutate();
      requestAnimationFrame((displayedAt) => resolve(displayedAt));
    });
  });
}

/** A rAF-based sleep. Unlike setTimeout it is not throttled to 4ms clamping. */
export function waitFrames(count: number): Promise<number> {
  return new Promise((resolve) => {
    let remaining = count;
    const step = (timestamp: number): void => {
      remaining -= 1;
      if (remaining <= 0) resolve(timestamp);
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
