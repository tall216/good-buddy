import { useRef, useCallback, useState } from 'react';
import {
  AudioModule,
  type AudioRecorder,
  type AudioPlayer,
  createAudioPlayer,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
} from 'expo-audio';

// WebSocket relay server URL
const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL || 'ws://localhost:8080';

interface UsePTTReturn {
  transmitting: boolean;
  lastHeard: string | null;
  connect: (callSign: string, lat: number, lng: number, range: number) => void;
  disconnect: () => void;
  startTransmit: () => Promise<void>;
  stopTransmit: () => Promise<void>;
  updateLocation: (lat: number, lng: number, range: number) => void;
}

export function usePTT(): UsePTTReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<AudioRecorder | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const [transmitting, setTransmitting] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  // Set up audio mode for playback through speaker.
  // Migrated from expo-av's setAudioModeAsync -- the old shape
  // (allowsRecordingIOS, shouldDuckAndroid, playThroughEarpieceAndroid,
  // staysActiveInBackground) doesn't exist on expo-audio's AudioMode type.
  // interruptionMode: 'duckOthers' is the real replacement for
  // shouldDuckAndroid. playThroughEarpieceAndroid has no direct
  // equivalent -- expo-audio defaults to speaker routing, which is what
  // this app wants (a CB radio should be heard, not held to your ear).
  //
  // Real bug found via live iOS device testing: connect() called
  // setupAudio() fire-and-forget (unawaited), and startTransmit() called
  // it again, awaited. On iOS, AVAudioSession category changes are
  // timing-sensitive -- two overlapping setAudioModeAsync calls can race
  // and leave the session in a state where prepareToRecordAsync()/record()
  // throw INVALID_STATE_ERR. Android's AudioManager is far more forgiving
  // of the same pattern, which is why this only surfaced on iOS. Fixed by
  // sharing a single in-flight promise so concurrent callers await the
  // same underlying call instead of racing two separate ones.
  const audioSetupPromiseRef = useRef<Promise<void> | null>(null);
  const setupAudio = useCallback(async () => {
    if (!audioSetupPromiseRef.current) {
      audioSetupPromiseRef.current = setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
      }).finally(() => {
        audioSetupPromiseRef.current = null;
      });
    }
    return audioSetupPromiseRef.current;
  }, []);

  const connect = useCallback((callSign: string, lat: number, lng: number, range: number) => {
    setupAudio();

    const ws = new WebSocket(RELAY_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        type: 'join',
        callSign,
        lat,
        lng,
        range,
      }));
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'audio': {
          // Play incoming audio chunk
          setLastHeard(msg.callSign);
          try {
            // Decode base64 to URI
            const uri = `data:audio/wav;base64,${msg.data}`;
            // Release the previous player before creating a new one --
            // expo-audio's imperative players are not auto-garbage-collected
            // like expo-av's Audio.Sound.createAsync results were.
            playerRef.current?.remove();
            const player = createAudioPlayer(uri);
            playerRef.current = player;
            player.play();
          } catch (e) {
            console.error('Playback error:', e);
          }
          break;
        }

        case 'ptt_start': {
          // Someone else keyed up — could play a "channel busy" indicator
          break;
        }

        case 'ptt_end': {
          break;
        }

        case 'joined': {
          setLastHeard(`${msg.callSign} joined`);
          break;
        }

        case 'left': {
          setLastHeard(`${msg.callSign} left`);
          break;
        }
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };
  }, [setupAudio]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    playerRef.current?.remove();
    playerRef.current = null;
  }, []);

  const startTransmit = useCallback(async () => {
    // Guard against a second press firing while the first is still
    // mid-setup (e.g. rapid double-tap) -- creating a second AudioRecorder
    // before the first is prepared is another path to the same
    // INVALID_STATE_ERR seen on iOS.
    if (recorderRef.current || transmitting) return;

    try {
      await setupAudio();

      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        console.error('Microphone permission denied');
        return;
      }

      const recorder = new AudioModule.AudioRecorder(RecordingPresets.HIGH_QUALITY);
      recorderRef.current = recorder;
      await recorder.prepareToRecordAsync();
      recorder.record();
      setTransmitting(true);

      // Notify relay
      wsRef.current?.send(JSON.stringify({ type: 'ptt_start' }));
    } catch (e) {
      console.error('Failed to start recording:', e);
      recorderRef.current = null;
    }
  }, [setupAudio, transmitting]);

  const stopTransmit = useCallback(async () => {
    try {
      const recorder = recorderRef.current;
      if (!recorder) return;

      await recorder.stop();
      const uri = recorder.uri;
      recorderRef.current = null;
      setTransmitting(false);

      // Notify relay
      wsRef.current?.send(JSON.stringify({ type: 'ptt_end' }));

      if (uri && wsRef.current?.readyState === WebSocket.OPEN) {
        // Read the audio file as base64
        const response = await fetch(uri);
        const blob = await response.blob();

        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          wsRef.current?.send(JSON.stringify({
            type: 'audio',
            data: base64,
          }));
        };
        reader.readAsDataURL(blob);
      }
    } catch (e) {
      console.error('Failed to stop recording:', e);
      setTransmitting(false);
    }
  }, []);

  const updateLocation = useCallback((lat: number, lng: number, range: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'update',
        lat,
        lng,
        range,
      }));
    }
  }, []);

  return {
    transmitting,
    lastHeard,
    connect,
    disconnect,
    startTransmit,
    stopTransmit,
    updateLocation,
  };
}
