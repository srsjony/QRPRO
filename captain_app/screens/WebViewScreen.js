import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  BackHandler,
  Platform,
  Alert,
  Animated,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, BASE_URL } from '../constants/config';

export default function WebViewScreen({ route, navigation }) {
  const { title, path, color = COLORS.ember, loginData } = route.params;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef(null);
  const loadAnim = useRef(new Animated.Value(0)).current;

  const url = loginData ? `${BASE_URL}/` : `${BASE_URL}${path}`;

  // ✅ Fixed BackHandler API — using .remove() (React Native 0.65+)
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (canGoBack && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      });

      return () => subscription.remove();
    }, [canGoBack])
  );

  // Animate progress bar while loading
  useEffect(() => {
    if (loading) {
      loadAnim.setValue(0);
      Animated.loop(
        Animated.timing(loadAnim, { toValue: 1, duration: 1500, useNativeDriver: true })
      ).start();
    } else {
      loadAnim.stopAnimation();
    }
  }, [loading]);

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

  // Inject CSS to hide nav + apply tabular-nums to numbers
  const injectedJS = `
    (function() {
      try {
        if (!document.getElementById('__captain_injected')) {
          var s = document.createElement('style');
          s.id = '__captain_injected';
          s.innerHTML = '.nav, nav, .navbar, header.site-header { display: none !important; } body { padding-top: 0 !important; margin-top: 0 !important; } * { -webkit-tap-highlight-color: transparent; }'
            + ' .price, .total, .amount, [class*="price"], [class*="total"], [class*="amount"] { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }';
          document.head.appendChild(s);
        }

        var meta = document.querySelector('meta[name="viewport"]');
        if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

        ${loginScript}
      } catch(e) {}
    })();
    true;
  `;

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

  const handleLoadEnd = () => {
    setLoading(false);
    setRefreshing(false);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    webViewRef.current?.reload();
  };

  const handleMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'PRINT_RECEIPT') {
        // Bluetooth printing handled here if printer is connected
        Alert.alert('Print', 'Bluetooth print received — ensure printer is connected via Setup.');
      }
    } catch (e) {
      console.warn('Message parsing error:', e);
    }
  };

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.errorWrap}>
          <Text style={styles.errorIcon}>📡</Text>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorText}>
            Unable to reach the server. Check your internet connection and try again.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: color }]}
            onPress={() => {
              setError(false);
              setLoading(true);
              webViewRef.current?.reload();
            }}
          >
            <Text style={styles.retryText}>↻  Retry</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.backBtnError} onPress={() => navigation.goBack()}>
            <Text style={styles.backBtnErrorText}>← Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      {/* ── Header ─────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Text style={styles.headerBack}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerMid}>
          <View style={[styles.headerDot, { backgroundColor: color }]} />
          <Text style={[styles.headerTitle, { color }]}>{title || 'Captain'}</Text>
        </View>

        <TouchableOpacity
          onPress={handleRefresh}
          style={styles.headerBtn}
          disabled={refreshing || loading}
        >
          <Text style={[styles.headerRefresh, { color: refreshing ? color : COLORS.creamMuted }]}>
            ↻
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ──── */}
      {loading && (
        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressBar,
              { backgroundColor: color },
              {
                transform: [{
                  translateX: loadAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-300, 400],
                  }),
                }],
              },
            ]}
          />
        </View>
      )}

      {/* ── WebView ─────────────────────────────── */}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={handleLoadEnd}
        onError={() => { setLoading(false); setError(true); }}
        onHttpError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          if (nativeEvent.statusCode >= 500) { setLoading(false); setError(true); }
        }}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleMessage}
        injectedJavaScript={injectedJS}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        cacheEnabled={true}
        pullToRefreshEnabled={true}
        setSupportMultipleWindows={false}
        overScrollMode="never"
        renderToHardwareTextureAndroid
      />

      {/* ── Loading overlay ─────────────── */}
      {loading && !refreshing && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={color} />
          <Text style={styles.loadingText}>{title || 'Loading'}…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  headerBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerBack: {
    fontSize: 26,
    color: COLORS.cream,
    fontWeight: '300',
    lineHeight: 30,
  },
  headerRefresh: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerMid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    justifyContent: 'center',
  },
  headerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  progressTrack: {
    height: 2,
    backgroundColor: COLORS.surface,
    overflow: 'hidden',
  },
  progressBar: {
    height: 2,
    width: 120,
    borderRadius: 1,
    opacity: 0.9,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    top: 52,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 5,
  },
  loadingText: {
    color: COLORS.creamMuted,
    fontSize: 13,
    fontWeight: '600',
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
    paddingVertical: 13,
    borderRadius: 14,
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
