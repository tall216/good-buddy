import React, { useState } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { colors } from './src/theme';
import CallSignScreen from './src/screens/CallSignScreen';
import RadioScreen from './src/screens/RadioScreen';

// Real bug fix: Android's system nav bar (the gray 3-button/gesture
// bar) was covering the bottom controls (ON AIR / ALERTS toggles,
// knobs) -- newer Android versions render edge-to-edge by default and
// this app had zero safe-area handling anywhere, so content laid out
// straight to the physical screen edge, right under the OS bar.
// SafeAreaProvider at the root is required for useSafeAreaInsets() to
// work anywhere below it (RadioScreen consumes it directly).
export default function App() {
  const [callSign, setCallSign] = useState<string | null>(null);

  if (!callSign) {
    return (
      <SafeAreaProvider>
        <View style={styles.root}>
          <StatusBar barStyle="light-content" backgroundColor={colors.chassisDark} />
          <CallSignScreen onSetCallSign={setCallSign} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={colors.chassisDark} />
        <RadioScreen callSign={callSign} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.chassisDark,
  },
});
