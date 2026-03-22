import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  BackHandler,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, BASE_URL } from '../constants/config';

export default function WebViewScreen({ navigation, route }) {
  const { title, path, color, loginData } = route.params;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef(null);

  const url = loginData ? `${BASE_URL}/` : `${BASE_URL}${path}`;

  // Handle Android back button
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      };

      if (Platform.OS === 'android') {
        BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () =>
          BackHandler.removeEventListener('hardwareBackPress', onBackPress);
      }
    }, [canGoBack])
  );

  // JS to auto-fill login form and submit
  const loginScript = loginData
    ? `
    (function() {
      try {
        const form = document.querySelector('form');
        if (form) {
          const usernameInput = form.querySelector('input[name="username"]');
          const passwordInput = form.querySelector('input[name="password"]');
          if (usernameInput && passwordInput) {
            usernameInput.value = "${loginData.username}";
            passwordInput.value = "${loginData.password}";
            form.submit();
          }
        }
      } catch(e) {}
    })();
    true;
  `
    : '';

  const handleNavigationStateChange = (navState) => {
    setCanGoBack(navState.canGoBack);

    // After login, if we land on /dashboard, redirect to target
    if (
      loginData &&
      navState.url.includes('/dashboard') &&
      loginData.targetPath !== '/dashboard'
    ) {
      webViewRef.current?.injectJavaScript(
        `window.location.href = "${loginData.targetPath}"; true;`
      );
    }
  };

  if (error) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.errorWrap}>
          <Text style={styles.errorIcon}>📡</Text>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorText}>
            Unable to reach the server. Check your internet connection and try
            again.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: color || COLORS.ember }]}
            onPress={() => {
              setError(false);
              setLoading(true);
              webViewRef.current?.reload();
            }}
          >
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.backBtnError}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.backBtnErrorText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Top Bar */}
      <View style={[styles.topBar, { borderBottomColor: color + '40' }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Home</Text>
        </TouchableOpacity>
        <Text style={[styles.topTitle, { color: color || COLORS.ember }]}>
          {title}
        </Text>
        <TouchableOpacity
          onPress={() => webViewRef.current?.reload()}
        >
          <Text style={styles.reloadText}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* WebView */}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => setError(true)}
        onHttpError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          if (nativeEvent.statusCode >= 500) setError(true);
        }}
        onNavigationStateChange={handleNavigationStateChange}
        injectedJavaScript={loginScript}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={false}
        allowsBackForwardNavigationGestures={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        cacheEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        setSupportMultipleWindows={false}
      />

      {/* Loading Overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={color || COLORS.ember} />
          <Text style={styles.loadingText}>Loading {title}...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 54 : 38,
    paddingBottom: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
  },
  backText: {
    color: COLORS.creamMuted,
    fontSize: 14,
    fontWeight: '500',
  },
  topTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  reloadText: {
    color: COLORS.creamMuted,
    fontSize: 22,
  },
  webview: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 80,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: COLORS.creamMuted,
    fontSize: 14,
    marginTop: 14,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorIcon: {
    fontSize: 56,
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.cream,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 14,
    color: COLORS.creamMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 28,
  },
  retryBtn: {
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 14,
  },
  retryText: {
    color: COLORS.bg,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  backBtnError: {
    padding: 10,
  },
  backBtnErrorText: {
    color: COLORS.creamMuted,
    fontSize: 14,
    fontWeight: '500',
  },
});
