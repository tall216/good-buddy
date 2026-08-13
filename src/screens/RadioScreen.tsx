import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from 'react-native';
import { colors, spacing, fonts } from '../theme';
import { AdSlot } from '../components/AdSlot';
import { useRadio } from '../lib/useRadio';
import { usePTT } from '../lib/usePTT';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// Range options in miles
const RANGE_OPTIONS = [1, 5, 10, 25, 50, 100];

interface Props {
  callSign: string;
}

export default function RadioScreen({ callSign }: Props) {
  const [range, setRange] = useState(10);
  const [discoverable, setDiscoverable] = useState(true);

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

  // Register with Supabase on mount
  useEffect(() => {
    register(callSign);
  }, [callSign]);

  // Connect to audio relay once we have both a userId and a real GPS fix.
  // Previously this connected immediately with hardcoded (0, 0) coordinates,
  // meaning the relay server's distance-based audio filtering never used
  // real location at all. Now waits for useRadio's actual location.
  useEffect(() => {
    if (userId && location) {
      const { latitude, longitude } = location.coords;
      connect(callSign, latitude, longitude, range);
      return () => disconnect();
    }
  }, [userId, location]);

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

  const vuWidth = vuAnim.interpolate({
    inputRange: [0, 0.4],
    outputRange: ['5%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root}>
      {/* Top bar: call sign + status */}
      <View style={styles.topBar}>
        <View style={styles.callSignBadge}>
          <Text style={styles.callSignLabel}>HANDLE</Text>
          <Text style={styles.callSignValue}>{callSign}</Text>
        </View>
        <View style={styles.statusBadge}>
          <View style={[styles.statusDot, discoverable && styles.statusDotOn]} />
          <Text style={styles.statusText}>
            {discoverable ? 'ON AIR' : 'RADIO SILENT'}
          </Text>
        </View>
      </View>

      {/* Error display */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Speaker grille */}
      <View style={styles.grille}>
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} style={styles.grilleRow}>
            {Array.from({ length: 10 }).map((_, j) => (
              <View key={j} style={styles.grilleSlot} />
            ))}
          </View>
        ))}
      </View>

      {/* Frequency display */}
      <View style={styles.freqPanel}>
        <Text style={styles.freqLabel}>FREQUENCY</Text>
        <Text style={styles.freqValue}>27.185</Text>
        <Text style={styles.freqUnit}>MHz</Text>
      </View>

      {/* Range display */}
      <View style={styles.rangePanel}>
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
        <TouchableOpacity
          style={[styles.toggleButton, discoverable && styles.toggleOn]}
          onPress={toggleDiscoverable}
        >
          <Text style={styles.toggleText}>
            {discoverable ? 'ON AIR' : 'SILENT'}
          </Text>
        </TouchableOpacity>

        <View style={styles.knobRow}>
          <View style={styles.knob}>
            <View style={styles.knobIndicator} />
          </View>
          <View style={styles.knob}>
            <View style={styles.knobIndicator} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  callSignBadge: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 4,
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
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
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
    backgroundColor: '#330000',
    borderWidth: 1,
    borderColor: colors.red,
    borderRadius: 4,
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
    backgroundColor: colors.grille,
    borderRadius: 4,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grilleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  grilleSlot: {
    width: 24,
    height: 5,
    backgroundColor: colors.bg,
    borderRadius: 1,
  },
  freqPanel: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
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
    color: colors.green,
    letterSpacing: 4,
  },
  freqUnit: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.greenDim,
    letterSpacing: 2,
  },
  rangePanel: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    padding: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
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
    backgroundColor: colors.border,
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
    backgroundColor: colors.grille,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.border,
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
    borderColor: '#881100',
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
    backgroundColor: '#ff2200',
    borderColor: '#ff4400',
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
  toggleButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.redDim,
    borderRadius: 4,
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
  knob: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.knob,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobIndicator: {
    width: 3,
    height: 12,
    backgroundColor: colors.amber,
    borderRadius: 1,
  },
});
