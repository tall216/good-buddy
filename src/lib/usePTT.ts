import { useRef, useCallback, useState } from 'react';
import {
  AudioModule,
  type AudioRecorder,
  type AudioPlayer,
  type RecordingOptions,
  createAudioPlayer,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { File } from 'expo-file-system';

// WebSocket relay server URL
const RELAY_URL = process.env.EXPO_PUBLIC_RELAY_URL || 'ws://localhost:8080';

// Voice-tuned recording preset. Real latency fix: the app was using
// RecordingPresets.HIGH_QUALITY (44.1kHz stereo AAC @ 128kbps) for a
// push-to-talk voice channel, not music. That's roughly 16KB/sec of
// audio to base64-encode, send over the relay, and decode on the other
// end -- for every single transmission, no matter how short. Voice is
// intelligible at far lower bitrates/sample rates than that.
//
// IMPORTANT cross-platform consistency note: RecordingPresets.LOW_QUALITY
// was NOT usable here even though it looks like the obvious choice --
// it uses a DIFFERENT container/codec per platform (.3gp/amr_nb on
// Android vs .m4a/AAC on iOS), which would have broken the single
// hardcoded 'audio/m4a' mime type the receiving side uses to build a
// playable data URI. Defined a custom preset instead: same .m4a/AAC
// container on both platforms, just tuned down for voice -- mono,
// 22050Hz (well above telephone-quality 8kHz, well below full-fidelity
// 44.1kHz), 32kbps. Roughly a 4x reduction in bytes-per-second versus
// HIGH_QUALITY.
const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000,
  android: {
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    outputFormat: 'aac ',
    audioQuality: 0x60, // AudioQuality.HIGH -- fine at this bitrate/mono, MAX is unnecessary overhead
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};

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
          const tReceived = Date.now();
          try {
            // Decode base64 to a data URI. Real bug found while investigating
            // playback latency: RecordingPresets.HIGH_QUALITY actually
            // records .m4a (MPEG-4 AAC), not WAV -- this was hardcoded to
            // 'audio/wav', a real MIME-type mismatch. Some players tolerate
            // it via content-sniffing (which is itself extra probing work
            // before playback can start), some don't. Fixed to match the
            // real recorded format.
            const uri = `data:audio/m4a;base64,${msg.data}`;
            // Release the previous player before creating a new one --
            // expo-audio's imperative players are not auto-garbage-collected
            // like expo-av's Audio.Sound.createAsync results were.
            playerRef.current?.remove();
            const player = createAudioPlayer(uri);
            playerRef.current = player;
            player.play();
            // TEMP instrumentation for diagnosing perceived delay -- remove
            // once the real latency budget is understood and settled.
            // Uses the relay server's own timestamps (serverReceivedAt/
            // serverRelayedAt) to separate real network+relay time from
            // local decode/playback-start time, instead of guessing.
            const tPlaybackStarted = Date.now();
            console.log(
              `[latency] payload ${msg.data?.length ?? 0} b64 chars | ` +
              `server relay->client receive: ${msg.serverRelayedAt ? tReceived - msg.serverRelayedAt : 'n/a'}ms | ` +
              `client receive->playback start: ${tPlaybackStarted - tReceived}ms`
            );
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

      const recorder = new AudioModule.AudioRecorder(VOICE_RECORDING_OPTIONS);
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
    const tRelease = Date.now();
    try {
      const recorder = recorderRef.current;
      if (!recorder) return;

      await recorder.stop();
      const tStopped = Date.now();
      const uri = recorder.uri;
      recorderRef.current = null;
      setTransmitting(false);

      // Notify relay
      wsRef.current?.send(JSON.stringify({ type: 'ptt_end' }));

      if (uri && wsRef.current?.readyState === WebSocket.OPEN) {
        // Direct native base64 read via expo-file-system's File class --
        // real, measured latency fix. The previous fetch(uri) ->
        // response.blob() -> FileReader.readAsDataURL() chain was flagged
        // by React Native's own runtime warning as a slow path (it copies
        // the response into RN's Blob store, then re-encodes through
        // FileReader on top of that). File.base64Sync() reads the file
        // and encodes it in one synchronous native call -- no Blob
        // store copy, no FileReader event round-trip through the bridge.
        try {
          const file = new File(uri);
          const base64 = file.base64Sync();
          const tEncoded = Date.now();
          wsRef.current?.send(JSON.stringify({
            type: 'audio',
            data: base64,
          }));
          const tSent = Date.now();
          // TEMP instrumentation for diagnosing perceived delay -- remove
          // once the real latency budget is understood and settled.
          console.log(`[latency] release->recorder.stop: ${tStopped - tRelease}ms, stop->base64: ${tEncoded - tStopped}ms, base64->ws.send: ${tSent - tEncoded}ms, total local: ${tSent - tRelease}ms, ${base64.length} b64 chars`);
        } catch (e) {
          console.error('Failed to read recording as base64:', e);
        }
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
