import React, { useState } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { colors } from './src/theme';
import CallSignScreen from './src/screens/CallSignScreen';
import RadioScreen from './src/screens/RadioScreen';

export default function App() {
  const [callSign, setCallSign] = useState<string | null>(null);

  if (!callSign) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={colors.chassisDark} />
        <CallSignScreen onSetCallSign={setCallSign} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.chassisDark} />
      <RadioScreen callSign={callSign} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.chassisDark,
  },
});
