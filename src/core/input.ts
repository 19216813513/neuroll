/**
 * Input timestamp normalization.
 *
 * A reaction time is `responseTime - stimulusTime`. The naive way to get
 * `responseTime` is to call `performance.now()` inside the event handler — but
 * that measures when *JavaScript got around to running*, not when the user acted.
 * Anything queued ahead of us on the event loop (a render, a GC pause, another
 * handler) is added straight onto the reaction time.
 *
 * `event.timeStamp` is set by the browser when the input was received, before it
 * enters the JS queue, and in modern browsers it shares the `performance.now()`
 * time origin. So we use it directly, and only fall back when it looks wrong.
 */

import { now } from "./clock";

/**
 * Extracts a `performance.now()`-comparable timestamp from a DOM event.
 *
 * Guards against two historical quirks:
 *  - `timeStamp === 0`, seen for synthetic and some untrusted events
 *  - epoch-based timestamps (very old Firefox), which are ~1e12 rather than ~1e5
 * In both cases we fall back to the handler-entry time, which is late but sane.
 */
export function eventTime(event: Event): number {
  const fallback = now();
  const stamp = event.timeStamp;

  if (!Number.isFinite(stamp) || stamp <= 0) return fallback;
  // An epoch-based stamp is astronomically larger than any page uptime.
  if (stamp > fallback + 60_000) return fallback;
  // A stamp from before the page loaded is equally nonsensical.
  if (stamp < 0) return fallback;

  return stamp;
}

/** True when the event carries a real user gesture rather than a script-made one. */
export const isTrusted = (event: Event): boolean => event.isTrusted !== false;

export interface KeyResponse {
  key: string;
  at: number;
  trusted: boolean;
  repeat: boolean;
}

export interface KeyListenerOptions {
  /** Lowercase keys to accept. Omit to accept every key. */
  accept?: readonly string[];
  /** Ignore auto-repeat from a held-down key. Defaults to true. */
  ignoreRepeat?: boolean;
  /** Call preventDefault on accepted keys (e.g. to stop Space scrolling). */
  preventDefault?: boolean;
}

/**
 * Attaches a keydown listener that reports normalized timestamps.
 * Returns a disposer; callers must invoke it when the session ends.
 */
export function onKey(
  handler: (response: KeyResponse) => void,
  options: KeyListenerOptions = {},
): () => void {
  const { accept, ignoreRepeat = true, preventDefault = true } = options;
  const allowed = accept ? new Set(accept.map((k) => k.toLowerCase())) : null;

  const listener = (event: KeyboardEvent): void => {
    if (ignoreRepeat && event.repeat) return;
    const key = event.key.toLowerCase();
    if (allowed && !allowed.has(key)) return;
    if (preventDefault) event.preventDefault();
    handler({
      key,
      at: eventTime(event),
      trusted: isTrusted(event),
      repeat: event.repeat,
    });
  };

  // `capture` so a session always sees the key before any UI widget swallows it.
  window.addEventListener("keydown", listener, { capture: true });
  return () => window.removeEventListener("keydown", listener, { capture: true });
}

export interface PointerResponse {
  at: number;
  trusted: boolean;
  target: EventTarget | null;
  x: number;
  y: number;
}

/** Pointer equivalent of `onKey`, for grid-tapping exercises. */
export function onPointerDown(
  element: HTMLElement,
  handler: (response: PointerResponse) => void,
): () => void {
  const listener = (event: PointerEvent): void => {
    handler({
      at: eventTime(event),
      trusted: isTrusted(event),
      target: event.target,
      x: event.clientX,
      y: event.clientY,
    });
  };
  element.addEventListener("pointerdown", listener);
  return () => element.removeEventListener("pointerdown", listener);
}
