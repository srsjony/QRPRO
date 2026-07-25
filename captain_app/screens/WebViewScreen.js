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
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, BASE_URL } from '../constants/config';
import usePrinter from '../hooks/usePrinter';
import * as Printer from '../services/printer';

/** Safely embed a JS string literal into injected script. */
const jsString = (value) => JSON.stringify(String(value ?? ''));

export default function WebViewScreen({ route, navigation }) {
  const { title, path, color = COLORS.ember, loginData } = route.params;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null); // null | { title, message }
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef(null);
  const loadAnim = useRef(new Animated.Value(0)).current;
  const pendingJob = useRef(null); // last print payload that failed for lack of a printer
  const printer = usePrinter();

  const url = loginData ? `${BASE_URL}/` : `${BASE_URL}${path}`;

  /* ── Hardware back → WebView history ─────────────────────── */
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

  /* ── Reconnect the saved printer in the background ────────── */
  useEffect(() => {
    Printer.restore();
  }, []);

  /* ── Loading progress bar ────────────────────────────────── */
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

  /* ── Injected page script ────────────────────────────────── */
  // Credentials are embedded as JSON string literals so quotes in a password
  // cannot break out of the script.
  const loginScript = loginData
    ? `
    (function() {
      try {
        var form = document.querySelector('form');
        if (!form) return;
        var u = form.querySelector('input[name="username"]');
        var p = form.querySelector('input[name="password"]');
        if (u && p) {
          u.value = ${jsString(loginData.username)};
          p.value = ${jsString(loginData.password)};
          form.submit();
        }
      } catch(e) {}
    })();
  `
    : '';

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

        // Let the page know a real thermal printer is reachable through the app.
        window.__CAPTAIN_APP__ = true;
        window.__CAPTAIN_PRINTER_READY__ = ${printer.connected ? 'true' : 'false'};

        ${loginScript}
      } catch(e) {}
    })();
    true;
  `;

  /* ── Feedback back into the page ─────────────────────────── */
  const toastInPage = (msg, isError = false) => {
    webViewRef.current?.injectJavaScript(`
      (function(){
        try {
          if (typeof showToast === 'function') showToast(${jsString(msg)}, ${isError ? 'true' : 'false'});
        } catch(e) {}
      })(); true;
    `);
  };

  /* ── Printing ────────────────────────────────────────────── */
  const sendToPrinter = async (data, label) => {
    if (!Printer.isPrinterSupported()) {
      Alert.alert(
        'Printing unavailable',
        'Bluetooth printing needs the installed app build. Expo Go cannot reach the printer.'
      );
      return;
    }

    // One quiet attempt to bring back the saved printer before nagging the user.
    if (!Printer.getState().connected) await Printer.restore();

    if (!Printer.getState().connected) {
      pendingJob.current = { data, label };
      Alert.alert('No printer connected', `Connect a Bluetooth printer to print ${label}.`, [
        { text: 'Cancel', style: 'cancel', onPress: () => { pendingJob.current = null; } },
        {
          text: 'Connect printer',
          onPress: () => navigation.navigate('Printer', { pendingJobLabel: label }),
        },
      ]);
      return;
    }

    try {
      if (data.raw_bytes_base64) {
        await Printer.printBase64(data.raw_bytes_base64);
      } else if (data.bill_text) {
        await Printer.printText(data.bill_text);
      } else {
        throw new Error('The page sent no receipt data.');
      }
      toastInPage(`${label} printed`);
    } catch (e) {
      Alert.alert('Print failed', e?.message || 'Could not reach the printer.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Retry', onPress: () => sendToPrinter(data, label) },
        {
          text: 'Printer setup',
          onPress: () => navigation.navigate('Printer', { pendingJobLabel: label }),
        },
      ]);
      toastInPage('Print failed', true);
    }
  };

  /* ── Offer to finish a print job after connecting ─────────── */
  useFocusEffect(
    useCallback(() => {
      const job = pendingJob.current;
      if (!job || !Printer.getState().connected) return;
      pendingJob.current = null;

      Alert.alert('Printer ready', `Print ${job.label} now?`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Print', onPress: () => sendToPrinter(job.data, job.label) },
      ]);
    }, [])
  );

  const handleMessage = async (event) => {
    let data;
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch (e) {
      return; // Not a message meant for us.
    }

    switch (data.type) {
      case 'PRINT_BILL':
      case 'PRINT_RECEIPT':
        await sendToPrinter(data, `bill for Table ${data.table ?? '—'}`);
        break;

      case 'PRINT_KOT':
        await sendToPrinter(data, `KOT for Table ${data.table ?? '—'}`);
        break;

      case 'CONNECT_BLUETOOTH':
      case 'CONNECT_SERIAL':
        navigation.navigate('Printer');
        break;

      case 'OPEN_URL':
        if (data.url) Linking.openURL(data.url).catch(() => {});
        break;

      case 'NATIVE_ALERT':
      case 'NATIVE_CONFIRM':
        Alert.alert('RestroMate', String(data.message || data.text || ''));
        break;

      default:
        break;
    }
  };

  /* ── Navigation handling ─────────────────────────────────── */
  const handleNavigationStateChange = (navState) => {
    setCanGoBack(navState.canGoBack);

    // After an auto-login we land on /dashboard; bounce to the requested page.
    if (loginData && navState.url.includes('/dashboard') && loginData.targetPath !== '/dashboard') {
      webViewRef.current?.injectJavaScript(
        `window.location.href = ${jsString(loginData.targetPath)}; true;`
      );
    }
  };

  // Keep WhatsApp / tel / mail and any off-site link out of the WebView.
  const handleShouldStartLoad = (request) => {
    const target = request.url || '';
    if (/^(tel:|mailto:|whatsapp:|intent:|sms:)/i.test(target)) {
      Linking.openURL(target).catch(() => {});
      return false;
    }
    if (/^https?:/i.test(target) && !target.startsWith(BASE_URL)) {
      Linking.openURL(target).catch(() => {});
      return false;
    }
    return true;
  };

  const handleLoadEnd = () => {
    setLoading(false);
    setRefreshing(false);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    webViewRef.current?.reload();
  };

  const retry = () => {
    setError(null);
    setLoading(true);
    webViewRef.current?.reload();
  };

  /* ── Error screen ────────────────────────────────────────── */
  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.errorWrap}>
          <Text style={styles.errorIcon}>📡</Text>
          <Text style={styles.errorTitle}>{error.title}</Text>
          <Text style={styles.errorText}>{error.message}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: color }]} onPress={retry}>
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
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.headerBack}>‹</Text>
        </TouchableOpacity>

        <View style={styles.headerMid}>
          <View style={[styles.headerDot, { backgroundColor: color }]} />
          <Text style={[styles.headerTitle, { color }]}>{title || 'Captain'}</Text>
        </View>

        <TouchableOpacity
          onPress={() => navigation.navigate('Printer')}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel={printer.connected ? 'Printer connected' : 'Printer not connected'}
        >
          <Text style={styles.headerPrinter}>🖨️</Text>
          <View
            style={[
              styles.printerBadge,
              { backgroundColor: printer.connected ? COLORS.success : COLORS.danger },
            ]}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleRefresh}
          style={styles.headerBtn}
          disabled={refreshing || loading}
          accessibilityRole="button"
          accessibilityLabel="Reload page"
        >
          <Text
            style={[styles.headerRefresh, { color: refreshing ? color : COLORS.creamMuted }]}
          >
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
                transform: [
                  {
                    translateX: loadAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-300, 400],
                    }),
                  },
                ],
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
        onError={() => {
          setLoading(false);
          setError({
            title: 'Connection failed',
            message: 'Unable to reach the server. Check your internet connection and try again.',
          });
        }}
        onHttpError={({ nativeEvent }) => {
          // Only the main document matters; sub-resource 404s are noise.
          if (nativeEvent.url !== url) return;
          const code = nativeEvent.statusCode;
          if (code === 404) {
            setError({
              title: 'Page not found',
              message:
                'That restaurant username does not exist on the server. Go back and check the spelling.',
            });
          } else if (code >= 500) {
            setError({
              title: 'Server error',
              message: `The server responded with ${code}. Try again in a moment.`,
            });
          } else {
            return;
          }
          setLoading(false);
        }}
        onNavigationStateChange={handleNavigationStateChange}
        onShouldStartLoadWithRequest={handleShouldStartLoad}
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
  headerPrinter: {
    fontSize: 16,
  },
  printerBadge: {
    position: 'absolute',
    top: 5,
    right: 3,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: COLORS.surface,
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
