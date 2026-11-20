import * as Haptics from 'expo-haptics';

export function thresholdHaptic() {
  const played =
    process.env.EXPO_OS === 'android'
      ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Segment_Tick)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  // A missing haptic engine changes nothing for the user.
  played.catch(() => {});
}
