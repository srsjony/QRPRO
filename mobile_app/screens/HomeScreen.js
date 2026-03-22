import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS, ROLES } from '../constants/config';
import RoleCard from '../components/RoleCard';

export default function HomeScreen({ navigation }) {
  const [username, setUsername] = useState('');
  const [savedUsername, setSavedUsername] = useState('');
  const [showUsernameInput, setShowUsernameInput] = useState(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(-20)).current;

  React.useEffect(() => {
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

  const handleSetUsername = () => {
    const trimmed = username.trim().toUpperCase();
    if (!trimmed) {
      Alert.alert('Required', 'Please enter your restaurant username.');
      return;
    }
    setSavedUsername(trimmed);
    setShowUsernameInput(false);
  };

  const handleRolePress = (role) => {
    if (role.requiresLogin) {
      navigation.navigate('Login', { role });
    } else {
      const path = role.pathBuilder
        ? role.pathBuilder(savedUsername)
        : role.path;
      navigation.navigate('WebView', {
        title: role.title,
        path,
        color: role.gradient[0],
      });
    }
  };

  const publicRoles = ROLES.filter((r) => !r.requiresLogin);
  const ownerRoles = ROLES.filter((r) => r.requiresLogin);

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          style={[
            styles.header,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Text style={styles.logo}>QR</Text>
          <Text style={styles.logoSub}>MENU PRO</Text>
          <Text style={styles.tagline}>
            Restaurant Management System
          </Text>
        </Animated.View>

        {/* Username Input */}
        {showUsernameInput ? (
          <Animated.View
            style={[styles.usernameSection, { opacity: fadeAnim }]}
          >
            <Text style={styles.sectionLabel}>RESTAURANT USERNAME</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder="e.g. MYRESTAURANT"
                placeholderTextColor={COLORS.creamMuted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleSetUsername}
              />
              <TouchableOpacity
                style={styles.goBtn}
                onPress={handleSetUsername}
              >
                <Text style={styles.goBtnText}>GO →</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.hint}>
              Enter the username you registered with on QR Menu Pro
            </Text>
          </Animated.View>
        ) : (
          <View style={styles.usernameBar}>
            <View style={styles.usernameBarLeft}>
              <Text style={styles.usernameBadge}>@{savedUsername}</Text>
              <TouchableOpacity
                onPress={() => setShowUsernameInput(true)}
              >
                <Text style={styles.changeBtn}>Change</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Role Cards */}
        {!showUsernameInput && (
          <>
            <Text style={styles.sectionTitle}>🍽️ Front of House</Text>
            {publicRoles.map((role, i) => (
              <RoleCard
                key={role.id}
                role={role}
                index={i}
                onPress={() => handleRolePress(role)}
              />
            ))}

            <Text style={[styles.sectionTitle, { marginTop: 28 }]}>
              🔐 Owner & Management
            </Text>
            {ownerRoles.map((role, i) => (
              <RoleCard
                key={role.id}
                role={role}
                index={i + publicRoles.length}
                onPress={() => handleRolePress(role)}
              />
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    padding: 20,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    fontSize: 48,
    fontWeight: '900',
    color: COLORS.ember,
    letterSpacing: 8,
  },
  logoSub: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.emberGlow,
    letterSpacing: 6,
    marginTop: -4,
  },
  tagline: {
    fontSize: 13,
    color: COLORS.creamMuted,
    marginTop: 8,
    letterSpacing: 0.5,
  },
  usernameSection: {
    marginBottom: 28,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.5,
    color: COLORS.creamMuted,
    marginBottom: 8,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.cream,
    letterSpacing: 1,
  },
  goBtn: {
    backgroundColor: COLORS.ember,
    borderRadius: 12,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  goBtnText: {
    color: COLORS.bg,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },
  hint: {
    fontSize: 12,
    color: COLORS.emberDim,
    marginTop: 8,
  },
  usernameBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  usernameBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  usernameBadge: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.emberGlow,
    letterSpacing: 1,
  },
  changeBtn: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.creamMuted,
    textDecorationLine: 'underline',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.cream,
    marginBottom: 14,
    marginTop: 4,
    letterSpacing: 0.5,
  },
});
