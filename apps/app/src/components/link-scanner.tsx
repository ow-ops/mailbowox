import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { decodeSharePart, type SharePart } from '@/accounts/share';
import { Button } from '@/components/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { decodeOffer, type LinkOffer } from '@/vault/crypto';
import { validGateway } from '@/vault/form';

type Props = {
  hint: string;
  onOffer: (offer: LinkOffer) => void;
  onShare?: (part: SharePart) => void;
};

export function LinkScanner({ hint, onOffer, onShare }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [foreign, setForeign] = useState(false);
  // The scanner keeps reporting the same code until the camera unmounts.
  const found = useRef(false);

  const scanned = ({ data }: BarcodeScanningResult) => {
    if (found.current) return;
    const part = onShare && decodeSharePart(data);
    if (part) {
      setForeign(false);
      return onShare(part);
    }
    const offer = decodeOffer(data);
    // The code names the gateway the vault key comes from: anything but a web address is not an offer.
    const decoded = offer && validGateway(offer.gateway) ? offer : null;
    setForeign(!decoded);
    if (!decoded) return;
    found.current = true;
    onOffer(decoded);
  };

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View style={styles.group}>
        <ThemedText>{t('settings.devices.join.cameraNeeded')}</ThemedText>
        {permission.canAskAgain ? (
          <Button label={t('settings.devices.join.allowCamera')} onPress={requestPermission} />
        ) : (
          <ThemedText type="meta">{t('settings.devices.join.cameraBlocked')}</ThemedText>
        )}
      </View>
    );
  }

  return (
    <View style={styles.group}>
      <CameraView
        style={[styles.camera, { backgroundColor: theme.surface }]}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned}
      />
      <ThemedText type="meta" themeColor={foreign ? 'danger' : undefined} accessibilityLiveRegion="polite">
        {foreign ? t('settings.devices.join.foreignCode') : hint}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: Spacing.three,
  },
  camera: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
});
