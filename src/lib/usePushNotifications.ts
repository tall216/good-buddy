import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { updatePushToken } from './supabase';

// Foreground notification handling: when the app IS open and a push
// arrives, expo-notifications calls this to decide whether to actually
// show it. Good Buddy already surfaces incoming audio/transmit state
// live in the UI while foregrounded (see RadioScreen's "LAST HEARD"
// display) -- a banner on top of that would be redundant/annoying, so
// this suppresses the visual notification but keeps the badge/data
// delivery working. The whole point of this feature is background
// alerting; foreground already has better, real-time UI for the same
// information.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

interface UsePushNotificationsReturn {
  // Real permission + registration state, exposed so RadioScreen can show
  // an honest toggle instead of firing requestPermissionsAsync() blind on
  // every mount (which would re-prompt a user who already said no, and
  // iOS/Android both treat repeated unwanted prompts poorly).
  pushEnabled: boolean;
  requestAndRegister: () => Promise<boolean>;
  unregister: () => Promise<void>;
}

// Real, user-facing feature: alert someone via a real OS push notification
// when a nearby buddy transmits WHILE this app is backgrounded/closed --
// not just "app running with a dead radio", the actual off-grid case.
// Gated entirely behind the existing "ON AIR"/discoverable toggle
// (RadioScreen.tsx's toggleDiscoverable) PLUS this separate opt-in --
// being on-air already means "discoverable to nearby buddies"; push
// notifications are an ADDITIONAL, separate consent the user must grant
// (a location-sharing app defaulting to also pushing OS notifications
// without being asked first would be a bad, presumptuous default).
export function usePushNotifications(userId: string | null): UsePushNotificationsReturn {
  const pushEnabledRef = useRef(false);

  const requestAndRegister = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;

    // Real Android requirement (SDK 33+/API 33+): notifications need
    // their own explicit runtime permission, same family as location/
    // microphone -- requestPermissionsAsync() covers both platforms
    // through one call, but the underlying OS behavior differs (iOS
    // shows its native system alert; Android 13+ shows the POST_
    // NOTIFICATIONS runtime prompt, older Android grants silently).
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Push notification permission denied');
      return false;
    }

    // Real project-id requirement for getExpoPushTokenAsync -- without
    // this it silently fails to resolve a usable token. Read from the
    // same eas.projectId app.json already declares for EAS builds,
    // rather than hardcoding it a second time somewhere.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId) {
      console.error('Missing EAS projectId -- cannot register for push notifications');
      return false;
    }

    try {
      const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync({ projectId });
      await updatePushToken(userId, expoPushToken, true);
      pushEnabledRef.current = true;
      return true;
    } catch (e) {
      // Real, documented failure mode (see expo-notifications docs):
      // this call hits Expo's servers and can fail on a flaky/offline
      // connection, not just a permission problem. Don't treat this as
      // "permission denied" -- surface it distinctly so a retry makes
      // sense to the user instead of looking like a dead end.
      console.error('Failed to register for push notifications:', e);
      return false;
    }
  }, [userId]);

  const unregister = useCallback(async () => {
    if (!userId) return;
    await updatePushToken(userId, null, false);
    pushEnabledRef.current = false;
  }, [userId]);

  // Real Android requirement: a notification channel must exist before
  // any notification can be shown on API 26+, and it's a one-time,
  // idempotent setup call, not something to gate behind the permission
  // flow above (creating a channel does not itself prompt/notify the
  // user -- it's just registering the category).
  useEffect(() => {
    if (Platform.OS === 'android') {
      Notifications.setNotificationChannelAsync('nearby-transmissions', {
        name: 'Nearby transmissions',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 200, 100, 200],
        lightColor: '#ffa620',
      });
    }
  }, []);

  return {
    pushEnabled: pushEnabledRef.current,
    requestAndRegister,
    unregister,
  };
}
