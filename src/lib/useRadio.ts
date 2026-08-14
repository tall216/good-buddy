import { useState, useEffect, useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import {
  supabase,
  registerUser,
  updateLocation,
  findNearbyUsers,
  subscribeToPresence,
  NearbyUser,
} from './supabase';

interface UseRadioReturn {
  userId: string | null;
  nearbyUsers: NearbyUser[];
  nearbyCount: number;
  location: Location.LocationObject | null;
  error: string | null;
  register: (callSign: string) => Promise<boolean>;
  setDiscoverable: (d: boolean) => void;
}

export function useRadio(): UseRadioReturn {
  const [userId, setUserId] = useState<string | null>(null);
  const [nearbyUsers, setNearbyUsers] = useState<NearbyUser[]>([]);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discoverable, setDiscoverableState] = useState(true);
  // Real fix: this range independently gates the "nearby buddies"
  // discovery query (findNearbyUsers below) -- separate from
  // RadioScreen's own range state used for the PTT relay. RadioScreen
  // never calls setRange on this hook, so this default alone decides
  // discovery range. Matched to RadioScreen's 2500mi default so
  // discovery and relay range agree -- previously this stayed at 10mi
  // even when a user set relay range higher, silently hiding nearby
  // (but >10mi) testers from the "GOOD BUDDIES IN RANGE" count.
  const [range, setRange] = useState(2500); // miles

  const discoverableRef = useRef(true);
  const rangeRef = useRef(2500);
  const userIdRef = useRef<string | null>(null);
  const locationRef = useRef<Location.LocationObject | null>(null);

  // Keep refs in sync
  useEffect(() => { discoverableRef.current = discoverable; }, [discoverable]);
  useEffect(() => { rangeRef.current = range; }, [range]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { locationRef.current = location; }, [location]);

  // Register call sign
  const register = useCallback(async (callSign: string): Promise<boolean> => {
    const id = await registerUser(callSign);
    if (id) {
      setUserId(id);
      return true;
    }
    setError('Registration failed. Check your connection and try again.');
    return false;
  }, []);

  // Request location permissions and start watching
  useEffect(() => {
    if (!userId) return;

    let locationSub: Location.LocationSubscription;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied. Good Buddy needs your location to find nearby buddies.');
        return;
      }

      locationSub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,  // update every 5 seconds
          distanceInterval: 10, // or every 10 meters
        },
        (loc) => {
          setLocation(loc);
        }
      );
    })();

    return () => {
      locationSub?.remove();
    };
  }, [userId]);

  // Update Supabase when location changes
  useEffect(() => {
    if (!userId || !location) return;

    const { latitude, longitude } = location.coords;
    updateLocation(userId, latitude, longitude, discoverableRef.current);
  }, [userId, location?.coords.latitude, location?.coords.longitude]);

  // Poll for nearby users
  useEffect(() => {
    if (!userId || !location) return;

    const poll = async () => {
      const { latitude, longitude } = locationRef.current?.coords || {};
      if (!latitude || !longitude) return;

      const users = await findNearbyUsers(latitude, longitude, rangeRef.current, userIdRef.current ?? undefined);
      setNearbyUsers(users);
    };

    // Initial poll
    poll();

    // Poll every 10 seconds
    const interval = setInterval(poll, 10000);

    // Also subscribe to realtime changes
    const unsubscribe = subscribeToPresence(() => {
      poll(); // re-fetch on any presence change
    });

    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [userId, location]);

  const setDiscoverable = useCallback((d: boolean) => {
    setDiscoverableState(d);
    // Immediately update Supabase
    if (userId && location) {
      const { latitude, longitude } = location.coords;
      updateLocation(userId, latitude, longitude, d);
    }
  }, [userId, location]);

  return {
    userId,
    nearbyUsers,
    nearbyCount: nearbyUsers.length,
    location,
    error,
    register,
    setDiscoverable,
  };
}
