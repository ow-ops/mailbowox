# cpp-adapter.cpp finds the module by its JNI name, so R8 must keep it as it is. ubrn's build.gradle
# expects this file but only writes it with --native-bindings (jhugman/uniffi-bindgen-react-native#502).
-keep class eu.owops.mailbowox.core.** { *; }
