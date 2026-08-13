import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

/**
 * AdSlot - A placeholder for future monetization.
 * Designed to reserve space without consuming data/power.
 */
export const AdSlot = ({ size = 'banner' }) => {
  return (
    <View style={[styles.slot, size === 'interstitial' ? styles.full : styles.banner]}>
      <Text style={styles.text}>ADVERTISEMENT</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  slot: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
  },
  banner: {
    width: '100%',
    height: 50,
    marginVertical: spacing.sm,
  },
  full: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.8)',
    zIndex: 1000,
  },
  text: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: colors.textDim,
    letterSpacing: 2,
  },
});
