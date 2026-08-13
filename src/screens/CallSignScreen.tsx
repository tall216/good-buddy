import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { colors, spacing, fonts } from '../theme';

const FUN_CALL_SIGNS = [
  'Rubber Duck',
  'Bandit',
  'Snowman',
  'Big Bear',
  'Lil\' Hustler',
  'Night Rider',
  'Diesel',
  'Maverick',
  'Outlaw',
  'Road Dog',
  'Hammer Down',
  'Lone Wolf',
  'Silver Fox',
  'Midnight',
  'Breaker',
];

interface Props {
  onSetCallSign: (sign: string) => void;
}

export default function CallSignScreen({ onSetCallSign }: Props) {
  const [input, setInput] = useState('');

  const randomSign = () => {
    const sign = FUN_CALL_SIGNS[Math.floor(Math.random() * FUN_CALL_SIGNS.length)];
    setInput(sign);
  };

  const handleSubmit = () => {
    const trimmed = input.trim();
    if (trimmed.length >= 2) {
      onSetCallSign(trimmed);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Speaker grille decoration */}
      <View style={styles.grille}>
        {Array.from({ length: 6 }).map((_, i) => (
          <View key={i} style={styles.grilleRow}>
            {Array.from({ length: 8 }).map((_, j) => (
              <View key={j} style={styles.grilleSlot} />
            ))}
          </View>
        ))}
      </View>

      {/* Title */}
      <Text style={styles.title}>GOOD BUDDY</Text>
      <Text style={styles.subtitle}>CB RADIO</Text>

      {/* Frequency display */}
      <View style={styles.freqDisplay}>
        <Text style={styles.freqText}>CH 19</Text>
        <Text style={styles.freqSmall}>27.185 MHz</Text>
      </View>

      {/* Call sign input */}
      <View style={styles.inputSection}>
        <Text style={styles.label}>YOUR HANDLE</Text>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Enter call sign..."
          placeholderTextColor={colors.textDim}
          maxLength={20}
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={handleSubmit}
        />
        <TouchableOpacity style={styles.diceButton} onPress={randomSign}>
          <Text style={styles.diceText}>🎲 RANDOM</Text>
        </TouchableOpacity>
      </View>

      {/* Key up button */}
      <TouchableOpacity
        style={[styles.keyUpButton, input.trim().length < 2 && styles.keyUpDisabled]}
        onPress={handleSubmit}
        disabled={input.trim().length < 2}
      >
        <Text style={styles.keyUpText}>KEY UP</Text>
        <Text style={styles.keyUpSub}>Hit the airwaves</Text>
      </TouchableOpacity>

      {/* Bottom decoration */}
      <View style={styles.bottomBar}>
        <View style={styles.knobRow}>
          <View style={styles.knob}>
            <View style={styles.knobIndicator} />
          </View>
          <View style={styles.knob}>
            <View style={styles.knobIndicator} />
          </View>
          <View style={styles.knob}>
            <View style={styles.knobIndicator} />
          </View>
        </View>
        <Text style={styles.bottomText}>PUSH TO TALK • ADJUSTABLE RANGE</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
  },
  grille: {
    width: '80%',
    backgroundColor: colors.grille,
    borderRadius: 4,
    padding: spacing.sm,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  grilleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  grilleSlot: {
    width: 20,
    height: 4,
    backgroundColor: colors.bg,
    borderRadius: 1,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 36,
    fontWeight: '900',
    color: colors.amber,
    letterSpacing: 6,
    textTransform: 'uppercase',
  },
  subtitle: {
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.green,
    letterSpacing: 8,
    marginBottom: spacing.lg,
  },
  freqDisplay: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 4,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.xl,
    width: '60%',
  },
  freqText: {
    fontFamily: fonts.display,
    fontSize: 28,
    color: colors.green,
    letterSpacing: 4,
  },
  freqSmall: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.greenDim,
    letterSpacing: 2,
  },
  inputSection: {
    width: '100%',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.amber,
    letterSpacing: 4,
    marginBottom: spacing.sm,
  },
  input: {
    width: '100%',
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.amber,
    borderRadius: 4,
    padding: spacing.md,
    color: colors.amber,
    fontFamily: fonts.display,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: 2,
  },
  diceButton: {
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.greenDim,
    borderRadius: 4,
  },
  diceText: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.green,
    letterSpacing: 2,
  },
  keyUpButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.red,
    borderWidth: 4,
    borderColor: '#881100',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    // shadow for depth
    elevation: 8,
    shadowColor: colors.red,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  keyUpDisabled: {
    backgroundColor: colors.redDim,
    borderColor: '#330800',
    elevation: 2,
    shadowOpacity: 0.1,
  },
  keyUpText: {
    fontFamily: fonts.display,
    fontSize: 22,
    fontWeight: '900',
    color: colors.white,
    letterSpacing: 4,
  },
  keyUpSub: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.white,
    opacity: 0.7,
    marginTop: spacing.xs,
  },
  bottomBar: {
    alignItems: 'center',
    marginTop: 'auto',
    marginBottom: spacing.lg,
  },
  knobRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.md,
  },
  knob: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.knob,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobIndicator: {
    width: 3,
    height: 10,
    backgroundColor: colors.amber,
    borderRadius: 1,
  },
  bottomText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textDim,
    letterSpacing: 3,
  },
});
