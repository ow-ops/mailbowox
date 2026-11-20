// Push tasks must be defined before the app mounts, so they also run when a push starts it in the background.
import './src/push/background';
import 'expo-router/entry';
