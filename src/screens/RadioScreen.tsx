import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { colors, spacing, fonts, radii } from '../theme';
import { Panel, LCDWell, Knob } from '../components/RadioChrome';
import { useRadio } from '../lib/useRadio';
import { usePTT } from '../lib/usePTT';
import { usePushNotifications } from '../lib/usePushNotifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Range options in miles. 2500 added as the effective "unlimited"
// option for now -- real user request: testers are geographically
// spread out (not all local), and the previous 100mi max meant remote
// testers genuinely could not hear each other at all. 2500mi covers
// the entire continental US as a practical ceiling.
const RANGE_OPTIONS = [1, 5, 10, 25, 50, 100, 2500];

interface Props {
  callSign: string;
}

export default function RadioScreen({ callSign }: Props) {
  const insets = useSafeAreaInsets();
  const [range, setRange] = useState(2500);
  const [discoverable, setDiscoverable] = useState(true);
  // Separate opt-in state from `discoverable` on purpose -- see
  // usePushNotifications.ts's top comment for why these must not be
  // conflated. Starts false; the user must explicitly tap the bell.
  const [pushEnabled, setPushEnabled] = useState(false);

  const {
    userId,
    nearbyCount,
    location,
    error,
    register,
    setDiscoverable: updateDiscoverable,
  } = useRadio();

  const {
    transmitting,
    lastHeard,
    connect,
    disconnect,
    startTransmit,
    stopTransmit,
    updateLocation,
  } = usePTT();

  const { requestAndRegister, unregister } = usePushNotifications(userId);

  // Register with Supabase on mount
  useEffect(() => {
    register(callSign);
  }, [callSign]);

  // Connect to audio relay once we have both a userId and a real GPS fix.
  // Previously this connected immediately with hardcoded (0, 0) coordinates,
  // meaning the relay server's distance-based audio filtering never used
  // real location at all. Now waits for useRadio's actual location.
  //
  // Real bug found via live device testing (backgrounding the app, then
  // watching the relay server's own logs): this effect depended on
  // [userId, location], and `location` changes every 5-10s via
  // watchPositionAsync -- so connect()/disconnect() was firing on EVERY
  // location update, not once. The relay logs showed a client repeatedly
  // joining and disconnecting every ~10-20s, which is this bug in action,
  // not a real network issue. Fixed by connecting once (gated on a ref)
  // and routing subsequent location changes through the separate
  // updateLocation() call below instead of a full reconnect.
  const hasConnectedRef = useRef(false);
  useEffect(() => {
    if (userId && location && !hasConnectedRef.current) {
      hasConnectedRef.current = true;
      const { latitude, longitude } = location.coords;
      connect(userId, callSign, latitude, longitude, range);
    }
  }, [userId, location]);

  useEffect(() => {
    return () => {
      hasConnectedRef.current = false;
      disconnect();
    };
  }, []);

  // Push real location + range updates to the relay as either changes.
  useEffect(() => {
    if (location) {
      const { latitude, longitude } = location.coords;
      updateLocation(latitude, longitude, range);
    }
  }, [range, location]);

  // VU meter animation
  const vuAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      Animated.sequence([
        Animated.timing(vuAnim, {
          toValue: Math.random() * 0.3 + 0.1,
          duration: 200,
          useNativeDriver: false,
        }),
        Animated.timing(vuAnim, {
          toValue: 0.05,
          duration: 300,
          useNativeDriver: false,
        }),
      ]).start();
    }, 800);
    return () => clearInterval(interval);
  }, []);

  const rangeIndex = RANGE_OPTIONS.indexOf(range);

  const handlePTTPress = () => {
    startTransmit();
  };

  const handlePTTRelease = () => {
    stopTransmit();
  };

  const cycleRange = () => {
    const next = (rangeIndex + 1) % RANGE_OPTIONS.length;
    setRange(RANGE_OPTIONS[next]);
  };

  const toggleDiscoverable = () => {
    const next = !discoverable;
    setDiscoverable(next);
    updateDiscoverable(next);
  };

  const togglePushNotifications = async () => {
    if (pushEnabled) {
      await unregister();
      setPushEnabled(false);
    } else {
      const granted = await requestAndRegister();
      setPushEnabled(granted);
    }
  };

  const vuWidth = vuAnim.interpolate({
    inputRange: [0, 0.4],
    outputRange: ['5%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, spacing.lg), paddingBottom: insets.bottom }]}>
      {/* Top bar: call sign + status */}
      <View style={styles.topBar}>
        <Panel style={styles.callSignBadge} screws={false}>
          <View style={styles.badgeInner}>
            <Text style={styles.callSignLabel}>HANDLE</Text>
            <Text style={styles.callSignValue}>{callSign}</Text>
          </View>
        </Panel>
        <Panel style={styles.statusBadge} screws={false}>
          <View style={styles.statusBadgeInner}>
            <View style={[styles.statusDot, discoverable && styles.statusDotOn]} />
            <Text style={styles.statusText}>
              {discoverable ? 'ON AIR' : 'RADIO SILENT'}
            </Text>
          </View>
        </Panel>
      </View>

      {/* Error display */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Speaker grille */}
      <Panel style={styles.grille} inset>
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={styles.grilleRow}>
            {Array.from({ length: 10 }).map((_, j) => (
              <View key={j} style={styles.grilleSlot} />
            ))}
          </View>
        ))}
      </Panel>

      {/* Frequency display -- real backlit LCD well */}
      <LCDWell style={styles.freqPanel}>
        <Text style={styles.freqLabel}>FREQUENCY</Text>
        <Text style={styles.freqValue}>27.185</Text>
        <Text style={styles.freqUnit}>MHz</Text>
      </LCDWell>

      {/* Range display */}
      <Panel style={styles.rangePanel} screws={false}>
        <View style={styles.rangePanelInner}>
          <Text style={styles.rangeLabel}>RANGE</Text>
          <TouchableOpacity onPress={cycleRange} style={styles.rangeValue}>
            <Text style={styles.rangeNumber}>{range}</Text>
            <Text style={styles.rangeUnit}>MI</Text>
          </TouchableOpacity>
          <View style={styles.rangeBar}>
            {RANGE_OPTIONS.map((r) => (
              <View
                key={r}
                style={[
                  styles.rangeSegment,
                  r <= range && styles.rangeSegmentActive,
                ]}
              />
            ))}
          </View>
        </View>
      </Panel>

      {/* VU Meter */}
      <View style={styles.vuMeter}>
        <Text style={styles.vuLabel}>SIGNAL</Text>
        <View style={styles.vuTrack}>
          <Animated.View style={[styles.vuFill, { width: vuWidth }]} />
        </View>
      </View>

      {/* Nearby count */}
      <View style={styles.nearbyPanel}>
        <Text style={styles.nearbyCount}>{nearbyCount}</Text>
        <Text style={styles.nearbyLabel}>
          GOOD BUDDIE{nearbyCount !== 1 ? 'S' : ''} IN RANGE
        </Text>
      </View>

      {/* Last heard */}
      {lastHeard && (
        <View style={styles.lastHeard}>
          <Text style={styles.lastHeardLabel}>LAST HEARD</Text>
          <Text style={styles.lastHeardValue}>{lastHeard}</Text>
        </View>
      )}

      {/* PTT Button */}
      <TouchableOpacity
        style={[styles.pttButton, transmitting && styles.pttActive]}
        onPressIn={handlePTTPress}
        onPressOut={handlePTTRelease}
        activeOpacity={0.8}
      >
        <Text style={styles.pttText}>
          {transmitting ? 'TRANSMITTING' : 'PUSH TO TALK'}
        </Text>
        <Text style={styles.pttSub}>HOLD TO SPEAK</Text>
      </TouchableOpacity>

      {/* Bottom controls */}
      <View style={styles.bottomControls}>
        <View style={styles.bottomToggleRow}>
          <TouchableOpacity
            style={[styles.toggleButton, discoverable && styles.toggleOn]}
            onPress={toggleDiscoverable}
          >
            <Text style={styles.toggleText}>
              {discoverable ? 'ON AIR' : 'SILENT'}
            </Text>
          </TouchableOpacity>

          {/* Separate opt-in from ON AIR/SILENT on purpose -- see
              usePushNotifications.ts's top comment. A real background
              push alert is a bigger ask than just "discoverable", so
              it gets its own explicit control rather than riding along
              with the existing toggle. */}
          <TouchableOpacity
            style={[styles.toggleButton, pushEnabled && styles.toggleOn]}
            onPress={togglePushNotifications}
          >
            <Text style={styles.toggleText}>
              {pushEnabled ? '🔔 ALERTS ON' : '🔕 ALERTS OFF'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.knobRow}>
          <Knob rotation={-20} />
          <Knob rotation={60} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.chassisDark,
    paddingHorizontal: spacing.md,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  callSignBadge: {
    borderColor: colors.amber,
  },
  badgeInner: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  callSignLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.textDim,
    letterSpacing: 2,
  },
  callSignValue: {
    fontFamily: fonts.display,
    fontSize: 16,
    color: colors.amber,
    letterSpacing: 2,
  },
  statusBadge: {},
  statusBadgeInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.redDim,
  },
  statusDotOn: {
    backgroundColor: colors.green,
  },
  statusText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textDim,
    letterSpacing: 2,
  },
  errorBanner: {
    backgroundColor: colors.redDim,
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.red,
    textAlign: 'center',
  },
  grille: {
    width: '100%',
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  grilleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  grilleSlot: {
    width: 24,
    height: 5,
    backgroundColor: colors.chassisDark,
    borderRadius: 1,
  },
  freqPanel: {
    padding: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  freqLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.textDim,
    letterSpacing: 3,
  },
  freqValue: {
    fontFamily: fonts.display,
    fontSize: 32,
    color: colors.lcdText,
    letterSpacing: 4,
  },
  freqUnit: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.lcdGlowDim,
    letterSpacing: 2,
  },
  rangePanel: {
    marginBottom: spacing.sm,
  },
  rangePanelInner: {
    padding: spacing.sm,
    alignItems: 'center',
  },
  rangeLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.textDim,
    letterSpacing: 3,
  },
  rangeValue: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  rangeNumber: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.amber,
    letterSpacing: 2,
  },
  rangeUnit: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.amber,
    letterSpacing: 2,
  },
  rangeBar: {
    flexDirection: 'row',
    gap: 3,
    marginTop: spacing.xs,
    width: '80%',
  },
  rangeSegment: {
    flex: 1,
    height: 4,
    backgroundColor: colors.borderDark,
    borderRadius: 1,
  },
  rangeSegmentActive: {
    backgroundColor: colors.amber,
  },
  vuMeter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  vuLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.textDim,
    letterSpacing: 2,
    width: 50,
  },
  vuTrack: {
    flex: 1,
    height: 8,
    backgroundColor: colors.panelInset,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.borderDark,
    overflow: 'hidden',
  },
  vuFill: {
    height: '100%',
    backgroundColor: colors.green,
    borderRadius: 1,
  },
  nearbyPanel: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  nearbyCount: {
    fontFamily: fonts.display,
    fontSize: 36,
    color: colors.green,
    letterSpacing: 4,
  },
  nearbyLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textDim,
    letterSpacing: 2,
  },
  lastHeard: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  lastHeardLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    color: colors.textDim,
    letterSpacing: 2,
  },
  lastHeardValue: {
    fontFamily: fonts.display,
    fontSize: 14,
    color: colors.amber,
    letterSpacing: 2,
  },
  pttButton: {
    width: SCREEN_WIDTH * 0.5,
    height: SCREEN_WIDTH * 0.5,
    borderRadius: SCREEN_WIDTH * 0.25,
    backgroundColor: colors.red,
    borderWidth: 4,
    borderColor: colors.redDim,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
    elevation: 8,
    shadowColor: colors.red,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  pttActive: {
    backgroundColor: colors.redBright,
    borderColor: colors.redBright,
    elevation: 12,
    shadowOpacity: 0.6,
  },
  pttText: {
    fontFamily: fonts.display,
    fontSize: 18,
    fontWeight: '900',
    color: colors.white,
    letterSpacing: 3,
    textAlign: 'center',
  },
  pttSub: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.white,
    opacity: 0.7,
    marginTop: spacing.xs,
  },
  bottomControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 'auto',
    marginBottom: spacing.lg,
  },
  bottomToggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.redDim,
    borderRadius: radii.md,
    backgroundColor: colors.panel,
  },
  toggleOn: {
    borderColor: colors.green,
  },
  toggleText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textDim,
    letterSpacing: 3,
  },
  knobRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
});
