export type SoundName = 'accepted' | 'piece' | 'problem' | 'unrecognized' | 'error' | 'completed';

export const soundLabels: Record<SoundName, string> = {
  accepted: 'Принято',
  piece: 'Штучный товар',
  problem: 'Проблема',
  unrecognized: 'Не распознано',
  error: 'Ошибка',
  completed: 'Очередь собрана',
};

type Tone = { frequency: number; delay: number; duration: number; volume?: number };

const patterns: Record<SoundName, Tone[]> = {
  accepted: [
    { frequency: 523, delay: 0, duration: 0.09 },
    { frequency: 659, delay: 0.1, duration: 0.12 },
  ],
  piece: [
    { frequency: 740, delay: 0, duration: 0.09 },
    { frequency: 740, delay: 0.14, duration: 0.09 },
  ],
  problem: [
    { frequency: 440, delay: 0, duration: 0.1 },
    { frequency: 330, delay: 0.11, duration: 0.14 },
  ],
  unrecognized: [
    { frequency: 392, delay: 0, duration: 0.07, volume: 0.06 },
    { frequency: 392, delay: 0.12, duration: 0.07, volume: 0.06 },
  ],
  error: [
    { frequency: 220, delay: 0, duration: 0.12, volume: 0.09 },
    { frequency: 185, delay: 0.14, duration: 0.2, volume: 0.09 },
  ],
  completed: [
    { frequency: 523, delay: 0, duration: 0.1 },
    { frequency: 659, delay: 0.11, duration: 0.1 },
    { frequency: 784, delay: 0.22, duration: 0.2 },
  ],
};

export class SoundPlayer {
  private context: AudioContext | null = null;

  get supported() {
    return typeof window !== 'undefined' && Boolean(window.AudioContext);
  }

  async unlock() {
    if (!this.supported) return;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async play(name: SoundName) {
    try {
      await this.unlock();
      if (!this.context) return;

      const startedAt = this.context.currentTime + 0.01;
      let totalSeconds = 0;
      for (const tone of patterns[name]) {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        const toneStart = startedAt + tone.delay;
        const toneEnd = toneStart + tone.duration;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(tone.volume ?? 0.075, toneStart + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneEnd + 0.01);
        totalSeconds = Math.max(totalSeconds, tone.delay + tone.duration);
      }

      await new Promise((resolve) => window.setTimeout(resolve, totalSeconds * 1000 + 30));
    } catch {
      // Some browsers block AudioContext until a user gesture. The picker remains usable without sound.
    }
  }
}
