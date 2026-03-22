import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from '../constants/config';

export default function SetupScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleStart = () => {
    const trimmed = username.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter the restaurant username.');
      return;
    }
    
    // Pass to WebView
    navigation.navigate('WebView', {
      title: 'Table Ordering',
      path: `/captain/${trimmed}`,
      color: COLORS.ember,
    });
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <Animated.View
        style={[
          styles.inner,
          {
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.printerBtn}
          onPress={() => navigation.navigate('Printer')}
        >
          <Text style={styles.printerIcon}>🖨️ Connect Printer</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.icon}>🤵</Text>
          <Text style={styles.title}>QR Captain</Text>
          <Text style={styles.subtitle}>Enter restaurant ID to start taking orders</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>RESTAURANT USERNAME</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. MYRESTAURANT"
            placeholderTextColor={COLORS.creamMuted}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleStart}
          />

          <TouchableOpacity
            style={styles.goBtn}
            onPress={handleStart}
          >
            <Text style={styles.goBtnText}>Start Work →</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.accent}>
          <View style={styles.accentDot} />
          <Text style={styles.accentText}>Waitstaff Interface</Text>
          <View style={styles.accentDot} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  inner: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  printerBtn: {
    position: 'absolute',
    top: 56,
    right: 20,
    backgroundColor: COLORS.card,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.divider,
    zIndex: 10,
  },
  printerIcon: {
    color: COLORS.cream,
    fontSize: 13,
    fontWeight: '600',
  },
  header: {
    alignItems: 'center',
    marginBottom: 36,
  },
  icon: {
    fontSize: 56,
    marginBottom: 12,
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
