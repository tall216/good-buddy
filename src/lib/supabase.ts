import { createClient } from '@supabase/supabase-js';

// Replace these with your Supabase project values
// Get them from: Supabase Dashboard > Project Settings > API
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export interface NearbyUser {
  id: string;
  call_sign: string;
  distance_miles: number;
}

export async function registerUser(callSign: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('users')
    .insert({ call_sign: callSign })
    .select('id')
    .single();

  if (error) {
    console.error('Failed to register user:', error);
    return null;
  }
  return data.id;
}

export async function updateLocation(
  userId: string,
  lat: number,
  lng: number,
  discoverable: boolean
): Promise<void> {
  const { error } = await supabase.rpc('update_user_location', {
    p_id: userId,
    p_lat: lat,
    p_lng: lng,
    p_discoverable: discoverable,
  });

  if (error) {
    console.error('Failed to update location:', error);
  }
}

export async function findNearbyUsers(
  lat: number,
  lng: number,
  rangeMiles: number
): Promise<NearbyUser[]> {
  const { data, error } = await supabase.rpc('find_nearby_users', {
    p_lat: lat,
    p_lng: lng,
    p_range_miles: rangeMiles,
  });

  if (error) {
    console.error('Failed to find nearby users:', error);
    return [];
  }
  return data || [];
}

export function subscribeToPresence(
  onUpdate: (users: NearbyUser[]) => void
): () => void {
  const channel = supabase
    .channel('presence')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'users' },
      () => {
        // Re-fetch nearby users on any change
        // The caller should trigger a re-fetch
        onUpdate([]);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
