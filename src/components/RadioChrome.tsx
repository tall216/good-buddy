// Shared radio-chassis UI primitives. Built once, reused across both
// screens so the whole app reads as one consistent physical device
// instead of two independently-styled screens.
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radii } from '../theme';

// A single flat-head screw, for panel-corner hardware detailing --
// the small touch that reads as "real machined chassis" rather than a
// flat mockup.
export function Screw({ style }: { style?: ViewStyle }) {
  return (
    <View style={[chromeStyles.screw, style]}>
      <View style={chromeStyles.screwSlot} />
    </View>
  );
}

// A recessed panel with real gradient depth (subtle top-to-bottom
// brushed-metal falloff) and screws at the corners, matching real
// transceiver front-panel construction.
export function Panel({
  children,
  style,
  screws = true,
  inset = false,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  screws?: boolean;
  inset?: boolean;
}) {
  return (
    <View style={[chromeStyles.panelOuter, style]}>
      <LinearGradient
        colors={inset
          ? [colors.panelInset, colors.panel]
          : [colors.panelLight, colors.panel]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={chromeStyles.panelGradient}
      >
        {children}
      </LinearGradient>
      {screws && (
        <>
          <Screw style={chromeStyles.screwTL} />
          <Screw style={chromeStyles.screwTR} />
        </>
      )}
    </View>
  );
}

// A backlit LCD-style display well -- deep-set, glowing edge, matching
// a real transceiver's frequency/status readout rather than a flat
// colored box.
export function LCDWell({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return (
    <View style={[chromeStyles.lcdOuter, style]}>
      <LinearGradient
        colors={[colors.lcdBg, '#050a08']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={chromeStyles.lcdGradient}
      >
        {children}
      </LinearGradient>
    </View>
  );
}

// A physical-looking rotary knob with a radial-gradient body and a
// tick indicator, for the bottom-of-panel control detailing.
export function Knob({ rotation = 0 }: { rotation?: number }) {
  return (
    <View style={chromeStyles.knobOuter}>
      <LinearGradient
        colors={[colors.knobRing, colors.knobBody, colors.chassisDark]}
        start={{ x: 0.3, y: 0.2 }}
        end={{ x: 0.8, y: 1 }}
        style={chromeStyles.knobGradient}
      >
        <View
          style={[
            chromeStyles.knobIndicator,
            { transform: [{ rotate: `${rotation}deg` }] },
          ]}
        />
      </LinearGradient>
    </View>
  );
}

const chromeStyles = StyleSheet.create({
  screw: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.screwHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  screwSlot: {
    width: 5,
    height: 1,
    backgroundColor: colors.screwSlot,
  },
  screwTL: { top: 6, left: 6 },
  screwTR: { top: 6, right: 6 },
  panelOuter: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderDark,
    overflow: 'hidden',
  },
  panelGradient: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radii.md,
  },
  lcdOuter: {
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.chassisDark,
    overflow: 'hidden',
  },
  lcdGradient: {
    borderWidth: 1,
    borderColor: colors.lcdGlowDim,
    borderRadius: radii.sm,
  },
  knobOuter: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  knobGradient: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderDark,
  },
  knobIndicator: {
    width: 3,
    height: 14,
    backgroundColor: colors.amber,
    borderRadius: 1,
    marginTop: -10,
  },
});
