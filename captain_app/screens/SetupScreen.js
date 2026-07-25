import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, STORAGE_KEYS } from '../constants/config';
import usePrinter from '../hooks/usePrinter';
import * as Printer from '../services/printer';

const RESUME_DELAY = 1400;
const USERNAME_PATTERN = /^[A-Z0-9_-]{2,40}$/;

export default function SetupScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState(null);
  const [resuming, setResuming] = useState(false);
  const [savedPrinter, setSavedPrinter] = useState(null);
  const printer = usePrinter();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-20)).current;
  const resumeTimer = useRef(null);
  const resumeConsumed = useRef(false);

  const openCaptain = useCallback(
    (name) => {
      navigation.navigate('WebView', {
        title: 'Table Ordering',
        path: `/captain/${name}`,
        color: COLORS.ember,
      });
    },
    [navigation]
  );

  const cancelResume = useCallback(() => {
    if (resumeTimer.current) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
    setResuming(false);
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    let cancelled = false;

    (async () => {
      // Bring the printer back before the shift starts, so the first bill prints.
      Printer.getSavedPrinter().then((p) => !cancelled && setSavedPrinter(p));
      Printer.restore();

      try {
        const saved = await SecureStore.getItemAsync(STORAGE_KEYS.username);
        if (cancelled || !saved) return;

        setUsername(saved);
        setSavedUsername(saved);

        // Resume the last restaurant automatically, but leave an escape hatch
        // instead of navigating away with no warning.
        if (!resumeConsumed.current) {
          resumeConsumed.current = true;
          setResuming(true);
          resumeTimer.current = setTimeout(() => {
            resumeTimer.current = null;
            setResuming(false);
            openCaptain(saved);
          }, RESUME_DELAY);
        }
      } catch (e) {
        // A missing keystore entry is not worth interrupting the user over.
      }
    })();

    return () => {
      cancelled = true;
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [fadeAnim, slideAnim, openCaptain]);

  const handleStart = async () => {
    cancelResume();
    const trimmed = username.trim().toUpperCase();

    if (!trimmed) {
      Alert.alert('Required', 'Please enter the restaurant username.');
      return;
    }
    if (!USERNAME_PATTERN.test(trimmed)) {
      Alert.alert(
        'Check the username',
        'Use 2–40 characters: letters, numbers, hyphen or underscore. No spaces.'
      );
      return;
    }

    try {
      await SecureStore.setItemAsync(STORAGE_KEYS.username, trimmed);
      setSavedUsername(trimmed);
    } catch (e) {
      // Not fatal — the session still works, it just will not be remembered.
    }

    openCaptain(trimmed);
  };

  const handleForgetRestaurant = () => {
    cancelResume();
    Alert.alert('Switch restaurant', 'Clear the saved restaurant username?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          try {
            await SecureStore.deleteItemAsync(STORAGE_KEYS.username);
          } catch (e) {}
          setSavedUsername(null);
          setUsername('');
        },
      },
    ]);
  };

  const printerLabel = printer.connected
    ? printer.device?.device_name || 'Printer ready'
    : savedPrinter
    ? `Reconnect ${savedPrinter.device_name}`
    : 'Connect Printer';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.printerBtn}
          onPress={() => {
            cancelResume();
            navigation.navigate('Printer');
          }}
          accessibilityRole="button"
          accessibilityLabel={printerLabel}
        >
          <View
            style={[
              styles.printerDot,
              { backgroundColor: printer.connected ? COLORS.success : COLORS.creamMuted },
            ]}
          />
          <Text style={styles.printerText} numberOfLines={1}>
            🖨️ {printerLabel}
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            style={[styles.inner, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
          >
            <View style={styles.header}>
              <Image
                source={require('../assets/icon.png')}
                style={styles.logoImg}
                resizeMode="contain"
              />
              <Text style={styles.title}>RESTROMATE</Text>
              <Text style={styles.subtitle}>Captain — Table Ordering</Text>
            </View>

            <View style={styles.form}>
              <Text style={styles.label}>RESTAURANT USERNAME</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. MYRESTAURANT"
                placeholderTextColor={COLORS.creamMuted}
                value={username}
                onChangeText={(text) => {
                  cancelResume();
                  setUsername(text);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                returnKeyType="go"
                onSubmitEditing={handleStart}
                accessibilityLabel="Restaurant username"
              />

              <TouchableOpacity
                style={styles.goBtn}
                onPress={handleStart}
                accessibilityRole="button"
                accessibilityLabel="Start work"
              >
                <Text style={styles.goBtnText}>Start Work →</Text>
              </TouchableOpacity>

              {resuming && (
                <TouchableOpacity
                  style={styles.resumeRow}
                  onPress={cancelResume}
                  accessibilityRole="button"
                  accessibilityLabel="Stay on this screen"
                >
                  <Text style={styles.resumeText}>
                    Resuming {savedUsername}… tap to stay here
                  </Text>
                </TouchableOpacity>
              )}

              {savedUsername && !resuming && (
                <TouchableOpacity
                  style={styles.switchRow}
                  onPress={handleForgetRestaurant}
                  accessibilityRole="button"
                  accessibilityLabel="Switch restaurant"
                >
                  <Text style={styles.switchText}>Switch restaurant</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.accent}>
              <View style={styles.accentDot} />
              <Text style={styles.accentText}>Waitstaff Interface</Text>
              <View style={styles.accentDot} />
            </View>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  printerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '75%',
    backgroundColor: COLORS.card,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  printerDot: { width: 7, height: 7, borderRadius: 4 },
  printerText: {
    color: COLORS.cream,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  inner: {
    padding: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 36,
  },
  logoImg: {
    width: 72,
    height: 72,
    borderRadius: 18,
    marginBottom: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: COLORS.cream,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.creamMuted,
    marginTop: 6,
  },
  form: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: COLORS.creamMuted,
    marginBottom: 8,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: COLORS.cream,
  },
  goBtn: {
    backgroundColor: COLORS.ember,
    marginTop: 24,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  goBtnText: {
    color: COLORS.bg,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  resumeRow: { marginTop: 16, alignItems: 'center', padding: 6 },
  resumeText: { color: COLORS.pending, fontSize: 13, fontWeight: '600' },
  switchRow: { marginTop: 16, alignItems: 'center', padding: 6 },
  switchText: { color: COLORS.creamMuted, fontSize: 13, fontWeight: '600' },
  accent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 40,
  },
  accentDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.ember,
  },
  accentText: {
    fontSize: 12,
    color: COLORS.creamMuted,
    letterSpacing: 2,
    fontWeight: '600',
  },
});
