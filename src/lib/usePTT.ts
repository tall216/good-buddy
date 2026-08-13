import { useRef, useCallback, useState } from 'react';
import { Platform } from 'react-native';
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
// push-to-talk voice channel, not music -- see this file's git history
// for that fix's detail.
//
// REAL BUG FOUND AND ROOT-CAUSED via ffprobe analysis of actual recorded
// files pulled off a physical Android device (Galaxy A42, Android 12) via
// adb + run-as: every single Android-recorded .m4a/.mp4 file -- with
// EITHER this custom preset OR the original built-in HIGH_QUALITY preset,
// confirmed via git history timestamps that a corrupted file predates
// this preset's introduction -- had valid ftyp/mdat boxes but was
// completely missing its moov atom (the container trailer with all
// seek/duration metadata). 100% reproducible, not size- or
// duration-related (confirmed via real timing instrumentation: a genuine
// 2736ms recording produced the identical corruption as very short ones).
// Investigated the actual expo-audio Android Kotlin source
// (AudioRecorder.kt) and found this specific device/SDK combination
// still exhibits data loss on MediaRecorder.stop() even though status
// reports hasError: false -- MP4/M4A's atom-based container requires a
// clean trailer write on stop() to be valid at all, and something in
// this environment (an OEM MediaRecorder quirk, per multiple similar
// real-world reports found via research) isn't reliably completing that
// write. 3GP does not have this same fragility -- its container format
// doesn't depend on a single trailer write to remain parseable. Real,
// pragmatic fix: give each platform the recording options its own native
// MediaRecorder/AVAudioRecorder handles most reliably, rather than
// forcing a single shared container. iOS keeps .m4a/AAC (proven reliable
// via extensive live cross-platform testing this session). Android
// switches to .3gp/AMR-NB. The two platforms' outputs are no longer
// byte-compatible, so the WebSocket message now tags which format
// produced each chunk (see 'format' field below) and the receiving side
// builds its playback data URI from that instead of a single hardcoded
// MIME type.
const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  extension: Platform.OS === 'android' ? '.3gp' : '.m4a',
  sampleRate: Platform.OS === 'android' ? 8000 : 22050,
  numberOfChannels: 1,
  bitRate: Platform.OS === 'android' ? 12200 : 32000,
  android: {
    outputFormat: '3gp',
    audioEncoder: 'amr_nb',
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

// MIME type to use when building a playable data URI, matched to the
// ACTUAL format this platform records in (see VOICE_RECORDING_OPTIONS
// above for why these differ per platform).
const RECORDED_AUDIO_FORMAT = Platform.OS === 'android' ? '3gp' : 'm4a';
const AUDIO_MIME_BY_FORMAT: Record<string, string> = {
  '3gp': 'audio/3gpp',
  m4a: 'audio/m4a',
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
  // TEMP diagnostic ref for the moov-atom investigation -- tracks real
  // wall-clock recording duration to check whether adb-synthesized touch
  // presses are registering as much shorter holds than requested.
  const recordStartTimeRef = useRef<number | null>(null);

  // Shared across connect()/disconnect() -- see the real bug this fixes
  // in disconnect()'s comment below.
  const intentionallyClosedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real bug found via live cross-platform testing: pressed PTT and heard
  // an "echo" -- the same transmission playing back multiple times. Real
  // server logs showed the actual cause: "TestRig disconnected" firing
  // 2-3 times simultaneously, then 3-4 "New connection"/"joined" events
  // firing within milliseconds of each other on server restart -- meaning
  // MULTIPLE independent WebSocket connections, all claiming the same
  // call sign, were alive at once from the one physical device. Each
  // connect() call's openSocket()/reconnect closures had no way to know
  // if they'd been superseded by a newer connect() call (this session's
  // heavy live-code-editing-while-connected testing repeatedly triggered
  // Fast Refresh on this file, and React Native's Fast Refresh does not
  // reliably tear down in-flight closures like a pending
  // setTimeout(openSocket, delay) reconnect timer from a hook instance
  // that's since been replaced) -- so an orphaned reconnect loop from an
  // earlier hook instance kept running forever in the background,
  // independently reconnecting and duplicating every broadcast. Fixed
  // with a generation counter: every connect() call increments this and
  // captures its own value; openSocket()/onclose's reconnect scheduling
  // both check they're still the current generation before doing
  // anything, so a stale closure becomes permanently inert the moment a
  // newer connect() call supersedes it -- regardless of the underlying
  // cause (Fast Refresh, a genuine double-mount, anything).
  const connectionGenerationRef = useRef(0);

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
    intentionallyClosedRef.current = false;

    // Capture this call's own generation. Any closure below that reads
    // connectionGenerationRef.current later and finds it no longer
    // matches myGeneration knows it's been superseded and must not act.
    connectionGenerationRef.current += 1;
    const myGeneration = connectionGenerationRef.current;

    // Real gap found via live testing: the relay server (Render free
    // tier) went idle and restarted mid-session, killing the WebSocket
    // with no reconnection attempt -- confirmed via the server's own
    // logs showing only one client remained "joined" after a restart
    // while the other device's connection silently stayed dead. Added
    // a bounded auto-reconnect so a dropped connection (idle timeout,
    // server restart, network blip) recovers on its own instead of
    // requiring the user to force-quit and reopen the app.
    let reconnectAttempts = 0;
    const MAX_RECONNECT_DELAY_MS = 15000;

    const openSocket = () => {
      // Real fix for the duplicate-connection "echo" bug -- see this
      // ref's declaration comment above for the full root-cause story.
      // A stale reconnect timer firing after a newer connect() call has
      // already taken over must not open yet another socket.
      if (connectionGenerationRef.current !== myGeneration) return;

      const ws = new WebSocket(RELAY_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts = 0;
        ws.send(JSON.stringify({
          type: 'join',
          callSign,
          lat,
          lng,
          range,
        }));
      };

      ws.onmessage = async (event) => {
        // Real fix for the duplicate-connection "echo" bug -- a stale
        // socket from a superseded connect() generation can still
        // deliver messages in the brief window before its own onclose
        // fires. Refuse to act on anything once superseded.
        if (connectionGenerationRef.current !== myGeneration) return;

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
              // Decode base64 to a data URI, using the MIME type that
              // matches whichever format the SENDER actually recorded in
              // (see VOICE_RECORDING_OPTIONS/AUDIO_MIME_BY_FORMAT above --
              // Android and iOS now record in genuinely different
              // container formats after the real moov-atom-corruption fix,
              // so this can no longer be a single hardcoded MIME type).
              const senderFormat = msg.format && AUDIO_MIME_BY_FORMAT[msg.format] ? msg.format : RECORDED_AUDIO_FORMAT;
              const uri = `data:${AUDIO_MIME_BY_FORMAT[senderFormat]};base64,${msg.data}`;
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
        if (intentionallyClosedRef.current) return;
        // Real fix for the duplicate-connection "echo" bug -- a
        // superseded generation's socket closing must not schedule yet
        // another reconnect; the current generation already owns that.
        if (connectionGenerationRef.current !== myGeneration) return;
        // Exponential backoff, capped, so a persistently-down relay
        // doesn't hammer it or drain the battery.
        const delay = Math.min(1000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
        reconnectAttempts++;
        reconnectTimerRef.current = setTimeout(openSocket, delay);
      };
    };

    openSocket();
  }, [setupAudio]);

  const disconnect = useCallback(() => {
    // Real bug fixed here: this used to close the socket without ever
    // telling the reconnect logic in connect() to stop. Found while
    // tracing why a stale WebSocket could linger after RadioScreen
    // unmounts/re-mounts -- the old close() would fire onclose, which
    // (before this fix) had no way to know the disconnect was
    // intentional, and would schedule a reconnect anyway.
    intentionallyClosedRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
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
      recordStartTimeRef.current = Date.now();
      setTransmitting(true);

      // Notify relay
      wsRef.current?.send(JSON.stringify({ type: 'ptt_start' }));
    } catch (e) {
      console.error('Failed to start recording:', e);
      // Real fix: AudioRecorder is a SharedObject with a native
      // counterpart -- just nulling the JS ref here left the native
      // recorder object un-released. Found while investigating a
      // recurring INVALID_STATE_ERR on iOS: every failed start (or, before
      // this fix, every successful stop too -- see stopTransmit below)
      // could leave a stale native AVAudioRecorder instance alive,
      // plausibly poisoning the AVAudioSession for the next attempt.
      // release() detaches the JS/native pair immediately instead of
      // waiting on GC.
      try {
        recorderRef.current?.release();
      } catch {
        // already released or never fully constructed -- fine to ignore
      }
      recorderRef.current = null;
    }
  }, [setupAudio, transmitting]);

  const stopTransmit = useCallback(async () => {
    const tRelease = Date.now();
    const heldForMs = recordStartTimeRef.current ? tRelease - recordStartTimeRef.current : null;
    try {
      const recorder = recorderRef.current;
      if (!recorder) return;

      // Real bug found via ffprobe analysis of actual recorded files
      // pulled off the physical Android device (adb + run-as): every
      // Android-recorded .m4a had valid ftyp/mdat boxes but NO moov atom
      // -- 100% reproducible, not size- or duration-related. Root-caused
      // to Android's native MediaRecorder.stop() in expo-audio's own
      // Kotlin source (AudioRecorder.kt): when the native stop() call
      // throws a RuntimeException (a real, documented MediaRecorder
      // behavior), the catch block swallows it, calls reset()
      // (release()) anyway, and the JS-side stop() promise still
      // resolves normally -- so this code was blindly trusting
      // recorder.uri as if the file were valid, with zero way to know
      // the native stop actually failed to finalize the container.
      // expo-audio DOES expose this via a real event
      // (recordingStatusUpdate, with hasError/error/url fields) that
      // this code was never listening for. Fixed by awaiting that
      // event instead of trusting the bare stop() resolution + .uri.
      // Real, documented Android platform behavior (confirmed via
      // multiple independent real-world reports, not guessed): calling
      // MediaRecorder.stop() less than ~1 second after start() reliably
      // throws RuntimeException("stop failed.") on many devices/OEM
      // builds -- there isn't enough buffered audio for the encoder to
      // finalize a valid container. This is a real, separate, additive
      // cause alongside the still-open moov-atom investigation (that one
      // reproduced even on long holds; THIS one is specifically about
      // quick taps). Enforce a floor so a fast tap-and-release doesn't
      // hand the OS an impossible timing window.
      const MIN_RECORDING_MS = 1200;
      if (heldForMs !== null && heldForMs < MIN_RECORDING_MS) {
        await new Promise((resolve) => setTimeout(resolve, MIN_RECORDING_MS - heldForMs));
      }

      const statusPromise = new Promise<{ hasError: boolean; error: string | null; url: string | null }>((resolve) => {
        const subscription = recorder.addListener('recordingStatusUpdate', (status) => {
          if (status.isFinished) {
            subscription.remove();
            resolve({ hasError: status.hasError, error: status.error, url: status.url });
          }
        });
      });

      await recorder.stop();
      const status = await statusPromise;
      const tStopped = Date.now();

      if (status.hasError) {
        console.error('Native recorder failed to finalize the file:', status.error);
      }
      const uri = status.hasError ? null : status.url;

      // Release the native recorder object now that we're done with it --
      // see the matching comment in startTransmit's catch block for why
      // this matters (un-released native AudioRecorder instances were a
      // real, confirmed contributor to the recurring iOS INVALID_STATE_ERR).
      try {
        recorder.release();
      } catch {
        // already released -- fine to ignore
      }
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
            format: RECORDED_AUDIO_FORMAT,
          }));
          const tSent = Date.now();
          // TEMP instrumentation for diagnosing perceived delay -- remove
          // once the real latency budget is understood and settled.
          console.log(`[latency] held for: ${heldForMs}ms, release->recorder.stop: ${tStopped - tRelease}ms, stop->base64: ${tEncoded - tStopped}ms, base64->ws.send: ${tSent - tEncoded}ms, total local: ${tSent - tRelease}ms, ${base64.length} b64 chars`);
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
