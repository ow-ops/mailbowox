import { onlineManager } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export const isOnline = () => onlineManager.isOnline();

export const useOnline = () => useSyncExternalStore(onlineManager.subscribe, isOnline, isOnline);

onlineManager.setEventListener((setOnline) => {
  if (Platform.OS === 'web' && typeof window === 'undefined') return;

  // Unknown counts as online until Expo reports a connection or reachability failure.
  const apply = ({ isConnected, isInternetReachable }: Network.NetworkState) =>
    setOnline(isConnected !== false && isInternetReachable !== false);

  let awaitingInitial = true;
  const subscription = Network.addNetworkStateListener((state) => {
    awaitingInitial = false;
    apply(state);
  });
  void Network.getNetworkStateAsync().then((state) => {
    if (awaitingInitial) apply(state);
  }).catch(() => {});
  return () => {
    awaitingInitial = false;
    subscription.remove();
  };
});
