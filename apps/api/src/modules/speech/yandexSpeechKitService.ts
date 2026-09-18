import { createHash } from 'node:crypto';

export const YANDEX_SPEECHKIT_ENDPOINT = 'https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize';
export const YANDEX_SPEECHKIT_SPEED = 1.22;
export const MAX_SPEECH_TEXT_LENGTH = 1000;
export const SPEECH_AUDIO_CONTENT_TYPE = 'audio/mpeg';

type CachedSpeech = { audio: Buffer; contentType: string };

export interface SpeechAudioCache {
  get(key: string): Promise<CachedSpeech | undefined>;
  set(key: string, value: CachedSpeech): Promise<void>;
}

type MemoryCacheEntry = CachedSpeech & { expiresAt: number };

export class MemorySpeechAudioCache implements SpeechAudioCache {
  private readonly entries = new Map<string, MemoryCacheEntry>();

  constructor(
    private readonly maxEntries = 100,
    private readonly ttlMs = 30 * 60 * 1000,
    private readonly now = () => Date.now(),
  ) {}

  async get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return { audio: entry.audio, contentType: entry.contentType };
  }

  async set(key: string, value: CachedSpeech) {
    this.entries.delete(key);
    this.entries.set(key, { ...value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
  }
}

export class SpeechTextValidationError extends Error {
  readonly statusCode = 400;
}

export class SpeechProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: 502 | 503 | 504,
  ) {
    super(message);
  }
}

export function normalizeSpeechText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) throw new SpeechTextValidationError('Текст для озвучивания не должен быть пустым');
  if (normalized.length > MAX_SPEECH_TEXT_LENGTH) {
    throw new SpeechTextValidationError(
      `Текст для озвучивания не должен превышать ${MAX_SPEECH_TEXT_LENGTH} символов`,
    );
  }
  return normalized;
}

export type SpeechKitPublicSettings = { yandexEnabled: boolean; voice: string };
export type SpeechKitResult = CachedSpeech & { cacheHit: boolean };

type YandexSpeechKitServiceOptions = {
  apiKey?: string;
  voice?: string;
  speed?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
  cache?: SpeechAudioCache;
};

export class YandexSpeechKitService {
  private readonly apiKey: string;
  private readonly voice: string;
  private readonly speed: number;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly cache: SpeechAudioCache;

  constructor(options: YandexSpeechKitServiceOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.YANDEX_SPEECHKIT_API_KEY?.trim() ?? '';
    this.voice = options.voice ?? process.env.YANDEX_SPEECHKIT_VOICE?.trim() ?? 'alena';
    this.speed = options.speed ?? YANDEX_SPEECHKIT_SPEED;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetcher = options.fetcher ?? fetch;
    this.cache = options.cache ?? new MemorySpeechAudioCache();
  }

  getPublicSettings(): SpeechKitPublicSettings {
    return { yandexEnabled: Boolean(this.apiKey), voice: this.voice };
  }

  async synthesize(text: string): Promise<SpeechKitResult> {
    if (!this.apiKey) throw new SpeechProviderError('Yandex SpeechKit не настроен', 503);
    const normalizedText = normalizeSpeechText(text);
    const cacheKey = createHash('sha256')
      .update(`${this.voice}\0${this.speed}\0${normalizedText}`)
      .digest('hex');
    const cached = await this.cache.get(cacheKey);
    if (cached) return { ...cached, cacheHit: true };

    const body = new URLSearchParams({
      text: normalizedText,
      lang: 'ru-RU',
      voice: this.voice,
      speed: String(this.speed),
      format: 'mp3',
    });
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.fetcher(YANDEX_SPEECHKIT_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Api-Key ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: abortController.signal,
      });
      if (!response.ok) throw new SpeechProviderError('Yandex SpeechKit временно недоступен', 502);
      const audio = Buffer.from(await response.arrayBuffer());
      if (audio.length === 0) throw new SpeechProviderError('Yandex SpeechKit вернул пустое аудио', 502);
      const result = { audio, contentType: SPEECH_AUDIO_CONTENT_TYPE };
      await this.cache.set(cacheKey, result);
      return { ...result, cacheHit: false };
    } catch (error) {
      if (error instanceof SpeechProviderError) throw error;
      if (abortController.signal.aborted) {
        throw new SpeechProviderError('Yandex SpeechKit не ответил вовремя', 504);
      }
      throw new SpeechProviderError('Не удалось связаться с Yandex SpeechKit', 502);
    } finally {
      clearTimeout(timeout);
    }
  }
}
