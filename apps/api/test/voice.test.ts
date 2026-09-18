import { describe, expect, it, vi } from 'vitest';
import { soundPatterns } from '../../admin/src/audio/soundPlayer';
import { confirmedStatusSounds, itemAnnouncementSounds } from '../../admin/src/picker/voicePickerController';
import { canExecuteVoiceCommand, parseVoiceCommand } from '../../admin/src/voice/commandParser';
import {
  configurePausedRecognition,
  type SpeechRecognitionAdapter,
} from '../../admin/src/voice/speechRecognition';
import {
  buildItemSpeech,
  buildQuantitySpeech,
  DEFAULT_SPEECH_PITCH,
  DEFAULT_SPEECH_RATE,
  sanitizeProductNameForSpeech,
} from '../../admin/src/voice/speechSynthesis';
import { speakWithFallback } from '../../admin/src/voice/yandexSpeech';

describe('parseVoiceCommand', () => {
  it.each([
    ['взял', 'TAKE'],
    ['Взял.', 'TAKE'],
    ['не нашел', 'NOT_FOUND'],
    ['не нашёл', 'NOT_FOUND'],
    ['повтори', 'REPEAT'],
    ['сколько', 'QUANTITY'],
    ['пропусти', 'SKIP'],
    ['отмени', 'UNDO'],
    ['осталось', 'REMAINING'],
    ['пауза', 'PAUSE'],
    ['продолжить', 'CONTINUE'],
    ['неизвестная фраза', 'UNKNOWN'],
    ['дальше', 'UNKNOWN'],
  ] as const)('maps %s to %s', (transcript, command) => {
    expect(parseVoiceCommand(transcript)).toBe(command);
  });
});

describe('paused voice command gate', () => {
  it('accepts only CONTINUE while paused', () => {
    expect(canExecuteVoiceCommand('CONTINUE', true)).toBe(true);
    for (const command of [
      'TAKE',
      'REPEAT',
      'QUANTITY',
      'NOT_FOUND',
      'SKIP',
      'UNDO',
      'REMAINING',
      'PAUSE',
      'UNKNOWN',
    ] as const) {
      expect(canExecuteVoiceCommand(command, true)).toBe(false);
    }
  });

  it('allows normal commands after resuming', () => {
    expect(canExecuteVoiceCommand('TAKE', false)).toBe(true);
    expect(canExecuteVoiceCommand('SKIP', false)).toBe(true);
    expect(canExecuteVoiceCommand('NOT_FOUND', false)).toBe(true);
  });

  it('keeps recognition active for CONTINUE and stops it only when voice is disabled', () => {
    const calls: string[] = [];
    const recognition: SpeechRecognitionAdapter = {
      supported: true,
      start: () => calls.push('start'),
      stop: () => calls.push('stop'),
      destroy: () => calls.push('destroy'),
    };

    configurePausedRecognition(recognition, true);
    expect(calls).toEqual(['start']);

    configurePausedRecognition(recognition, false);
    expect(calls).toEqual(['start', 'stop']);
  });
});

describe('picker speech phrases', () => {
  it('builds a package phrase with a simple Russian unit', () => {
    expect(buildItemSpeech({ name: 'Плитка Alpen Gold Oreo', pickType: 'PACKAGE', pickQuantity: 2 })).toBe(
      'Плитка Alpen Gold Oreo. два блока.',
    );
  });

  it('marks piece goods and uses a feminine number', () => {
    expect(buildItemSpeech({ name: 'Жвачка Love Is', pickType: 'PIECE', pickQuantity: 7 })).toBe(
      'Штучный товар. Жвачка Love Is. семь штук.',
    );
    expect(buildQuantitySpeech({ pickType: 'PIECE', pickQuantity: 2 })).toBe('две штуки');
  });

  it('uses correct Russian forms for simple quantities', () => {
    expect(buildQuantitySpeech({ pickType: 'PACKAGE', pickQuantity: 1 })).toBe('один блок');
    expect(buildQuantitySpeech({ pickType: 'PACKAGE', pickQuantity: 5 })).toBe('пять блоков');
    expect(buildQuantitySpeech({ pickType: 'PIECE', pickQuantity: 21 })).toBe('двадцать одна штука');
  });

  it('does not create a confirmation phrase for review items', () => {
    expect(buildItemSpeech({ name: 'Спорная позиция', pickType: 'REVIEW', pickQuantity: 1 })).toBeNull();
  });

  it('uses the faster default voice tuning', () => {
    expect(DEFAULT_SPEECH_RATE).toBe(1.22);
    expect(DEFAULT_SPEECH_PITCH).toBe(1.04);
  });

  it('uses a sanitized name only when short names are enabled', () => {
    const item = {
      name: 'ПЛИТКА Alpen Gold Oreo 1/12/12',
      pickType: 'PACKAGE' as const,
      pickQuantity: 2,
    };
    expect(buildItemSpeech(item, true)).toBe('ПЛИТКА Alpen Gold Oreo. два блока.');
    expect(buildItemSpeech(item, false)).toBe('ПЛИТКА Alpen Gold Oreo 1/12/12. два блока.');
    expect(item.name).toBe('ПЛИТКА Alpen Gold Oreo 1/12/12');
  });
});

describe('sanitizeProductNameForSpeech', () => {
  it.each([
    ['Товар 1/12/12', 'Товар'],
    ['Товар 1/24', 'Товар'],
    ['Товар 12/12', 'Товар'],
    ['Товар 1\\12\\12', 'Товар'],
    ['Товар 6x12 шоколад', 'Товар шоколад'],
    ['Товар 6х12 шоколад', 'Товар шоколад'],
    ['Товар 12*24', 'Товар'],
  ])('removes the packaging scheme from %s', (name, expected) => {
    expect(sanitizeProductNameForSpeech(name)).toBe(expected);
  });

  it('keeps meaningful combinations, weights, volumes and item numbers', () => {
    expect(sanitizeProductNameForSpeech('КОФЕ 3В1 2в1 90 г 100 мл №5')).toBe('КОФЕ 3В1 2в1 90 г 100 мл №5');
    expect(sanitizeProductNameForSpeech('КОФЕ MONARCH 3В1 крепкий 10/24 13гр')).toBe(
      'КОФЕ MONARCH 3В1 крепкий 13гр',
    );
  });

  it.each([
    ['ЖК Конфета Mango 芒果味 1/24', 'ЖК Конфета Mango'],
    ['Чай お茶 зеленый 1/24', 'Чай зеленый'],
    ['Напиток カタカナ яблоко 1/24', 'Напиток яблоко'],
    ['Лапша 매운맛 курица 1/24', 'Лапша курица'],
  ])('removes Asian-script fragments from TTS only', (name, expected) => {
    expect(sanitizeProductNameForSpeech(name)).toBe(expected);
  });

  it('normalizes whitespace and removes hanging punctuation', () => {
    expect(sanitizeProductNameForSpeech('  ПЧН   Oreo,  6х12;  ')).toBe('ПЧН Oreo');
  });
});

describe('picker success sound flow', () => {
  it.each([
    ['accepted', 0.08, 0.12],
    ['piece', 0.08, 0.12],
  ] as const)('uses one short impulse for %s', (name, minimumDuration, maximumDuration) => {
    expect(soundPatterns[name]).toHaveLength(1);
    expect(soundPatterns[name][0]?.delay).toBe(0);
    expect(soundPatterns[name][0]?.duration).toBeGreaterThanOrEqual(minimumDuration);
    expect(soundPatterns[name][0]?.duration).toBeLessThanOrEqual(maximumDuration);
  });

  it('plays only accepted before an ordinary next item', () => {
    const sounds = [...confirmedStatusSounds('PICKED'), ...itemAnnouncementSounds({ pickType: 'PACKAGE' })];
    expect(sounds).toEqual(['accepted']);
    expect(sounds).not.toContain('next');
  });

  it('plays one piece signal after accepted when the next item is PIECE', () => {
    const sounds = [...confirmedStatusSounds('PICKED'), ...itemAnnouncementSounds({ pickType: 'PIECE' })];
    expect(sounds).toEqual(['accepted', 'piece']);
  });
});

describe('Yandex speech fallback', () => {
  it('uses the system TTS with the same phrase when the provider fails', async () => {
    const speakWithYandex = vi.fn(async () => {
      throw new Error('mock provider failure');
    });
    const speakWithSystem = vi.fn(async () => true);

    const result = await speakWithFallback({
      source: 'yandex',
      yandexEnabled: true,
      text: 'ПЛИТКА Alpen Gold. два блока.',
      speakWithYandex,
      speakWithSystem,
    });

    expect(result).toEqual({ spoken: true, source: 'system', fallback: true });
    expect(speakWithSystem).toHaveBeenCalledWith('ПЛИТКА Alpen Gold. два блока.');
  });

  it('does not invoke the system TTS after successful Yandex playback', async () => {
    const speakWithYandex = vi.fn(async () => true);
    const speakWithSystem = vi.fn(async () => true);

    const result = await speakWithFallback({
      source: 'yandex',
      yandexEnabled: true,
      text: 'Товар. одна штука.',
      speakWithYandex,
      speakWithSystem,
    });

    expect(result).toEqual({ spoken: true, source: 'yandex', fallback: false });
    expect(speakWithSystem).not.toHaveBeenCalled();
  });
});
