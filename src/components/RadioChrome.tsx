// Shared radio-chassis UI primitives. Built once, reused across both
// screens so the whole app reads as one consistent physical device
// instead of two independently-styled screens.
//
// Real fix: originally built against expo-linear-gradient, but the
// installed dev-client APK on the real test device has no
// ExpoLinearGradient native module linked in (confirmed via a real
// on-device crash log: "Can't find ViewManager
// 'ViewManagerAdapter_ExpoLinearGradient'... existing names are: [...]" --
// expo-linear-gradient was added to package.json but the dev-client
// binary was never rebuilt with it, and the user explicitly asked to be
// sparing with EAS build credits rather than trigger a new native build
// for this). The SAME crash log's ViewManagerRegistry dump confirmed
// react-native-svg (RNSVGLinearGradient etc.) IS already linked into the
// current build, so gradients are rebuilt here on top of that instead --
// a real, verified-available alternative rather than a guess, and no new
// native build required.
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Stop, Rect } from 'react-native-svg';
import { colors, radii } from '../theme';

// Fills its parent with a top-to-bottom (or custom-angled) two/three-stop
// gradient, rendered behind `children`. Uses objectBoundingBox gradient
// units (react-native-svg's default) so percentage-based x1/y1/x2/y2
// coordinates scale to the actual rendered size automatically -- no
// onLayout/measuring needed, unlike a manually-sized SVG.
function GradientFill({
  stops,
  x1 = '0%',
  y1 = '0%',
  x2 = '0%',
  y2 = '100%',
  children,
  style,
}: {
  stops: { offset: string; color: string }[];
  x1?: string;
  y1?: string;
  x2?: string;
  y2?: string;
  children?: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  // Each instance needs its own gradient id -- reusing one id across
  // multiple mounted gradients on the same screen would make later ones
  // silently paint with an earlier instance's stops (SVG ids are a flat
  // global namespace within the view tree).
  const gradientId = React.useId();
  return (
    <View style={style}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <SvgLinearGradient id={gradientId} x1={x1} y1={y1} x2={x2} y2={y2}>
            {stops.map((s) => (
              <Stop key={s.offset} offset={s.offset} stopColor={s.color} />
            ))}
          </SvgLinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${gradientId})`} />
      </Svg>
      {children}
    </View>
  );
}

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
      <GradientFill
        stops={inset
          ? [{ offset: '0%', color: colors.panelInset }, { offset: '100%', color: colors.panel }]
          : [{ offset: '0%', color: colors.panelLight }, { offset: '100%', color: colors.panel }]}
        style={chromeStyles.panelGradient}
      >
        {children}
      </GradientFill>
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
      <GradientFill
        stops={[{ offset: '0%', color: colors.lcdBg }, { offset: '100%', color: '#050a08' }]}
        style={chromeStyles.lcdGradient}
      >
        {children}
      </GradientFill>
    </View>
  );
}

// A physical-looking rotary knob with a radial-gradient-esque diagonal
// body gradient and a tick indicator, for the bottom-of-panel control
// detailing.
export function Knob({ rotation = 0 }: { rotation?: number }) {
  return (
    <View style={chromeStyles.knobOuter}>
      <GradientFill
        stops={[
          { offset: '0%', color: colors.knobRing },
          { offset: '50%', color: colors.knobBody },
          { offset: '100%', color: colors.chassisDark },
        ]}
        x1="20%"
        y1="10%"
        x2="90%"
        y2="100%"
        style={chromeStyles.knobGradient}
      >
        <View
          style={[
            chromeStyles.knobIndicator,
            { transform: [{ rotate: `${rotation}deg` }] },
          ]}
        />
      </GradientFill>
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
    overflow: 'hidden',
  },
  knobIndicator: {
    width: 3,
    height: 14,
    backgroundColor: colors.amber,
    borderRadius: 1,
    marginTop: -10,
  },
});
