// @vitest-environment happy-dom

/**
 * The shared start gate.
 *
 * All three exercises now open through `waitForStartSignal`, so its edge cases
 * are the edge cases of every session: a phone with no keyboard has to get in, a
 * desktop key has to get in, and Escape has to stay out — it belongs to the quit
 * handler, and a gate that swallowed it would make the session unleavable from
 * the ready screen.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForStartSignal } from "./input";

/** Resolves to "pending" if the gate has not opened within a few macrotasks. */
async function settledOrPending(promise: Promise<void>): Promise<"opened" | "pending"> {
  return Promise.race([
    promise.then(() => "opened" as const),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20)),
  ]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waitForStartSignal", () => {
  it("opens on a key", async () => {
    const gate = waitForStartSignal(new AbortController().signal);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await expect(gate).resolves.toBeUndefined();
  });

  it("opens on a tap anywhere, not just on the exercise", async () => {
    const gate = waitForStartSignal(new AbortController().signal);
    // Dispatched on the body: the exercise host is only as tall as its stage, so
    // a tap in the margin has to count or a phone can be left with no way in.
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    await expect(gate).resolves.toBeUndefined();
  });

  it("does not open on Escape, and lets it through to the quit handler", async () => {
    const gate = waitForStartSignal(new AbortController().signal);
    const escapeKey = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(escapeKey);

    expect(await settledOrPending(gate)).toBe("pending");
    // Prevented Escape would still reach the shell, but cancelling the key that
    // exists to leave the session is the wrong default to set.
    expect(escapeKey.defaultPrevented).toBe(false);

    // Still working afterwards: Escape is ignored, not fatal.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    await expect(gate).resolves.toBeUndefined();
  });

  it("rejects when the session is aborted while waiting", async () => {
    const controller = new AbortController();
    const gate = waitForStartSignal(controller.signal);
    controller.abort();
    await expect(gate).rejects.toThrow("aborted");
  });

  it("stops listening once it has opened", async () => {
    const removals: string[] = [];
    const originalRemove = window.removeEventListener.bind(window);
    vi.spyOn(window, "removeEventListener").mockImplementation((type, ...rest) => {
      removals.push(String(type));
      return originalRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
    });

    const gate = waitForStartSignal(new AbortController().signal);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await gate;

    // A gate left listening would keep answering keys for the rest of the run.
    expect(removals).toContain("keydown");
    expect(removals).toContain("pointerdown");
  });
});
