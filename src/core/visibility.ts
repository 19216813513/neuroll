/**
 * Tab visibility tracking.
 *
 * When a tab goes to the background the browser throttles timers and stops
 * painting. Any trial spanning that moment produces a meaningless reaction time.
 * Rather than trying to salvage those runs we mark them invalid and exclude them
 * from every aggregate — a smaller honest dataset beats a larger polluted one.
 */

import { now } from "./clock";

export interface HiddenInterval {
  from: number;
  to: number;
}

export class VisibilityMonitor {
  private readonly intervals: HiddenInterval[] = [];
  private hiddenSince: number | null = null;
  private detach: (() => void) | null = null;

  start(): void {
    if (this.detach) return;
    // If the session somehow starts while backgrounded, count from now.
    if (document.visibilityState === "hidden") this.hiddenSince = now();

    const listener = (): void => {
      if (document.visibilityState === "hidden") {
        this.hiddenSince ??= now();
      } else if (this.hiddenSince !== null) {
        this.intervals.push({ from: this.hiddenSince, to: now() });
        this.hiddenSince = null;
      }
    };

    document.addEventListener("visibilitychange", listener);
    // A blurred window still paints but no longer receives keys; treat it the same.
    window.addEventListener("blur", listener);
    window.addEventListener("focus", listener);

    this.detach = () => {
      document.removeEventListener("visibilitychange", listener);
      window.removeEventListener("blur", listener);
      window.removeEventListener("focus", listener);
    };
  }

  stop(): void {
    if (this.hiddenSince !== null) {
      this.intervals.push({ from: this.hiddenSince, to: now() });
      this.hiddenSince = null;
    }
    this.detach?.();
    this.detach = null;
  }

  /** Total milliseconds spent hidden, including an interval still in progress. */
  hiddenMs(): number {
    const closed = this.intervals.reduce((sum, i) => sum + (i.to - i.from), 0);
    const open = this.hiddenSince === null ? 0 : now() - this.hiddenSince;
    return closed + open;
  }

  wasEverHidden(): boolean {
    return this.intervals.length > 0 || this.hiddenSince !== null;
  }

  /** True if the given time window overlaps any hidden interval. */
  overlapsHidden(from: number, to: number): boolean {
    if (this.hiddenSince !== null && to >= this.hiddenSince) return true;
    return this.intervals.some((i) => from <= i.to && to >= i.from);
  }

  snapshot(): HiddenInterval[] {
    return [...this.intervals];
  }
}
