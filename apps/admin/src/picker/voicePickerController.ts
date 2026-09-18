import { useCallback, useEffect, useRef, useState } from 'react';
import { type SoundName, SoundPlayer } from '../audio/soundPlayer';
import { parseVoiceCommand, type VoiceCommand } from '../voice/commandParser';
import { createSpeechRecognition, type SpeechRecognitionAdapter } from '../voice/speechRecognition';
import {
  buildItemSpeech,
  buildQuantitySpeech,
  buildRemainingSpeech,
  type SpeechItem,
  SpeechSynthesizer,
} from '../voice/speechSynthesis';

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
};

const micLabels: Record<VoiceMicState, string> = {
  listening: 'Слушаю',
  speaking: 'Говорю',
  paused: 'Пауза',
  error: 'Ошибка',
};

const delay = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export function useVoicePickerController(options: VoicePickerOptions) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [micState, setMicState] = useState<VoiceMicState>('paused');
  const [lastTranscript, setLastTranscript] = useState('');
  const [voiceError, setVoiceError] = useState('');
  const [recognitionSupported, setRecognitionSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognitionAdapter | null>(null);
  const synthesizerRef = useRef(new SpeechSynthesizer());
  const soundRef = useRef(new SoundPlayer());
  const enabledRef = useRef(false);
  const pausedRef = useRef(false);
  const speakingRef = useRef(false);
  const soundsEnabledRef = useRef(true);
  const inFlightRef = useRef(false);
  const optionsRef = useRef(options);
  const commandHandlerRef = useRef<(command: VoiceCommand, transcript: string) => void>(() => undefined);
  optionsRef.current = options;

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
      recognitionRef.current?.stop();
      speakingRef.current = true;
      setMicState('speaking');
      const spoken = await synthesizerRef.current.speak(text);
      speakingRef.current = false;
      if (!spoken && enabledRef.current) {
        setVoiceError('Озвучивание недоступно в этом браузере. Используйте экранные кнопки.');
      }
      if (resume && enabledRef.current && !pausedRef.current) {
        await delay(350);
        startListening();
      } else if (pausedRef.current || !enabledRef.current) {
        setMicState('paused');
      }
    },
    [startListening],
  );

  const announce = useCallback(
    async (item: VoicePickerItem, withNextSignal = false, forceSpeech = false) => {
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
      if (withNextSignal) await play('next');
      if (item.pickType === 'PIECE') await play('piece');
      const phrase = buildItemSpeech(item);
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
      if (enabledRef.current) await announce(snapshot.current, true);
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
        await play(status === 'PICKED' ? 'accepted' : 'problem');
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
    await play('repeat');
    await announce(current, false, true);
  }, [announce, play]);

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
    pausedRef.current = true;
    recognitionRef.current?.stop();
    synthesizerRef.current.cancel();
    speakingRef.current = false;
    setMicState('paused');
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
      await play('repeat');
      if (snapshot.current && enabledRef.current) await announce(snapshot.current);
    } finally {
      inFlightRef.current = false;
    }
  }, [announce, play, startListening]);

  const handleCommand = useCallback(
    async (command: VoiceCommand, transcript: string) => {
      setLastTranscript(transcript.trim());
      if (inFlightRef.current) return;
      if (pausedRef.current && command !== 'CONTINUE') return;

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
    };
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
    recognitionSupported,
    micState,
    micLabel: micLabels[micState],
    lastTranscript,
    voiceError,
    toggleVoice,
    toggleSounds,
    testSound,
    performStatus,
    repeat,
    undo,
    pause,
    resume,
  };
}
