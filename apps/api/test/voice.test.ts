import { describe, expect, it } from 'vitest';
import { canExecuteVoiceCommand, parseVoiceCommand } from '../../admin/src/voice/commandParser';
import {
  configurePausedRecognition,
  type SpeechRecognitionAdapter,
} from '../../admin/src/voice/speechRecognition';
import { buildItemSpeech, buildQuantitySpeech } from '../../admin/src/voice/speechSynthesis';

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
});
