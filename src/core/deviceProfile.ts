/**
 * Device profiling.
 *
 * Absolute reaction times are not portable. Display refresh rate, panel latency,
 * input device and browser each shift them by tens of milliseconds. A 240ms mean
 * on a 144Hz desktop and a 290ms mean on a phone can reflect identical ability.
 *
 * So we record what we can measure, derive a coarse `deviceClass`, and fold that
 * class into the score bucket (see scores/bucket.ts). Records from different
 * classes then never silently compete for the same personal best.
 *
 * The class is deliberately coarse. Hashing the full user-agent would create a new
 * bucket on every browser update and fragment the history into uselessness.
 */

import { probeClockResolutionMs } from "./clock";

export type DeviceClass = "desktop-keyboard" | "desktop-pointer" | "mobile-touch" | "unknown";

export interface DeviceProfile {
  deviceClass: DeviceClass;
  refreshRateHz: number;
  clockResolutionMs: number;
  screen: { width: number; height: number; dpr: number };
  platform: string;
  measuredAt: number;
  /**
   * False when the refresh rate is an assumed default rather than a measurement.
   * Happens when the page loads in a background tab, where rAF never fires.
   */
  refreshRateMeasured: boolean;
}

/** Assumed when measurement is impossible. The most common panel rate. */
const FALLBACK_REFRESH_HZ = 60;

/** How long to wait for frames before giving up and using the fallback. */
const REFRESH_MEASURE_TIMEOUT_MS = 3000;

/**
 * Estimates refresh rate by timing animation frames.
 *
 * Uses the median interval rather than the mean: a single hitch during sampling
 * would drag a mean badly, while the median ignores it. Snaps to the nearest
 * common rate because the raw estimate lands on values like 59.7 or 143.6, and
 * an unstable number would keep changing the recorded profile.
 */
export interface RefreshRateEstimate {
  hz: number;
  measured: boolean;
}

export function measureRefreshRate(frames = 120): Promise<RefreshRateEstimate> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let previous = 0;
    let remaining = frames;
    let settled = false;

    const finish = (estimate: RefreshRateEstimate): void => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(estimate);
    };

    // A backgrounded tab gets no animation frames at all, so without this the
    // promise would never settle and the app would hang on the loading state.
    // setTimeout still fires there (throttled, but it fires).
    const watchdog = setTimeout(() => {
      if (intervals.length >= 10) {
        finish({ hz: rateFromIntervals(intervals), measured: true });
      } else {
        finish({ hz: FALLBACK_REFRESH_HZ, measured: false });
      }
    }, REFRESH_MEASURE_TIMEOUT_MS);

    const step = (timestamp: number): void => {
      if (previous !== 0) intervals.push(timestamp - previous);
      previous = timestamp;
      remaining -= 1;
      if (remaining > 0) {
        requestAnimationFrame(step);
        return;
      }
      finish(
        intervals.length === 0
          ? { hz: FALLBACK_REFRESH_HZ, measured: false }
          : { hz: rateFromIntervals(intervals), measured: true },
      );
    };

    requestAnimationFrame(step);
  });
}

/** Median-based so a single hitch during sampling cannot skew the estimate. */
function rateFromIntervals(intervals: readonly number[]): number {
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] as number;
  return snapToCommonRate(1000 / median);
}

const COMMON_RATES = [30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 240, 360];

function snapToCommonRate(estimate: number): number {
  let best = COMMON_RATES[0] as number;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const rate of COMMON_RATES) {
    const distance = Math.abs(rate - estimate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = rate;
    }
  }
  // Only snap if we are reasonably close; otherwise report what we saw.
  return bestDistance <= best * 0.08 ? best : Math.round(estimate);
}

function detectDeviceClass(): DeviceClass {
  if (typeof window === "undefined") return "unknown";

  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const noHover = window.matchMedia?.("(hover: none)").matches ?? false;
  const touchPoints = navigator.maxTouchPoints ?? 0;

  // A touchscreen laptop reports touch points but still has hover and a fine
  // pointer, so require both signals before calling something mobile.
  if (coarsePointer && noHover && touchPoints > 0) return "mobile-touch";

  // Desktop splits by what the exercise will actually be driven with. We cannot
  // know that here, so default to keyboard and let callers override per exercise.
  return "desktop-keyboard";
}

function detectPlatform(): string {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (data?.platform) return data.platform;
  // Fall back to a very coarse UA sniff. We only need it to be stable, not precise.
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua)) return "macOS";
  if (/Win/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "unknown";
}

export async function measureDeviceProfile(): Promise<DeviceProfile> {
  const refresh = await measureRefreshRate();
  return {
    deviceClass: detectDeviceClass(),
    refreshRateHz: refresh.hz,
    refreshRateMeasured: refresh.measured,
    clockResolutionMs: probeClockResolutionMs(),
    screen: {
      width: window.screen?.width ?? 0,
      height: window.screen?.height ?? 0,
      dpr: window.devicePixelRatio ?? 1,
    },
    platform: detectPlatform(),
    measuredAt: Date.now(),
  };
}

/**
 * Half a refresh period — the average delay between a stimulus being composited
 * and the panel actually lighting it up, assuming presentation is uniformly
 * distributed within the frame. Reported alongside raw reaction times so the
 * scale of the unavoidable measurement floor is visible.
 */
export const framePenaltyMs = (profile: DeviceProfile): number =>
  profile.refreshRateHz > 0 ? 500 / profile.refreshRateHz : 8.33;
