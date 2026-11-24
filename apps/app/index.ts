// Push tasks must be defined before the app mounts, so they also run when a push starts it in the background.
import './src/push/background';
import './src/push/poll';
import 'expo-router/entry';
