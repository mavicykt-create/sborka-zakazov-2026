import { useCallback, useEffect, useRef, useState } from 'react';
import { type SoundName, SoundPlayer } from '../audio/soundPlayer';
import { canExecuteVoiceCommand, parseVoiceCommand, type VoiceCommand } from '../voice/commandParser';
import {
  configurePausedRecognition,
  createSpeechRecognition,
  type SpeechRecognitionAdapter,
} from '../voice/speechRecognition';
import {
  buildItemSpeech,
  buildQuantitySpeech,
  buildRemainingSpeech,
  DEFAULT_SPEECH_RATE,
  type SpeechItem,
  type SpeechRate,
  SpeechSynthesizer,
  type SpeechVoiceOption,
} from '../voice/speechSynthesis';
import { type SpeechSource, speakWithFallback, YandexAudioPlayer } from '../voice/yandexSpeech';

export type VoicePickerItem = SpeechItem & { id: string };
export type VoiceQueueSnapshot = { current: VoicePickerItem | null; remaining: number };
export type VoiceMicState = 'listening' | 'speaking' | 'paused' | 'error';

type VoicePickerOptions = {
  current: VoicePickerItem | null;
  remaining: number;
  canUndo: boolean;
  onStatus: (
    item: VoicePickerItem,
    status: 'PICKED' | 'NOT_FOUND' | 'SKIPPED',
  ) => Promise<VoiceQueueSnapshot | null>;
  onUndo: () => Promise<VoiceQueueSnapshot | null>;
  yandexSpeech: {
    enabled: boolean;
    settingsLoaded: boolean;
    requestAudio: (text: string) => Promise<Blob>;
  };
};

const micLabels: Record<VoiceMicState, string> = {
  listening: 'Слушаю',
  speaking: 'Говорю',
  paused: 'Пауза',
  error: 'Ошибка',
};

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

const speechRateStorageKey = 'pickerSpeechRate';
const speechVoiceStorageKey = 'pickerSpeechVoice';
const shortNamesStorageKey = 'pickerShortNames';
const speechSourceStorageKey = 'pickerSpeechSource';

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Voice settings remain available for the current tab when storage is blocked.
  }
}

function readSpeechRate(): SpeechRate {
  const value = Number(readStorage(speechRateStorageKey));
  return value === 1 || value === 1.12 || value === 1.22 || value === 1.35 ? value : DEFAULT_SPEECH_RATE;
}

function readSpeechSource(): SpeechSource {
  return readStorage(speechSourceStorageKey) === 'yandex' ? 'yandex' : 'system';
}

export function confirmedStatusSounds(status: 'PICKED' | 'NOT_FOUND' | 'SKIPPED'): SoundName[] {
  return [status === 'PICKED' ? 'accepted' : 'problem'];
}

export function itemAnnouncementSounds(item: Pick<VoicePickerItem, 'pickType'>): SoundName[] {
  return item.pickType === 'PIECE' ? ['piece'] : [];
}

export function useVoicePickerController(options: VoicePickerOptions) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [micState, setMicState] = useState<VoiceMicState>('paused');
  const [lastTranscript, setLastTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const [speechRate, setSpeechRateState] = useState<SpeechRate>(readSpeechRate);
  const [speechVoice, setSpeechVoiceState] = useState(() => readStorage(speechVoiceStorageKey) ?? '');
  const [shortNames, setShortNamesState] = useState(() => readStorage(shortNamesStorageKey) !== 'false');
  const [speechSource, setSpeechSourceState] = useState<SpeechSource>(readSpeechSource);
  const [speechNotice, setSpeechNotice] = useState('');
  const [speechVoices, setSpeechVoices] = useState<SpeechVoiceOption[]>([]);
  const recognitionRef = useRef<SpeechRecognitionAdapter | null>(null);
  const synthesizerRef = useRef(new SpeechSynthesizer());
  const soundRef = useRef(new SoundPlayer());
  const yandexPlayerRef = useRef(new YandexAudioPlayer());
  const enabledRef = useRef(false);
  const pausedRef = useRef(false);
  const speakingRef = useRef(false);
  const soundsEnabledRef = useRef(true);
  const inFlightRef = useRef(false);
  const speechRunRef = useRef(0);
  const optionsRef = useRef(options);
  const speechSettingsRef = useRef({ rate: speechRate, voiceURI: speechVoice });
  const shortNamesRef = useRef(shortNames);
  const speechSourceRef = useRef(speechSource);
  const commandHandlerRef = useRef<(command: VoiceCommand, transcript: string) => void>(() => undefined);
  optionsRef.current = options;
  speechSettingsRef.current = { rate: speechRate, voiceURI: speechVoice };
  shortNamesRef.current = shortNames;
  speechSourceRef.current = speechSource;

  const startListening = useCallback(() => {
    if (!enabledRef.current || pausedRef.current || speakingRef.current) return;
    const current = optionsRef.current.current;
    if (!current || current.pickType === 'REVIEW') {
      setMicState('paused');
      return;
    }
    const recognition = recognitionRef.current;
    if (!recognition?.supported) {
      setMicState('error');
      return;
    }
    setMicState('listening');
    recognition.start();
  }, []);

  const play = useCallback(async (name: SoundName, force = false) => {
    if (force || soundsEnabledRef.current) await soundRef.current.play(name);
  }, []);

  const speak = useCallback(
    async (text: string, resume = true) => {
      const speechRun = ++speechRunRef.current;
      recognitionRef.current?.stop();
      speakingRef.current = true;
      setMicState('speaking');
      const result = await speakWithFallback({
        source: speechSourceRef.current,
        yandexEnabled: optionsRef.current.yandexSpeech.enabled,
        text,
        speakWithYandex: async (phrase) => {
          const audio = await optionsRef.current.yandexSpeech.requestAudio(phrase);
          if (speechRun !== speechRunRef.current) return false;
          return yandexPlayerRef.current.speak(audio);
        },
        speakWithSystem: (phrase) =>
          speechRun === speechRunRef.current
            ? synthesizerRef.current.speak(phrase, speechSettingsRef.current)
            : Promise.resolve(false),
      });
      if (speechRun !== speechRunRef.current) return;
      speakingRef.current = false;
      if (result.fallback) {
        setSpeechNotice('Alena недоступна — используется голос телефона');
      } else {
        setSpeechNotice('');
      }
      if (!result.spoken && enabledRef.current) {
        setVoiceError('Озвучивание недоступно в этом браузере. Используйте экранные кнопки.');
      }
      if (resume && enabledRef.current && !pausedRef.current) {
        await delay(200);
        startListening();
      } else if (pausedRef.current || !enabledRef.current) {
        setMicState('paused');
      }
    },
    [startListening],
  );

  const announce = useCallback(
    async (item: VoicePickerItem, withPieceSignal = true, forceSpeech = false) => {
      if (item.pickType === 'REVIEW') {
        recognitionRef.current?.stop();
        setMicState('paused');
        setVoiceError(
          'Для этой позиции требуется решение администратора. Голосовое подтверждение заблокировано.',
        );
        if (enabledRef.current || forceSpeech) await speak('Требуется решение администратора.', false);
        return;
      }
      setVoiceError('');
      if (withPieceSignal) {
        for (const sound of itemAnnouncementSounds(item)) await play(sound);
      }
      const phrase = buildItemSpeech(item, shortNamesRef.current);
      if (phrase && (enabledRef.current || forceSpeech)) await speak(phrase);
    },
    [play, speak],
  );

  const finishOrAdvance = useCallback(
    async (snapshot: VoiceQueueSnapshot) => {
      if (!snapshot.current) {
        recognitionRef.current?.stop();
        await play('completed');
        if (enabledRef.current) await speak('Ваша часть заказа собрана.', false);
        setMicState('paused');
        return;
      }
      if (enabledRef.current) await announce(snapshot.current);
    },
    [announce, play, speak],
  );

  const performStatus = useCallback(
    async (status: 'PICKED' | 'NOT_FOUND' | 'SKIPPED') => {
      const current = optionsRef.current.current;
      if (!current || inFlightRef.current) return;
      if (current.pickType === 'REVIEW') {
        setVoiceError('Для этой позиции требуется решение администратора.');
        await play('error');
        return;
      }

      inFlightRef.current = true;
      recognitionRef.current?.stop();
      try {
        const snapshot = await optionsRef.current.onStatus(current, status);
        if (!snapshot) {
          await play('error');
          if (enabledRef.current && !pausedRef.current) startListening();
          return;
        }
        for (const sound of confirmedStatusSounds(status)) await play(sound);
        await finishOrAdvance(snapshot);
      } finally {
        inFlightRef.current = false;
      }
    },
    [finishOrAdvance, play, startListening],
  );

  const repeat = useCallback(async () => {
    const current = optionsRef.current.current;
    if (!current) return;
    await announce(current, false, true);
  }, [announce]);

  const sayQuantity = useCallback(async () => {
    const current = optionsRef.current.current;
    if (!current) return;
    const phrase = buildQuantitySpeech(current);
    if (!phrase) {
      await announce(current);
      return;
    }
    if (enabledRef.current) await speak(`${phrase}.`);
  }, [announce, speak]);

  const sayRemaining = useCallback(async () => {
    if (enabledRef.current) await speak(buildRemainingSpeech(optionsRef.current.remaining));
  }, [speak]);

  const pause = useCallback(() => {
    speechRunRef.current += 1;
    pausedRef.current = true;
    synthesizerRef.current.cancel();
    yandexPlayerRef.current.cancel();
    speakingRef.current = false;
    setMicState('paused');
    // Keep a resume-only listener alive; the command gate rejects every command except CONTINUE.
    configurePausedRecognition(recognitionRef.current, enabledRef.current);
  }, []);

  const resume = useCallback(async () => {
    if (!enabledRef.current) return;
    pausedRef.current = false;
    const current = optionsRef.current.current;
    if (current) await announce(current);
  }, [announce]);

  const undo = useCallback(async () => {
    if (!optionsRef.current.canUndo || inFlightRef.current) return;
    inFlightRef.current = true;
    recognitionRef.current?.stop();
    try {
      const snapshot = await optionsRef.current.onUndo();
      if (!snapshot) {
        await play('error');
        if (enabledRef.current && !pausedRef.current) startListening();
        return;
      }
      if (snapshot.current && enabledRef.current) await announce(snapshot.current);
    } finally {
      inFlightRef.current = false;
    }
  }, [announce, play, startListening]);

  const handleCommand = useCallback(
    async (command: VoiceCommand, transcript: string) => {
      setLastTranscript(transcript.trim());
      if (inFlightRef.current) return;
      if (!canExecuteVoiceCommand(command, pausedRef.current)) return;

      switch (command) {
        case 'TAKE':
          await performStatus('PICKED');
          break;
        case 'REPEAT':
          await repeat();
          break;
        case 'QUANTITY':
          await sayQuantity();
          break;
        case 'NOT_FOUND':
          await performStatus('NOT_FOUND');
          break;
        case 'SKIP':
          await performStatus('SKIPPED');
          break;
        case 'UNDO':
          await undo();
          break;
        case 'REMAINING':
          await sayRemaining();
          break;
        case 'PAUSE':
          pause();
          break;
        case 'CONTINUE':
          await resume();
          break;
        default:
          await play('unrecognized');
      }
    },
    [pause, performStatus, play, repeat, resume, sayQuantity, sayRemaining, undo],
  );
  commandHandlerRef.current = (command, transcript) => void handleCommand(command, transcript);

  useEffect(() => {
    const recognition = createSpeechRecognition({
      onFinal: (transcript) => commandHandlerRef.current(parseVoiceCommand(transcript), transcript),
      onListening: (listening) => {
        if (listening && enabledRef.current && !pausedRef.current && !speakingRef.current) {
          setMicState('listening');
        }
      },
      onError: (error) => {
        setVoiceError(error);
        setMicState('error');
      },
    });
    recognitionRef.current = recognition;
    setRecognitionSupported(recognition.supported);
    return () => {
      recognition.destroy();
      synthesizerRef.current.cancel();
      yandexPlayerRef.current.cancel();
    };
  }, []);

  useEffect(() => {
    if (
      options.yandexSpeech.settingsLoaded &&
      !options.yandexSpeech.enabled &&
      speechSourceRef.current === 'yandex'
    ) {
      speechSourceRef.current = 'system';
      setSpeechSourceState('system');
      writeStorage(speechSourceStorageKey, 'system');
    }
  }, [options.yandexSpeech.enabled, options.yandexSpeech.settingsLoaded]);

  useEffect(() => {
    const synthesizer = synthesizerRef.current;
    const refreshVoices = () => setSpeechVoices(synthesizer.getRussianVoices());
    refreshVoices();
    return synthesizer.onVoicesChanged(refreshVoices);
  }, []);

  const setSpeechRate = useCallback((rate: SpeechRate) => {
    setSpeechRateState(rate);
    writeStorage(speechRateStorageKey, String(rate));
  }, []);

  const setSpeechVoice = useCallback((voiceURI: string) => {
    setSpeechVoiceState(voiceURI);
    writeStorage(speechVoiceStorageKey, voiceURI);
  }, []);

  const setShortNames = useCallback((enabled: boolean) => {
    setShortNamesState(enabled);
    writeStorage(shortNamesStorageKey, String(enabled));
  }, []);

  const setSpeechSource = useCallback((source: SpeechSource) => {
    speechSourceRef.current = source;
    setSpeechSourceState(source);
    setSpeechNotice('');
    writeStorage(speechSourceStorageKey, source);
  }, []);

  const toggleVoice = useCallback(
    async (enabled: boolean) => {
      enabledRef.current = enabled;
      setVoiceEnabled(enabled);
      if (!enabled) {
        pause();
        return;
      }
      pausedRef.current = false;
      setVoiceError('');
      await soundRef.current.unlock();
      const current = optionsRef.current.current;
      if (current) await announce(current);
    },
    [announce, pause],
  );

  const toggleSounds = useCallback(async (enabled: boolean) => {
    soundsEnabledRef.current = enabled;
    setSoundsEnabled(enabled);
    if (enabled) await soundRef.current.unlock();
  }, []);

  const testSound = useCallback(async (name: SoundName) => {
    await soundRef.current.play(name);
  }, []);

  return {
    voiceEnabled,
    soundsEnabled,
    speechRate,
    speechVoice,
    speechSource,
    speechVoices,
    shortNames,
    recognitionSupported,
    micState,
    micLabel: micState === 'paused' && voiceEnabled ? 'Пауза · жду «Продолжить»' : micLabels[micState],
    lastTranscript,
    voiceError,
    speechNotice,
    toggleVoice,
    toggleSounds,
    setSpeechRate,
    setSpeechVoice,
    setSpeechSource,
    setShortNames,
    testSound,
    performStatus,
    repeat,
    undo,
    pause,
    resume,
  };
}
