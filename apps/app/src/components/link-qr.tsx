import { StyleSheet, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { encodeOffer, type LinkOffer } from '@/vault/crypto';

const QR_SIZE = 240;

export function LinkQr({ offer, label }: { offer: LinkOffer; label: string }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[styles.code, { backgroundColor: Colors.light.page }]}>
      <QRCode
        value={encodeOffer(offer)}
        size={QR_SIZE}
        color={Colors.light.heading}
        backgroundColor={Colors.light.page}
        ecl="M"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  code: {
    alignSelf: 'center',
    padding: Spacing.three,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
});
