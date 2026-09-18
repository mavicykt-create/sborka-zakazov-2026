type RecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type RecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
};

type RecognitionErrorEvent = { error: string };

type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionConstructor = new () => RecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  }
}

type RecognitionOptions = {
  onFinal: (transcript: string) => void;
  onListening: (listening: boolean) => void;
  onError: (message: string) => void;
};

export type SpeechRecognitionAdapter = {
  readonly supported: boolean;
  start(): void;
  stop(): void;
  destroy(): void;
};

export function configurePausedRecognition(
  recognition: SpeechRecognitionAdapter | null,
  voiceEnabled: boolean,
) {
  if (voiceEnabled) recognition?.start();
  else recognition?.stop();
}

export function createSpeechRecognition(options: RecognitionOptions): SpeechRecognitionAdapter {
  const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Constructor) {
    return { supported: false, start() {}, stop() {}, destroy() {} };
  }

  const recognition = new Constructor();
  let desired = false;
  let started = false;
  let restartTimer: number | null = null;

  recognition.lang = 'ru-RU';
  recognition.continuous = true;
  recognition.interimResults = true;

  const startNow = () => {
    if (!desired || started) return;
    try {
      recognition.start();
    } catch {
      // start() throws while the previous session is still finishing; onend will retry.
    }
  };

  recognition.onstart = () => {
    started = true;
    options.onListening(true);
  };
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) options.onFinal(result[0].transcript);
    }
  };
  recognition.onerror = (event) => {
    if (event.error === 'aborted' || event.error === 'no-speech') return;
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') desired = false;
    options.onError(
      event.error === 'not-allowed'
        ? 'Нет доступа к микрофону. Разрешите его в настройках браузера.'
        : `Ошибка распознавания: ${event.error}`,
    );
  };
  recognition.onend = () => {
    started = false;
    options.onListening(false);
    if (desired) restartTimer = window.setTimeout(startNow, 250);
  };

  return {
    supported: true,
    start() {
      desired = true;
      startNow();
    },
    stop() {
      desired = false;
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      restartTimer = null;
      if (started) recognition.stop();
    },
    destroy() {
      desired = false;
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      recognition.abort();
    },
  };
}
