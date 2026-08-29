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
      if (this.context.state === "suspended") await this.context.resume();
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

    if (context.state === "suspended") await context.resume();
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

  get ready(): boolean {
    return this.context !== null && this.buffers.length > 0;
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
