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
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { COLORS, BASE_URL } from '../constants/config';

export default function WebViewScreen({ navigation, route }) {
  const { title, path, color = COLORS.ember, loginData, isMainTab = false } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const webViewRef = useRef(null);
  const loadAnim = useRef(new Animated.Value(0)).current;

  const url = loginData ? `${BASE_URL}/` : `${BASE_URL}${path}`;

  // ✅ NEW: Fixed BackHandler API (React Native 0.65+ uses .remove())
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

  // ── EARLY INJECTION (runs BEFORE page scripts load) ──────────────────
  // This is critical: page scripts bind confirm() in onclick handlers,
  // so we MUST override confirm/alert before they execute.
  const injectedJSBeforeLoad = `
    (function() {
      // Override alert — native dialog without URL header
      window.__origAlert = window.alert;
      window.alert = function(msg) {
        try {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'NATIVE_ALERT', message: String(msg || '')
          }));
        } catch(e) { window.__origAlert(msg); }
      };

      // Override confirm — custom Yes/No HTML overlay (no URL shown)
      window.__confirmBypass = false;
      window.__origConfirm = window.confirm;
      window.confirm = function(msg) {
        if (window.__confirmBypass) {
          window.__confirmBypass = false;
          return true;
        }
        var evtTarget = null;
        try { evtTarget = window.event ? window.event.target : null; } catch(x) {}
        var ov = document.createElement('div');
        ov.id = '__cfmOverlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);';
        ov.innerHTML = '<div style="background:#1a1816;border:1px solid rgba(200,135,58,0.3);border-radius:20px;padding:28px 24px;max-width:320px;width:90%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.6);"><div style="font-size:36px;margin-bottom:12px">⚠️</div><p style="color:#f2e8d9;font-size:16px;font-weight:600;margin-bottom:20px">'+String(msg||'Confirm?')+'</p><div style="display:flex;gap:10px"><button id="__cfmNo" style="flex:1;padding:13px;background:rgba(200,135,58,0.15);color:#e0a050;border:1px solid rgba(200,135,58,0.3);border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Cancel</button><button id="__cfmYes" style="flex:1;padding:13px;background:#ef4444;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer">Yes, Proceed</button></div></div>';
        document.body.appendChild(ov);
        var _target = evtTarget;
        document.getElementById('__cfmYes').onclick = function() {
          ov.remove();
          if (_target) { window.__confirmBypass = true; _target.click(); }
        };
        document.getElementById('__cfmNo').onclick = function() { ov.remove(); };
        ov.onclick = function(e) { if (e.target === ov) ov.remove(); };
        return false;
      };

      // Capture PDF blobs for native sharing
      window.__lastPdfBlob = null;
      var _origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = function(blob) {
        if (blob && blob.type && blob.type.indexOf('pdf') !== -1) {
          window.__lastPdfBlob = blob;
        }
        return _origCreateObjectURL.call(URL, blob);
      };

      // Intercept window.open for WhatsApp URLs — share PDF instead of text
      var _origOpen = window.open;
      window.open = function(url) {
        if (url && (url.indexOf('wa.me') !== -1 || url.indexOf('whatsapp') !== -1)) {
          if (window.__lastPdfBlob && window.ReactNativeWebView) {
            var reader = new FileReader();
            reader.onload = function() {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'SHARE_PDF',
                base64: reader.result.split(',')[1],
                filename: 'Invoice_' + Date.now() + '.pdf'
              }));
            };
            reader.readAsDataURL(window.__lastPdfBlob);
            window.__lastPdfBlob = null;
            return null; // Block opening WhatsApp with text
          }
        }
        return _origOpen.apply(window, arguments);
      };
    })();
    true;
  `;

  // ── LATE INJECTION (runs AFTER page loads) ───────────────────────────
  const injectedJS = `
    (function() {
      try {
        // 1. Hide website nav/header (app has its own)
        if (!document.getElementById('__app_injected')) {
          var s = document.createElement('style');
          s.id = '__app_injected';
          s.innerHTML = '.nav, nav, .navbar, header.site-header { display: none !important; } body { padding-top: 0 !important; margin-top: 0 !important; } * { -webkit-tap-highlight-color: transparent; }'
            + ' .stat-value, .tc-total-val, .tc-item-price, .receipt-totals td, .net-amount, .price, [class*="total"], [class*="amount"], [class*="price"] { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; letter-spacing: 0.02em; }';
          document.head.appendChild(s);
        }

        // 2. Disable pinch-zoom
        var meta = document.querySelector('meta[name="viewport"]');
        if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

        // 3. Auto-login if needed
        ${loginData ? `
          var tryLogin = function() {
            var form = document.querySelector('form');
            if (form && !form.dataset.__submitted) {
              var u = form.querySelector('input[name="username"]');
              var p = form.querySelector('input[name="password"]');
              var r = form.querySelector('input[name="remember"]');
              if (u && p) {
                form.dataset.__submitted = '1';
                u.value = ${JSON.stringify(loginData.username)};
                p.value = ${JSON.stringify(loginData.password)};
                if (r) r.checked = ${loginData.remember ? 'true' : 'false'};
                setTimeout(function() {
                  var btn = form.querySelector('button[type="submit"]');
                  if (btn) btn.click(); else form.submit();
                }, 300);
              }
            }
          };
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', tryLogin);
          } else { tryLogin(); }
        ` : ''}

        // 4. COMPLETE sendWhatsAppBill replacement for native PDF sharing
        var patchBilling = function() {
          if (typeof window.sendWhatsAppBill !== 'function') return;
          if (window.__billPatched) return;
          window.__billPatched = true;

          window.sendWhatsAppBill = async function() {
            var phoneInput = document.getElementById('waPhone');
            var phone = phoneInput ? phoneInput.value.trim() : '';
            if (!phone || phone.length < 10) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'NATIVE_ALERT', message: 'Please enter a valid phone number.'
              }));
              return;
            }

            // ✅ FIXED: Capture tableNo BEFORE closeWaModal() nullifies pendingWaTable
            var tableNo = window.pendingWaTable || (typeof pendingWaTable !== 'undefined' ? pendingWaTable : null);
            if (typeof closeWaModal === 'function') closeWaModal();

            if (!tableNo) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'NATIVE_ALERT', message: 'No table selected. Please try again.'
              }));
              return;
            }

            var card = document.getElementById('table-' + tableNo);
            if (!card) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'NATIVE_ALERT', message: 'Table card not found on page. Please refresh billing.'
              }));
              return;
            }

            var total = card.dataset.total || '0';
            var rows = card.querySelectorAll('.tc-item-row');
            var restName = (typeof REST_NAME !== 'undefined') ? REST_NAME : 'Restaurant';
            var address = (typeof ADDRESS !== 'undefined') ? ADDRESS : '';

            // Build receipt HTML
            var now = new Date();
            var dateStr = now.toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'-');
            var timeStr = now.toLocaleTimeString('en-US', {hour:'numeric',minute:'2-digit',hour12:true});
            var billNo = Math.floor(100 + Math.random() * 900);
            var itemsHtml = '';
            rows.forEach(function(r) {
              var qty = parseInt(r.dataset.qty);
              var sub = parseFloat(r.dataset.price);
              var rate = (sub / qty).toFixed(2);
              itemsHtml += '<tr><td style="padding:4px 0">' + r.dataset.name + '</td><td style="text-align:center;padding:4px 0">' + qty + '</td><td style="text-align:right;padding:4px 0">' + sub.toFixed(2) + '</td></tr>';
            });

            var receiptHtml = '<div style="background:#fff;color:#000;padding:20px;font-family:sans-serif;min-width:300px;max-width:400px">' +
              '<div style="text-align:center;margin-bottom:10px"><h2 style="margin:0;font-size:20px">' + restName + '</h2>' +
              (address ? '<p style="margin:4px 0;font-size:12px;color:#666">' + address + '</p>' : '') + '</div>' +
              '<hr style="border:1px dashed #ccc">' +
              '<table style="width:100%;font-size:13px"><tr><td>Bill: <b>' + billNo + '</b></td><td style="text-align:right">' + dateStr + '</td></tr><tr><td>Table: <b>' + tableNo + '</b></td><td style="text-align:right">' + timeStr + '</td></tr></table>' +
              '<hr style="border:1px dashed #ccc">' +
              '<table style="width:100%;font-size:13px"><thead><tr style="border-bottom:1px solid #000"><th style="text-align:left">Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amt</th></tr></thead><tbody>' + itemsHtml + '</tbody></table>' +
              '<hr style="border:1px dashed #ccc">' +
              '<div style="display:flex;justify-content:space-between;font-size:18px;font-weight:bold;padding:8px 0"><span>Total</span><span>Rs.' + parseFloat(total).toFixed(2) + '</span></div>' +
              '<hr style="border:1px dashed #ccc">' +
              '<p style="text-align:center;font-size:12px;font-style:italic;margin-top:10px">Thank you for dining with us!</p></div>';

            // Create temp container
            var tmp = document.createElement('div');
            tmp.style.cssText = 'position:absolute;top:-9999px;left:-9999px';
            tmp.innerHTML = receiptHtml;
            document.body.appendChild(tmp);

            try {
              if (typeof html2pdf === 'undefined') {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'NATIVE_ALERT', message: 'PDF generator not loaded. Please wait and try again.'
                }));
                tmp.remove();
                return;
              }

              var opt = {margin:10, filename:'Invoice.pdf', image:{type:'jpeg',quality:0.98}, html2canvas:{scale:2}, jsPDF:{unit:'pt',format:'a5',orientation:'portrait'}};
              var pdfBlob = await html2pdf().set(opt).from(tmp.firstChild).output('blob');
              tmp.remove();

              var reader = new FileReader();
              reader.onload = function() {
                var b64 = reader.result.split(',')[1];
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'SHARE_PDF',
                  base64: b64,
                  filename: 'Invoice_Table_' + tableNo + '_' + Date.now() + '.pdf',
                  tableNo: tableNo
                }));
              };
              reader.onerror = function() {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'NATIVE_ALERT', message: 'Failed to read PDF data.'
                }));
              };
              reader.readAsDataURL(pdfBlob);
            } catch(err) {
              tmp.remove();
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'NATIVE_ALERT', message: 'PDF Error: ' + err.message
              }));
            }
          };
        };

        // Try patching immediately + retry every 2s (page might load async)
        patchBilling();
        setInterval(patchBilling, 2000);

        // 5. Override window.print for native thermal print
        var _origPrint = window.print;
        window.print = function() {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PRINT_BILL' }));
          } else {
            _origPrint.call(window);
          }
        };
      } catch(e) {}
    })();
    true;
  `;


  const handleNavigationStateChange = (navState) => {
    setCanGoBack(navState.canGoBack);
    // After auto-login lands on dashboard, switch to tab view
    if (loginData && navState.url && navState.url.includes('/dashboard')) {
      navigation.replace('MainTabs', { username: loginData.username });
    }
    // If it requires profile selection, stop the loader so they can pick
    if (loginData && navState.url && navState.url.includes('/select_profile')) {
      setLoading(false);
    }
    // Handle manual logout from select_profile or elsewhere
    if (navState.url && navState.url.includes('/logout')) {
      navigation.replace('Login');
    }
  };

  // During login process, keep loading overlay visible to hide web login form
  const isLoginProcess = !!loginData;

  const handleLoadEnd = (syntheticEvent) => {
    // Also stop loading if we hit an error or somehow landed on select_profile quickly
    if (!isLoginProcess) {
      setLoading(false);
    }
    setRefreshing(false);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    webViewRef.current?.reload();
  };

  // Intercept WhatsApp links, wa.me, and all external URLs —
  // open them natively so WebView doesn't block them.
  const onShouldStartLoadWithRequest = (request) => {
    const url = request.url || '';
    if (
      url.startsWith('whatsapp://') ||
      url.includes('wa.me') ||
      url.includes('api.whatsapp.com')
    ) {
      Linking.openURL(url).catch(() =>
        Alert.alert('WhatsApp Not Found', 'Please install WhatsApp to use this feature.')
      );
      return false;
    }
    // Block any other external navigation (e.g. Google OAuth pop-ups)
    if (url.startsWith('http') && !url.startsWith(BASE_URL)) {
      Linking.openURL(url).catch(() => {});
      return false;
    }
    return true;
  };

  // Handle messages posted from the web page via window.ReactNativeWebView.postMessage
  const handleMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      // ── SHARE PDF ─────────────────────────────────────────────────
      if (data.type === 'SHARE_PDF') {
        const { base64, filename, tableNo } = data;
        if (!base64) { Alert.alert('Error', 'PDF data is empty.'); return; }
        try {
          const fileUri = FileSystem.cacheDirectory + (filename || `Invoice_${Date.now()}.pdf`);
          await FileSystem.writeAsStringAsync(fileUri, base64, {
            encoding: 'base64',
          });

          // Open the system share sheet directly (user can pick WhatsApp, Email, etc.)
          const isAvailable = await Sharing.isAvailableAsync();
          if (isAvailable) {
            await Sharing.shareAsync(fileUri, {
              mimeType: 'application/pdf',
              dialogTitle: `Bill — Table ${tableNo}`,
              UTI: 'com.adobe.pdf',
            });
          } else {
            Alert.alert('Share Unavailable', 'Native sharing is not supported on this device.');
          }
        } catch (err) {
          console.error('PDF Share Error:', err);
          Alert.alert('Share Failed', 'Could not process the PDF. Please try again.');
        }

      // ── BLUETOOTH THERMAL PRINT ─────────────────────────────────────
            } else if (data.type === 'PRINT_BILL') {
        const { items, restaurantName, tableNo, total, address } = data;
        try {
          const now = new Date();
          const dateStr = now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const hr = '--------------------------------';
          let r = '\n  ' + (restaurantName || 'Restaurant').toUpperCase() + '\n';
          if (address) r += '  ' + address + '\n';
          r += '\n' + hr + '\n  Table: ' + tableNo + '   ' + dateStr + '\n' + hr + '\n';
          r += '  Item                 Qty    Amt\n' + hr + '\n';
          if (Array.isArray(items)) { items.forEach(item => { const n = String(item.name).substring(0, 20).padEnd(20); const q = String(item.qty).padStart(3); const a = ('Rs.' + parseFloat(item.subtotal).toFixed(0)).padStart(7); r += '  ' + n + ' ' + q + ' ' + a + '\n'; }); }
          r += hr + '\n  TOTAL:     Rs.' + parseFloat(total).toFixed(2) + '\n' + hr + '\n\n  Thank you! Visit again.\n\n\n\n';
          const fileUri = FileSystem.cacheDirectory + 'receipt_t' + tableNo + '.txt';
          await FileSystem.writeAsStringAsync(fileUri, r, { encoding: 'utf8' });
          const ok = await Sharing.isAvailableAsync();
          if (ok) { await Sharing.shareAsync(fileUri, { mimeType: 'text/plain', dialogTitle: 'Print Receipt Table ' + tableNo }); }
          else { Alert.alert('Receipt', r, [{ text: 'Close' }]); }
        } catch (e) { Alert.alert('Print Error', 'Could not generate receipt.'); }

      } else if (data.type === 'OPEN_URL') {
        if (data.url) Linking.openURL(data.url).catch(() => {});
      } else if (data.type === 'NATIVE_ALERT' || data.type === 'NATIVE_CONFIRM') {
        Alert.alert(data.type === 'NATIVE_ALERT' ? 'Restaurant App' : 'Confirm Action', data.message || data.text);
      }
    } catch (_) {}
  };

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.errorWrap}>
          <Text style={styles.errorIcon}>📡</Text>
          <Text style={styles.errorTitle}>No Connection</Text>
          <Text style={styles.errorText}>
            Can't reach the server. Check your network and try again.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: color }]}
            onPress={() => { setError(false); setLoading(true); webViewRef.current?.reload(); }}
          >
            <Text style={styles.retryText}>↻  Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      {/* ── Header ─────────────────────────────────────── */}
      <LinearGradient
        colors={[COLORS.surface, COLORS.bg]}
        style={styles.header}
      >
        {!isMainTab && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
            <MaterialCommunityIcons name="chevron-left" size={26} color={COLORS.cream} />
          </TouchableOpacity>
        )}
        {isMainTab && <View style={styles.headerBtn} />}

        <View style={styles.headerMid}>
          <View style={[styles.headerDot, { backgroundColor: color }]} />
          <Text style={[styles.headerTitle, { color }]}>{title}</Text>
        </View>

        <TouchableOpacity
          onPress={handleRefresh}
          style={styles.headerBtn}
          disabled={refreshing || loading}
        >
          <MaterialCommunityIcons
            name={refreshing ? 'loading' : 'refresh'}
            size={20}
            color={refreshing ? color : COLORS.creamMuted}
          />
        </TouchableOpacity>
      </LinearGradient>

      {/* ── Thin progress bar ──────────────────────────── */}
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

      {/* ── WebView ─────────────────────────────────────── */}
      <WebView
        ref={webViewRef}
        source={{ uri: url }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={handleLoadEnd}
        onError={() => { setLoading(false); setError(true); }}
        onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) { setLoading(false); setError(true); } }}
        onNavigationStateChange={handleNavigationStateChange}
        onMessage={handleMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        injectedJavaScript={injectedJS}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        cacheEnabled
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled
        startInLoadingState={false}
        setSupportMultipleWindows={false}
        overScrollMode="never"
        bounces={false}
        renderToHardwareTextureAndroid
        injectedJavaScriptBeforeContentLoaded={injectedJSBeforeLoad}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly={true}
      />

      {/* ── Full-screen loading ─────────────────────────── */}
      {loading && !refreshing && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={color} />
          <Text style={styles.loadingText}>{title}…</Text>
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
    paddingVertical: 10,
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
    top: 58,
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
    gap: 12,
  },
  errorIcon: { fontSize: 52 },
  errorTitle: { fontSize: 22, fontWeight: '800', color: COLORS.cream },
  errorText: { fontSize: 14, color: COLORS.creamMuted, textAlign: 'center', lineHeight: 22 },
  retryBtn: {
    paddingHorizontal: 32,
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 8,
  },
  retryText: { color: '#000', fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
});
