export type SpeechItem = {
  name: string;
  pickType: 'PACKAGE' | 'PIECE' | 'REVIEW';
  pickQuantity: string | number;
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

export function buildItemSpeech(item: SpeechItem) {
  const quantity = buildQuantitySpeech(item);
  if (!quantity) return null;
  const prefix = item.pickType === 'PIECE' ? 'Штучный товар. ' : '';
  return `${prefix}${item.name}. ${quantity}.`;
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

  async speak(text: string) {
    if (!this.supported) return false;
    this.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.toLowerCase().startsWith('ru')) ?? null;
    utterance.lang = 'ru-RU';
    utterance.rate = 0.94;
    utterance.pitch = 1;

    return new Promise<boolean>((resolve) => {
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.speak(utterance);
    });
  }
}
