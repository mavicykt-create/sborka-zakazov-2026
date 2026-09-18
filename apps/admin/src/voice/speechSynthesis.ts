export type SpeechItem = {
  name: string;
  pickType: 'PACKAGE' | 'PIECE' | 'REVIEW';
  pickQuantity: string | number;
};

export const SPEECH_RATES = [1, 1.12, 1.22, 1.35] as const;
export const DEFAULT_SPEECH_RATE: SpeechRate = 1.22;
export const DEFAULT_SPEECH_PITCH = 1.04;

export type SpeechRate = (typeof SPEECH_RATES)[number];
export type SpeechSettings = {
  rate: SpeechRate;
  voiceURI: string;
};
export type SpeechVoiceOption = {
  name: string;
  lang: string;
  voiceURI: string;
};

type UnitForms = [string, string, string];

const units: Record<'PACKAGE' | 'PIECE', UnitForms> = {
  PACKAGE: ['блок', 'блока', 'блоков'],
  PIECE: ['штука', 'штуки', 'штук'],
};

const onesMasculine = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const onesFeminine = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const teens = [
  'десять',
  'одиннадцать',
  'двенадцать',
  'тринадцать',
  'четырнадцать',
  'пятнадцать',
  'шестнадцать',
  'семнадцать',
  'восемнадцать',
  'девятнадцать',
];
const tens = [
  '',
  '',
  'двадцать',
  'тридцать',
  'сорок',
  'пятьдесят',
  'шестьдесят',
  'семьдесят',
  'восемьдесят',
  'девяносто',
];
const hundreds = [
  '',
  'сто',
  'двести',
  'триста',
  'четыреста',
  'пятьсот',
  'шестьсот',
  'семьсот',
  'восемьсот',
  'девятьсот',
];

function pluralForm(value: number, forms: UnitForms) {
  const lastTwo = Math.abs(value) % 100;
  const last = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 19) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export function numberToRussian(value: string | number, feminine = false) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 999) return String(value).replace('.', ',');
  if (numeric === 0) return 'ноль';

  const words: string[] = [];
  const hundred = Math.floor(numeric / 100);
  const remainder = numeric % 100;
  if (hundred) words.push(hundreds[hundred]);
  if (remainder >= 10 && remainder < 20) {
    words.push(teens[remainder - 10]);
  } else {
    const ten = Math.floor(remainder / 10);
    const one = remainder % 10;
    if (ten) words.push(tens[ten]);
    if (one) words.push((feminine ? onesFeminine : onesMasculine)[one]);
  }
  return words.join(' ');
}

export function buildQuantitySpeech(item: Pick<SpeechItem, 'pickType' | 'pickQuantity'>) {
  if (item.pickType === 'REVIEW') return null;
  const value = Number(item.pickQuantity);
  const spokenNumber = numberToRussian(item.pickQuantity, item.pickType === 'PIECE');
  const unit = Number.isInteger(value) ? pluralForm(value, units[item.pickType]) : units[item.pickType][1];
  return `${spokenNumber} ${unit}`;
}

export function sanitizeProductNameForSpeech(name: string) {
  return name
    .replace(/(?<![\p{L}\p{N}])\d+\s*(?:[/\\*xх]\s*\d+){1,2}(?![\p{L}\p{N}])/giu, ' ')
    .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu, ' ')
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:!?()[\]{}\-–—/\\*]+|[\s,.;:!?()[\]{}\-–—/\\*]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildItemSpeech(item: SpeechItem, shortNames = true) {
  const quantity = buildQuantitySpeech(item);
  if (!quantity) return null;
  const prefix = item.pickType === 'PIECE' ? 'Штучный товар. ' : '';
  const name = shortNames ? sanitizeProductNameForSpeech(item.name) : item.name;
  return `${prefix}${name}. ${quantity}.`;
}

export function buildRemainingSpeech(value: number) {
  return `Осталось ${numberToRussian(value, true)} ${pluralForm(value, ['позиция', 'позиции', 'позиций'])}.`;
}

export class SpeechSynthesizer {
  get supported() {
    return (
      typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window
    );
  }

  cancel() {
    if (this.supported) window.speechSynthesis.cancel();
  }

  getRussianVoices(): SpeechVoiceOption[] {
    if (!this.supported) return [];
    return window.speechSynthesis
      .getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith('ru'))
      .map(({ name, lang, voiceURI }) => ({ name, lang, voiceURI }));
  }

  onVoicesChanged(listener: () => void) {
    if (!this.supported) return () => undefined;
    window.speechSynthesis.addEventListener('voiceschanged', listener);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', listener);
  }

  async speak(text: string, settings: SpeechSettings = { rate: DEFAULT_SPEECH_RATE, voiceURI: '' }) {
    if (!this.supported) return false;
    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice =
      voices.find((voice) => voice.voiceURI === settings.voiceURI) ??
      voices.find((voice) => voice.lang.toLowerCase().startsWith('ru')) ??
      null;
    utterance.lang = 'ru-RU';
    utterance.rate = settings.rate;
    utterance.pitch = DEFAULT_SPEECH_PITCH;

    return new Promise<boolean>((resolve) => {
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.speak(utterance);
    });
  }
}
