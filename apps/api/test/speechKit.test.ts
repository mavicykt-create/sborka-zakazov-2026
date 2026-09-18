import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_SPEECH_TEXT_LENGTH,
  MemorySpeechAudioCache,
  normalizeSpeechText,
  type SpeechProviderError,
  YANDEX_SPEECHKIT_ENDPOINT,
  YANDEX_SPEECHKIT_SPEED,
  YandexSpeechKitService,
} from '../src/modules/speech/yandexSpeechKitService.js';
import { WorkflowError } from '../src/modules/workflow/workflowService.js';
import { buildApp } from '../src/server.js';

const audio = Buffer.from([0x49, 0x44, 0x33, 0x04]);

function successfulFetch() {
  return vi.fn(async () => new Response(audio, { status: 200, headers: { 'Content-Type': 'audio/mpeg' } }));
}

function testAuthentication(authorization?: string) {
  if (authorization !== 'Bearer picker-test-token') {
    throw new WorkflowError('Требуется вход сборщика', 401);
  }
  return Promise.resolve({
    token: 'picker-test-token',
    expiresAt: new Date(Date.now() + 60_000),
    worker: {
      id: 'worker-test',
      login: 'picker-test',
      name: 'Тестовый сборщик',
      isActive: true,
      shiftStatus: 'AVAILABLE' as const,
    },
  });
}

describe('YandexSpeechKitService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is disabled without an API key and never exposes a secret in settings', () => {
    const secret = 'mock-secret-that-must-not-leak';
    const disabled = new YandexSpeechKitService({ apiKey: '' });
    const enabled = new YandexSpeechKitService({ apiKey: secret, voice: 'alena' });

    expect(disabled.getPublicSettings()).toEqual({ yandexEnabled: false, voice: 'alena' });
    expect(enabled.getPublicSettings()).toEqual({ yandexEnabled: true, voice: 'alena' });
    expect(JSON.stringify(enabled.getPublicSettings())).not.toContain(secret);
  });

  it('sends the current SpeechKit v1 request and returns mocked MP3 audio', async () => {
    const fetcher = successfulFetch();
    const service = new YandexSpeechKitService({
      apiKey: 'mock-api-key',
      fetcher: fetcher as typeof fetch,
      cache: new MemorySpeechAudioCache(),
    });

    const result = await service.synthesize('ПЛИТКА Alpen Gold. два блока.');

    expect(result).toMatchObject({ audio, contentType: 'audio/mpeg', cacheHit: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(YANDEX_SPEECHKIT_ENDPOINT);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Api-Key mock-api-key',
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    const body = init?.body as URLSearchParams;
    expect(body.get('voice')).toBe('alena');
    expect(body.get('speed')).toBe(String(YANDEX_SPEECHKIT_SPEED));
    expect(body.get('format')).toBe('mp3');
    expect(body.get('text')).toBe('ПЛИТКА Alpen Gold. два блока.');
  });

  it('uses the cache for the same normalized phrase', async () => {
    const fetcher = successfulFetch();
    const service = new YandexSpeechKitService({
      apiKey: 'mock-api-key',
      fetcher: fetcher as typeof fetch,
      cache: new MemorySpeechAudioCache(),
    });

    expect((await service.synthesize('Повтори   товар')).cacheHit).toBe(false);
    expect((await service.synthesize('  Повтори товар  ')).cacheHit).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('returns a safe provider error without response details or credentials', async () => {
    const service = new YandexSpeechKitService({
      apiKey: 'mock-api-key',
      fetcher: vi.fn(async () => new Response('provider details', { status: 500 })) as typeof fetch,
    });

    await expect(service.synthesize('Тестовая фраза')).rejects.toEqual(
      expect.objectContaining<Partial<SpeechProviderError>>({
        message: 'Yandex SpeechKit временно недоступен',
        statusCode: 502,
      }),
    );
  });

  it('rejects empty and excessively long text before a provider call', () => {
    expect(() => normalizeSpeechText('   ')).toThrow('не должен быть пустым');
    expect(() => normalizeSpeechText('а'.repeat(MAX_SPEECH_TEXT_LENGTH + 1))).toThrow(
      `не должен превышать ${MAX_SPEECH_TEXT_LENGTH}`,
    );
  });
});

describe('picker speech endpoints', () => {
  it('requires picker authorization', async () => {
    const app = await buildApp({
      speechKitService: new YandexSpeechKitService({ apiKey: 'mock-api-key', fetcher: successfulFetch() }),
      authenticatePicker: testAuthentication,
    });

    const settings = await app.inject({ method: 'GET', url: '/api/picker/speech/settings' });
    const speech = await app.inject({ method: 'POST', url: '/api/picker/speech', payload: { text: 'Тест' } });

    expect(settings.statusCode).toBe(401);
    expect(speech.statusCode).toBe(401);
    await app.close();
  });

  it('returns safe settings and mocked audio for an authorized picker', async () => {
    const secret = 'mock-api-key-not-for-browser';
    const service = new YandexSpeechKitService({
      apiKey: secret,
      fetcher: successfulFetch() as typeof fetch,
    });
    const app = await buildApp({ speechKitService: service, authenticatePicker: testAuthentication });
    const headers = { authorization: 'Bearer picker-test-token' };

    const settings = await app.inject({ method: 'GET', url: '/api/picker/speech/settings', headers });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toEqual({ yandexEnabled: true, voice: 'alena' });
    expect(settings.body).not.toContain(secret);

    const speech = await app.inject({
      method: 'POST',
      url: '/api/picker/speech',
      headers,
      payload: { text: 'Тестовая фраза' },
    });
    expect(speech.statusCode).toBe(200);
    expect(speech.headers['content-type']).toContain('audio/mpeg');
    expect(speech.rawPayload).toEqual(audio);
    await app.close();
  });

  it('rejects invalid text for an authorized picker', async () => {
    const app = await buildApp({
      speechKitService: new YandexSpeechKitService({ apiKey: 'mock-api-key', fetcher: successfulFetch() }),
      authenticatePicker: testAuthentication,
    });
    const headers = { authorization: 'Bearer picker-test-token' };

    const empty = await app.inject({
      method: 'POST',
      url: '/api/picker/speech',
      headers,
      payload: { text: ' ' },
    });
    const long = await app.inject({
      method: 'POST',
      url: '/api/picker/speech',
      headers,
      payload: { text: 'а'.repeat(MAX_SPEECH_TEXT_LENGTH + 1) },
    });

    expect(empty.statusCode).toBe(400);
    expect(long.statusCode).toBe(400);
    await app.close();
  });
});
