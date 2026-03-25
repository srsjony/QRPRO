import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { COLORS, BASE_URL, FONTS } from '../constants/config';

export default function LoginScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialChecking, setInitialChecking] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    try {
      const savedUser = await SecureStore.getItemAsync('username');
      const savedPass = await SecureStore.getItemAsync('password');
      const savedRemember = await SecureStore.getItemAsync('remember');

      if (savedUser && savedPass && savedRemember === 'true') {
        setUsername(savedUser);
        setPassword(savedPass);
        setRemember(true);
        performLogin(savedUser, savedPass, true);
      }
    } catch (e) {
    } finally {
      setInitialChecking(false);
    }
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Missing Fields', 'Please enter both username and password.');
      return;
    }
    performLogin(username.trim().toUpperCase(), password, remember);
  };

  const performLogin = async (user, pass, shouldRemember) => {
    setLoading(true);

    try {
      if (shouldRemember) {
        await SecureStore.setItemAsync('username', user);
        await SecureStore.setItemAsync('password', pass);
        await SecureStore.setItemAsync('remember', 'true');
      } else {
        await SecureStore.deleteItemAsync('username');
        await SecureStore.deleteItemAsync('password');
        await SecureStore.setItemAsync('remember', 'false');
      }

      navigation.replace('LoginProcess', {
        title: 'Authenticating...',
        path: '/',
        color: COLORS.ember,
        loginData: {
          username: user,
          password: pass,
          remember: shouldRemember,
          targetPath: '/dashboard',
        },
      });
    } catch (e) {
      Alert.alert('Error', 'Failed to connect. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (initialChecking) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.ember} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar style="light" />

      <Animated.View style={[styles.inner, { opacity: fadeAnim }]}>
        <View style={styles.header}>
          <Image
            source={require('../assets/icon.png')}
            style={styles.logoImg}
            resizeMode="contain"
          />
          <Text style={styles.title}>RESTROMATE</Text>
          <Text style={styles.subtitle}>Restaurant Management — Sign In</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>USERNAME</Text>
          <TextInput
            style={styles.input}
            placeholder="Restaurant username"
            placeholderTextColor={COLORS.creamMuted}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="characters"
            autoCorrect={false}
          />

          <Text style={[styles.label, { marginTop: 16 }]}>PASSWORD</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={COLORS.creamMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={handleLogin}
          />

          <TouchableOpacity 
            style={styles.rememberRow} 
            onPress={() => setRemember(!remember)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, remember && styles.checkboxActive]}>
              {remember && <Text style={styles.checkboxTick}>✓</Text>}
            </View>
            <Text style={styles.rememberText}>Remember Password</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.loginBtn,
              { backgroundColor: COLORS.ember },
              loading && styles.loginBtnDisabled,
            ]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={styles.loginBtnText}>Secure Sign In →</Text>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.accent}>
          <View style={[styles.accentDot, { backgroundColor: COLORS.ember }]} />
          <Text style={styles.accentText}>Admin Access Only</Text>
          <View style={[styles.accentDot, { backgroundColor: COLORS.ember }]} />
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  inner: { flex: 1, padding: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 36 },
  logoImg: { width: 80, height: 80, borderRadius: 20, marginBottom: 16 },
  title: { fontSize: 26, fontWeight: '800', color: COLORS.cream, letterSpacing: 1.5, fontFamily: FONTS.numeric },
  subtitle: { fontSize: 14, color: COLORS.creamMuted, marginTop: 6 },
  form: { backgroundColor: COLORS.card, borderRadius: 20, padding: 24, borderWidth: 1, borderColor: COLORS.divider },
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.5, color: COLORS.creamMuted, marginBottom: 8 },
  input: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.divider, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: COLORS.cream },
  rememberRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 10 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: COLORS.ember, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { backgroundColor: COLORS.ember },
  checkboxTick: { color: COLORS.bg, fontSize: 12, fontWeight: 'bold' },
  rememberText: { color: COLORS.creamMuted, fontSize: 14, fontWeight: '500' },
  loginBtn: { marginTop: 24, borderRadius: 12, paddingVertical: 15, alignItems: 'center' },
  loginBtnDisabled: { opacity: 0.7 },
  loginBtnText: { color: COLORS.bg, fontSize: 15, fontWeight: '800', letterSpacing: 1 },
  accent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 40 },
  accentDot: { width: 4, height: 4, borderRadius: 2 },
  accentText: { fontSize: 12, color: COLORS.creamMuted, letterSpacing: 2, fontWeight: '600' },
});
