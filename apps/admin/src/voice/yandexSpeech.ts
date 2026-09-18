export type SpeechSource = 'system' | 'yandex';

type SpeakWithFallbackOptions = {
  source: SpeechSource;
  yandexEnabled: boolean;
  text: string;
  speakWithYandex: (text: string) => Promise<boolean>;
  speakWithSystem: (text: string) => Promise<boolean>;
};

export type SpeechPlaybackResult = {
  spoken: boolean;
  source: SpeechSource;
  fallback: boolean;
};

export async function speakWithFallback({
  source,
  yandexEnabled,
  text,
  speakWithYandex,
  speakWithSystem,
}: SpeakWithFallbackOptions): Promise<SpeechPlaybackResult> {
  if (source === 'yandex' && yandexEnabled) {
    try {
      if (await speakWithYandex(text)) return { spoken: true, source: 'yandex', fallback: false };
    } catch {
      // The system voice below is the normal recovery path for provider and playback failures.
    }
    return { spoken: await speakWithSystem(text), source: 'system', fallback: true };
  }

  return {
    spoken: await speakWithSystem(text),
    source: 'system',
    fallback: source === 'yandex',
  };
}

export class YandexAudioPlayer {
  private audio: HTMLAudioElement | null = null;
  private objectUrl = '';
  private settle: ((played: boolean) => void) | null = null;

  private resetAudio() {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.audio = null;
    this.objectUrl = '';
  }

  cancel() {
    const settle = this.settle;
    if (settle) {
      settle(false);
    } else {
      this.resetAudio();
    }
  }

  async speak(audioData: Blob) {
    if (typeof Audio === 'undefined' || typeof URL === 'undefined') return false;
    this.cancel();
    this.objectUrl = URL.createObjectURL(audioData);
    const audio = new Audio(this.objectUrl);
    audio.preload = 'auto';
    this.audio = audio;

    return new Promise<boolean>((resolve) => {
      const finish = (played: boolean) => {
        if (this.settle !== finish) return;
        this.settle = null;
        this.resetAudio();
        resolve(played);
      };
      this.settle = finish;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);
      audio.play().catch(() => finish(false));
    });
  }
}
