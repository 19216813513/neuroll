/**
 * Audio stimuli.
 *
 * Design note: standard dual n-back uses spoken letters. This implementation
 * uses distinct musical pitches instead, for two reasons.
 *
 * 1. Timing. `<audio>` elements and `SpeechSynthesis` both have unpredictable
 *    start latency — tens of milliseconds, varying per call and per platform.
 *    In an exercise whose entire value is accurate stimulus timing, that is
 *    disqualifying. Buffers scheduled through Web Audio start at a time we name.
 *
 * 2. No assets. Recorded letters would mean shipping and cache-priming a set of
 *    audio files, and would need one set per language.
 *
 * The working-memory load is equivalent: what matters is a set of discriminable
 * auditory tokens, not that they are phonemes. Recorded letters can be added
 * later as an alternative sound set without touching the exercise logic.
 */

/**
 * Pitches for the audio stream: a pentatonic-ish set chosen so that neighbouring
 * tokens are never a semitone apart. Close intervals are easy to confuse, which
 * would add perceptual difficulty rather than memory difficulty — the wrong kind
 * of hard for this exercise.
 */
const TONE_FREQUENCIES = [
  261.63, // C4
  329.63, // E4
  392.0, // G4
  466.16, // A#4
  523.25, // C5
  659.25, // E5
  783.99, // G5
  932.33, // A#5
];

export const AUDIO_ALPHABET_SIZE = TONE_FREQUENCIES.length;

const TONE_DURATION_S = 0.28;

/**
 * How long to wait for a suspended context to start before giving up on sound.
 *
 * `resume()` does not reject when the browser declines to start audio without a
 * user gesture — it returns a promise that never settles. Awaiting that inside an
 * exercise stops the session before it has drawn anything, and because it never
 * reaches a point where the abort signal is observed, Escape cannot get out of it
 * either: a blank screen with no way back. Bounding the wait turns a dead session
 * into a silent one, which the exercises already know how to handle.
 *
 * `setTimeout` is the right tool here despite PLAN §4.1: this is setup, not
 * stimulus timing, and being throttled to a second in a background tab is
 * harmless when the deadline is measured in seconds.
 */
const RESUME_TIMEOUT_MS = 1500;

/** Resumes the context, or returns anyway once the deadline passes. */
async function resumeWithin(context: AudioContext, timeoutMs: number): Promise<void> {
  let timer = 0;
  try {
    await Promise.race([
      context.resume(),
      new Promise<void>((resolve) => {
        timer = window.setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private buffers: AudioBuffer[] = [];
  private gain: GainNode | null = null;
  private volume = 0.7;

  /**
   * Creates the context and renders every tone up front.
   *
   * Must be called from a user gesture — browsers start an AudioContext
   * suspended otherwise. Rendering here rather than at first use keeps buffer
   * creation out of the trial loop, where an allocation could cost a frame.
   */
  async init(): Promise<void> {
    if (this.context) {
      // Kept rather than discarded on a timeout: a later session started from a
      // real gesture can still bring this context up.
      if (this.context.state === "suspended") {
        await resumeWithin(this.context, RESUME_TIMEOUT_MS);
      }
      return;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const context = new Ctor();
    this.context = context;

    this.gain = context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(context.destination);

    this.buffers = TONE_FREQUENCIES.map((frequency) => renderTone(context, frequency));

    if (context.state === "suspended") await resumeWithin(context, RESUME_TIMEOUT_MS);
  }

  setVolume(volume0to1: number): void {
    this.volume = Math.min(1, Math.max(0, volume0to1));
    if (this.gain) this.gain.gain.value = this.volume;
  }

  /** Fires tone `index` immediately. Returns without waiting for it to finish. */
  play(index: number): void {
    const context = this.context;
    const buffer = this.buffers[index];
    if (!context || !buffer || !this.gain) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    source.start();
  }

  /**
   * Whether playing a tone will actually be heard.
   *
   * "Running", not merely "exists": a suspended context accepts `play()` and
   * emits nothing, so treating it as ready would leave the participant with a
   * stream they cannot hear and no on-screen glyph in its place — a dual n-back
   * silently reduced to a single one, still scored as if both streams were there.
   */
  get ready(): boolean {
    return this.context?.state === "running" && this.buffers.length > 0;
  }

  close(): void {
    void this.context?.close();
    this.context = null;
    this.buffers = [];
    this.gain = null;
  }
}

/**
 * Renders one tone into a buffer.
 *
 * The envelope matters: a raw sine that starts and stops at full amplitude
 * produces an audible click at both edges, and the click is a sharper onset cue
 * than the tone itself — participants would end up timing the click.
 */
function renderTone(context: AudioContext, frequency: number): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.floor(sampleRate * TONE_DURATION_S);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);

  const attack = Math.floor(sampleRate * 0.008);
  const release = Math.floor(sampleRate * 0.06);

  for (let i = 0; i < length; i++) {
    const t = i / sampleRate;
    let envelope = 1;
    if (i < attack) envelope = i / attack;
    else if (i > length - release) envelope = (length - i) / release;
    // A little second harmonic gives the tone enough character to be told apart
    // by timbre as well as pitch.
    const sample =
      Math.sin(2 * Math.PI * frequency * t) + 0.25 * Math.sin(4 * Math.PI * frequency * t);
    data[i] = sample * envelope * 0.35;
  }

  return buffer;
}

/** Shared instance — one AudioContext per page is the supported pattern. */
export const audioEngine = new AudioEngine();
