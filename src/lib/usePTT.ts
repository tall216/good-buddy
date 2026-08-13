import { useRef, useCallback, useState } from 'react';
import { Audio } from 'expo-av';

// WebSocket relay server URL
// Change this to your deployed server URL
const RELAY_URL = 'ws://localhost:8080';

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
  const recordingRef = useRef<Audio.Recording | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [transmitting, setTransmitting] = useState(false);
  const [lastHeard, setLastHeard] = useState<string | null>(null);

  // Set up audio mode for playback through speaker
  const setupAudio = useCallback(async () => {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false, // speaker
    });
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
            const { sound } = await Audio.Sound.createAsync(
              { uri },
              { shouldPlay: true }
            );
            soundRef.current = sound;

            sound.setOnPlaybackStatusUpdate((status) => {
              if (status.isLoaded && status.didJustFinish) {
                sound.unloadAsync();
              }
            });
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
  }, []);

  const startTransmit = useCallback(async () => {
    try {
      await setupAudio();

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      recordingRef.current = recording;
      setTransmitting(true);

      // Notify relay
      wsRef.current?.send(JSON.stringify({ type: 'ptt_start' }));
    } catch (e) {
      console.error('Failed to start recording:', e);
    }
  }, [setupAudio]);

  const stopTransmit = useCallback(async () => {
    try {
      const recording = recordingRef.current;
      if (!recording) return;

      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
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
