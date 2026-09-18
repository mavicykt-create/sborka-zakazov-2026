export type VoiceCommand =
  | 'TAKE'
  | 'REPEAT'
  | 'QUANTITY'
  | 'NOT_FOUND'
  | 'SKIP'
  | 'UNDO'
  | 'REMAINING'
  | 'PAUSE'
  | 'CONTINUE'
  | 'UNKNOWN';

const commands: Record<string, Exclude<VoiceCommand, 'UNKNOWN'>> = {
  взял: 'TAKE',
  повтори: 'REPEAT',
  сколько: 'QUANTITY',
  'не нашел': 'NOT_FOUND',
  'не нашёл': 'NOT_FOUND',
  пропусти: 'SKIP',
  отмени: 'UNDO',
  осталось: 'REMAINING',
  пауза: 'PAUSE',
  продолжить: 'CONTINUE',
};

export function normalizeTranscript(transcript: string) {
  return transcript
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/^[\s.,!?;:…]+|[\s.,!?;:…]+$/gu, '')
    .replace(/\s+/gu, ' ');
}

export function parseVoiceCommand(transcript: string): VoiceCommand {
  return commands[normalizeTranscript(transcript)] ?? 'UNKNOWN';
}
