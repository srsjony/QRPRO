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
  Modal,
  Pressable,
  AppState,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as SecureStore from 'expo-secure-store';
import { COLORS, BASE_URL, STORAGE_KEYS } from '../constants/config';
import usePrinter from '../hooks/usePrinter';
import * as Printer from '../services/printer';
import { signOut, isServerReachable } from '../services/session';

/** Safely embed a JS string literal into injected script. */
const jsString = (value) => JSON.stringify(String(value ?? ''));

// If auto-login has not reached the dashboard by now, something is wrong
// (usually bad credentials) and the user must not be left on a spinner.
// Generous enough to cover a cold start on a free-tier host, which can take
// well over 30s, while still bounding the wait.
const LOGIN_TIMEOUT_MS = 45000;
const APP_ORIGIN = new URL(BASE_URL).origin;

const parseAppUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.origin === APP_ORIGIN ? parsed : null;
  } catch (_) {
    return null;
  }
};

export default function WebViewScreen({ navigation, route }) {
  const {
    title,
    path,
    color = COLORS.ember,
    loginData,
    isMainTab = false,
    username,
  } = route.params || {};
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null); // null | { title, message }
  const [canGoBack, setCanGoBack] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const webViewRef = useRef(null);
  const loadAnim = useRef(new Animated.Value(0)).current;
  const loginTimer = useRef(null);
  const authPersisted = useRef(false);
  const authNavigationStarted = useRef(false);
  const logoutCompleted = useRef(false);
  const logoutFallback = useRef(null);
  const appState = useRef(AppState.currentState);
  const currentMainUrl = useRef(null);
  const printer = usePrinter();

  const url = loginData ? `${BASE_URL}/` : `${BASE_URL}${path}`;

  // Tab screens sit under the root stack; plain screens already are the root.
  const rootNav = navigation.getParent() ?? navigation;

  const persistVerifiedCredentials = useCallback(async () => {
    if (!loginData || authPersisted.current) return;
    authPersisted.current = true;
    if (loginData.remember) {
      await Promise.all([
        SecureStore.setItemAsync(STORAGE_KEYS.username, loginData.username),
        SecureStore.setItemAsync(STORAGE_KEYS.password, loginData.password),
        SecureStore.setItemAsync(STORAGE_KEYS.remember, 'true'),
      ]);
    } else {
      await Promise.all([
        SecureStore.deleteItemAsync(STORAGE_KEYS.username).catch(() => {}),
        SecureStore.deleteItemAsync(STORAGE_KEYS.password).catch(() => {}),
        SecureStore.setItemAsync(STORAGE_KEYS.remember, 'false').catch(() => {}),
      ]);
    }
  }, [loginData]);

  const signalPageLifecycle = useCallback((active) => {
    webViewRef.current?.injectJavaScript(`
      (function(){
        window.__RESTROMATE_APP_ACTIVE__ = ${active ? 'true' : 'false'};
        window.dispatchEvent(new Event('${active ? 'restromate:resume' : 'restromate:pause'}'));
      })(); true;
    `);
  }, []);

  // Pause socket/poll loops when a tab is hidden, and refresh once on return.
  useFocusEffect(
    useCallback(() => {
      signalPageLifecycle(true);
      return () => signalPageLifecycle(false);
    }, [signalPageLifecycle])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appState.current === 'active';
      appState.current = nextState;
      const isActive = nextState === 'active';
      if (wasActive !== isActive) signalPageLifecycle(isActive && navigation.isFocused());
    });
    return () => subscription.remove();
  }, [navigation, signalPageLifecycle]);

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

  // Bring back the saved Bluetooth printer so the first bill prints without setup.
  useEffect(() => {
    Printer.restore();
  }, []);

  // Guard the auto-login: never leave the user staring at "Authenticating…".
  useEffect(() => {
    if (!loginData) return;

    loginTimer.current = setTimeout(async () => {
      const reachable = await isServerReachable();
      setLoading(false);
      setError(
        reachable
          ? {
              // A rejected login reports itself via LOGIN_FAILED, so reaching this
              // branch means sign-in stalled rather than being refused. Don't
              // claim to know which.
              title: 'Sign-in timed out',
              message:
                'The server is reachable but sign-in did not finish in time. This usually clears up on a retry.',
              action: 'retryLogin',
            }
          : {
              title: 'No connection',
              message: 'Can\u2019t reach the server. Check your network and try again.',
            }
      );
    }, LOGIN_TIMEOUT_MS);

    return () => clearTimeout(loginTimer.current);
  }, [loginData]);

  // Tapping the already-active tab reloads it.
  useEffect(() => {
    if (!isMainTab) return;
    const unsubscribe = navigation.addListener('tabPress', () => {
      webViewRef.current?.reload();
    });
    return unsubscribe;
  }, [navigation, isMainTab]);

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
            + ' .stat-value, .tc-total-val, .tc-item-price, .receipt-totals td, .net-amount, .price, [class*="total"], [class*="amount"], [class*="price"] { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; letter-spacing: 0.02em; }'
            + ' #__app_printer_fab { position: fixed; top: 10px; right: 10px; z-index: 99999; display: flex; gap: 6px; flex-direction: column; align-items: flex-end; }'
            + ' #__app_printer_fab button { font-size: 11px; padding: 6px 10px; border-radius: 20px; border: 1px solid; background: rgba(10,10,20,0.85); cursor: pointer; font-weight: 600; backdrop-filter: blur(8px); }';
          document.head.appendChild(s);
        }

        // 2. Disable pinch-zoom
        var meta = document.querySelector('meta[name="viewport"]');
        if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

        // Compatibility controller for the currently deployed Kitchen page.
        // Its Socket.IO CDN can fail before the page registers its own polling
        // interval, leaving Android on "Connecting…" forever. The new server
        // template sets __RESTROMATE_KITCHEN_CONTROLLER__, so this retires itself
        // automatically after the backend is deployed.
        var isKitchenPage = location.pathname === '/kitchen'
          || location.pathname.indexOf('/kitchen/') === 0;
        if (isKitchenPage
            && !window.__RESTROMATE_KITCHEN_CONTROLLER__
            && !window.__APP_KITCHEN_FALLBACK__) {
          window.__APP_KITCHEN_FALLBACK__ = true;
          var kitchenFallbackTimer = null;
          var kitchenFallbackActive = true;
          var kitchenUser = decodeURIComponent(location.pathname.split('/').pop() || '');

          var setKitchenFallbackState = function(ok) {
            var dot = document.getElementById('connDot');
            var label = document.getElementById('connLabel');
            if (label) label.textContent = ok ? 'Synced · polling' : 'Offline · retrying';
            if (dot) {
              dot.classList.toggle('offline', !ok);
              dot.style.background = ok ? '#f59e0b' : '#ef4444';
              dot.style.boxShadow = ok ? '0 0 8px #f59e0b' : '0 0 8px #ef4444';
            }
          };

          var kitchenFallbackSync = function() {
            if (!kitchenFallbackActive) return;
            fetch('/kitchen_orders/' + encodeURIComponent(kitchenUser), {
              cache: 'no-store', headers: { 'Accept': 'application/json' }
            }).then(function(res) {
              if (!res.ok) throw new Error('Kitchen sync failed');
              return res.json();
            }).then(function(data) {
              try {
                orders = Array.isArray(data.orders) ? data.orders : [];
                knownIds = new Set(orders.map(function(o) { return o.id; }));
                updateStats();
                renderOrders();
              } catch(e) {
                // If the old page changed its variable names, its own renderer
                // can still refresh while this controller maintains status.
                if (typeof fetchOrders === 'function') fetchOrders();
              }
              setKitchenFallbackState(true);
            }).catch(function() {
              setKitchenFallbackState(false);
            }).finally(function() {
              clearTimeout(kitchenFallbackTimer);
              if (kitchenFallbackActive) kitchenFallbackTimer = setTimeout(kitchenFallbackSync, 8000);
            });
          };

          var pauseKitchenFallback = function() {
            kitchenFallbackActive = false;
            clearTimeout(kitchenFallbackTimer);
          };
          var resumeKitchenFallback = function() {
            if (kitchenFallbackActive) return;
            kitchenFallbackActive = true;
            kitchenFallbackSync();
          };
          window.addEventListener('restromate:pause', pauseKitchenFallback);
          window.addEventListener('restromate:resume', resumeKitchenFallback);

          // Give the page's native Socket.IO path four seconds to become Live.
          setTimeout(function() {
            var label = document.getElementById('connLabel');
            if (!label || label.textContent.trim() !== 'Live') kitchenFallbackSync();
          }, 4000);
        }

        // 3. Auto-login if needed
        ${loginData ? `
          // Read back whatever the server said, so a failure is reported straight
          // away instead of waiting for a timeout to guess at the cause.
          var reportLoginProblem = function() {
            var pw = document.querySelector('input[name="password"]');
            if (!pw) return false; // We left the login page — nothing to report.

            var msg = '';
            var em = document.querySelector('.error-msg');
            if (em) msg = (em.textContent || '').replace(/^[\\s⚠]+/, '').trim();
            if (!msg) {
              // Flash messages carry no class, only an inline red border colour.
              var flash = document.querySelector('[style*="rgba(239,68,68"]');
              if (flash) msg = (flash.textContent || '').trim();
            }
            if (!msg) return false;

            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'LOGIN_FAILED', message: msg
            }));
            return true;
          };

          var tryLogin = function() {
            if (reportLoginProblem()) return;

            // Only ever auto-submit once per WebView session. sessionStorage
            // survives the page reload that a rejected login causes, which stops
            // the app from resubmitting bad credentials in a loop.
            try {
              if (sessionStorage.getItem('__autoLoginTried') === '1') return;
            } catch(e) {}

            var form = document.querySelector('form');
            if (form && !form.dataset.__submitted) {
              var u = form.querySelector('input[name="username"]');
              var p = form.querySelector('input[name="password"]');
              var r = form.querySelector('input[name="remember"]');
              if (u && p) {
                form.dataset.__submitted = '1';
                try { sessionStorage.setItem('__autoLoginTried', '1'); } catch(e) {}
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

        // Patch as soon as the page defines sendWhatsAppBill. A DOM observer plus
        // a bounded retry replaces the old forever-running 2s interval, which kept
        // the WebView awake and burned battery on every screen.
        patchBilling();

        // 5. On billing/captain pages: inject floating printer FAB + patch print buttons
        var injectPrinterUI = function() {
          if (document.getElementById('__app_printer_fab')) return; // Already injected

          // Check if this is billing or captain page
          var isBilling = typeof window.printBill === 'function' || document.getElementById('payModal');
          var isCaptain = document.getElementById('tables-screen') !== null && typeof window.printBill === 'function';
          if (!isBilling && !isCaptain) return;

          // Inject floating printer connect buttons FAB.
          // Handlers are attached with addEventListener rather than inline onclick
          // strings: nested quote escapes collapse inside this template literal and
          // previously broke the whole injected script.
          var fab = document.createElement('div');
          fab.id = '__app_printer_fab';

          var makeBtn = function(id, label, borderColor, fnName, msgType) {
            var b = document.createElement('button');
            b.id = id;
            b.textContent = label;
            b.style.borderColor = borderColor;
            b.style.color = borderColor;
            b.addEventListener('click', function() {
              if (typeof window[fnName] === 'function') {
                window[fnName]();
              } else if (window.ReactNativeWebView) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: msgType }));
              }
            });
            return b;
          };

          fab.appendChild(makeBtn('__app_bt_btn', '\u{1F4F6} BT Printer', '#818cf8', 'connectBluetoothPrinter', 'CONNECT_BLUETOOTH'));
          fab.appendChild(makeBtn('__app_com_btn', '\u{1F50C} COM Port', '#60a5fa', 'connectSerialPrinter', 'CONNECT_SERIAL'));
          document.body.appendChild(fab);

          // Patch print buttons on billing page to bypass payment modal
          if (isBilling && !isCaptain) {
            document.querySelectorAll('.tc-btn.print, button[onclick*="askPayment"]').forEach(function(btn) {
              var onc = btn.getAttribute('onclick') || '';
              var match = onc.match(/askPayment\('?([^')]+)'?\)/);
              if (match) {
                var tableNo = match[1];
                btn.setAttribute('onclick', '');
                btn.addEventListener('click', function(e) {
                  e.preventDefault(); e.stopPropagation();
                  window.__nativePrintTable(tableNo);
                });
              }
            });
          }
        };

        // Native print handler — calls API then posts to app
        window.__nativePrintTable = function(tableNo) {
          var csrfMeta = document.querySelector('meta[name="csrf-token"]');
          var csrfToken = csrfMeta ? csrfMeta.content : '';
          var restName = (typeof REST_NAME !== 'undefined') ? REST_NAME : '';
          fetch('/api/print_bill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: JSON.stringify({ username: restName, table: tableNo, pay_method: 'cash' })
          }).then(function(r) { return r.json(); }).then(function(data) {
            if (data.error) {
              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'NATIVE_ALERT', message: data.error }));
              return;
            }
            // Build ESC/POS binary if compile function is available
            var sendPrint = function(b64) {
              window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'PRINT_BILL',
                bill_text: data.bill_text,
                bill_no: data.bill_no,
                table: tableNo,
                total: data.total,
                raw_bytes_base64: b64 || ''
              }));
            };
            if (typeof compileReceiptBytes === 'function') {
              compileReceiptBytes(data.bill_text).then(function(rawBytes) {
                var binary = '';
                for (var i = 0; i < rawBytes.byteLength; i++) { binary += String.fromCharCode(rawBytes[i]); }
                sendPrint(window.btoa(binary));
              }).catch(function() { sendPrint(''); });
            } else {
              sendPrint('');
            }
          }).catch(function(err) {
            window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'NATIVE_ALERT', message: 'Print failed: ' + err.message }));
          });
        };

        // Run both patches when the DOM settles, with a capped number of retries
        // for pages that build their UI asynchronously.
        var applyPatches = function() {
          patchBilling();
          injectPrinterUI();
        };

        // Billing/captain are the only pages that need ongoing DOM patching.
        // Other tabs avoid a 20-second timer and a document-wide observer.
        var needsDynamicPatches = location.pathname === '/billing'
          || location.pathname.indexOf('/billing/') === 0
          || location.pathname === '/captain'
          || location.pathname.indexOf('/captain/') === 0;
        if (needsDynamicPatches) {
          var tries = 0;
          var retry = setInterval(function() {
            applyPatches();
            if (document.getElementById('__app_printer_fab') || ++tries > 20) {
              clearInterval(retry);
            }
          }, 1000);

          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() { setTimeout(applyPatches, 300); });
          } else {
            setTimeout(applyPatches, 300);
          }

          if (window.MutationObserver && document.body) {
            var pending = null;
            new MutationObserver(function() {
              if (pending) return;
              pending = setTimeout(function() { pending = null; applyPatches(); }, 400);
            }).observe(document.body, { childList: true, subtree: true });
          }
        }

        // Tell the page a real thermal printer is reachable through the app.
        window.__NATIVE_APP__ = true;
        window.__NATIVE_PRINTER_READY__ = ${printer.connected ? 'true' : 'false'};

      } catch(e) {}
    })();
    true;
  `;


  const handleNavigationStateChange = (navState) => {
    setCanGoBack(navState.canGoBack);
    const current = navState.url || '';
    const parsed = parseAppUrl(current);
    if (parsed) currentMainUrl.current = parsed.href;
    const pathname = parsed?.pathname || '';

    // Store credentials only after the server proves authentication succeeded.
    if (loginData && (pathname === '/dashboard' || pathname === '/superadmin')) {
      clearTimeout(loginTimer.current);
      if (authNavigationStarted.current) return;
      authNavigationStarted.current = true;
      persistVerifiedCredentials().finally(() => {
        rootNav.replace('MainTabs', { username: loginData.username });
      });
      return;
    }

    // Profile selection is reached only after successful authentication.
    if (loginData && pathname === '/select_profile') {
      clearTimeout(loginTimer.current);
      persistVerifiedCredentials();
      setLoading(false);
    }

    // An authenticated tab redirected to / means its server session expired.
    if (isMainTab && pathname === '/') {
      setLoading(false);
      setError({
        title: 'Session expired',
        message: 'Your server session ended. Sign in again to continue.',
        action: 'login',
      });
      return;
    }

    if (isMainTab && title === 'Profiles' && pathname === '/dashboard') {
      rootNav.replace('MainTabs', { username, timestamp: Date.now() });
      return;
    }

    if (pathname === '/logout') {
      completeSignOut();
    }
  };

  // During login process, keep loading overlay visible to hide web login form
  const isLoginProcess = !!loginData;

  const handleLoadEnd = () => {
    if (!isLoginProcess) {
      setLoading(false);
    }
    setRefreshing(false);
    signalPageLifecycle(appState.current === 'active' && navigation.isFocused());
  };

  const handleRefresh = () => {
    setRefreshing(true);
    webViewRef.current?.reload();
  };

  const retryFromError = () => {
    setError(null);
    setLoading(true);

    // The one-shot auto-login latch lives in sessionStorage and survives a
    // reload, so an explicit retry has to clear it or nothing would be resubmitted.
    if (loginData) {
      webViewRef.current?.injectJavaScript(
        `(function(){ try { sessionStorage.removeItem('__autoLoginTried'); } catch(e){} })(); true;`
      );
    }
    webViewRef.current?.reload();
  };

  const completeSignOut = async () => {
    if (logoutCompleted.current) return;
    logoutCompleted.current = true;
    clearTimeout(logoutFallback.current);
    await signOut();
    rootNav.replace('Login', { skipAutoLogin: true });
  };

  const handleSignOut = () => {
    setMenuOpen(false);
    Alert.alert('Sign out', 'Clear saved credentials and end this session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          // Logout inside the WebView so its cookie jar is definitely cleared.
          webViewRef.current?.injectJavaScript(`
            (function(){
              fetch('/logout', { credentials: 'include' })
                .catch(function(){})
                .then(function(){
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOGOUT_COMPLETE' }));
                });
            })(); true;
          `);
          logoutFallback.current = setTimeout(completeSignOut, 6000);
        },
      },
    ]);
  };

  // Keep external navigation out of the authenticated WebView. Compare parsed
  // origins rather than string prefixes (which trust lookalike hostnames).
  const onShouldStartLoadWithRequest = (request) => {
    const target = request.url || '';
    if (
      target.startsWith('whatsapp://') ||
      target.includes('wa.me') ||
      target.includes('api.whatsapp.com')
    ) {
      Linking.openURL(target).catch(() =>
        Alert.alert('WhatsApp Not Found', 'Please install WhatsApp to use this feature.')
      );
      return false;
    }
    if (/^(tel:|mailto:|sms:|intent:)/i.test(target)) {
      Linking.openURL(target).catch(() => {});
      return false;
    }
    if (/^https?:/i.test(target) && !parseAppUrl(target)) {
      Linking.openURL(target).catch(() => {});
      return false;
    }
    return true;
  };

  /** Show feedback using the page's own toast, so it appears where the user is looking. */
  const toastInPage = (msg, isError = false) => {
    webViewRef.current?.injectJavaScript(`
      (function(){
        try {
          if (typeof showToast === 'function') showToast(${jsString(msg)}, ${isError ? 'true' : 'false'});
        } catch(e) {}
      })(); true;
    `);
  };

  /**
   * Try to print on the paired Bluetooth printer.
   * Returns true when the job was handled here, false to fall back to the
   * share-sheet flow (RawBT and friends).
   */
  const printDirect = (data, label) =>
    new Promise((resolve) => {
      if (!Printer.isPrinterSupported()) return resolve(false);

      const run = async () => {
        try {
          if (data.raw_bytes_base64) {
            await Printer.printBase64(data.raw_bytes_base64);
          } else if (data.bill_text) {
            await Printer.printText(data.bill_text);
          } else {
            return resolve(false);
          }
          toastInPage(`${label} printed`);
          resolve(true);
        } catch (e) {
          Alert.alert('Print failed', e?.message || 'Could not reach the printer.', [
            { text: 'Use share sheet', onPress: () => resolve(false) },
            { text: 'Retry', onPress: run },
            {
              text: 'Printer setup',
              onPress: () => {
                rootNav.navigate('Printer', { pendingJobLabel: label });
                resolve(true);
              },
            },
          ]);
        }
      };

      (async () => {
        if (!Printer.getState().connected) await Printer.restore();

        if (!Printer.getState().connected) {
          Alert.alert('How do you want to print?', `No Bluetooth printer is connected.`, [
            { text: 'Share sheet', onPress: () => resolve(false) },
            {
              text: 'Connect printer',
              onPress: () => {
                rootNav.navigate('Printer', { pendingJobLabel: label });
                resolve(true);
              },
            },
          ]);
          return;
        }
        run();
      })();
    });

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
      } else if (data.type === 'CONNECT_BLUETOOTH' || data.type === 'CONNECT_SERIAL') {
        rootNav.navigate('Printer');
      } else if (data.type === 'PRINT_BILL' || data.type === 'PRINT_KOT' || data.type === 'PRINT_RECEIPT') {
        const label =
          data.type === 'PRINT_KOT'
            ? `KOT for Table ${data.table ?? '—'}`
            : `bill for Table ${data.table ?? '—'}`;

        // Preferred path: send ESC/POS bytes straight to the paired printer.
        if (await printDirect(data, label)) return;

        try {
          if (data.raw_bytes_base64) {
            // Fallback: hand the raw ESC/POS file to a print service like RawBT.
            const filename = 'receipt_t' + (data.table || '0') + '_' + Date.now() + '.bin';
            const fileUri = FileSystem.cacheDirectory + filename;
            await FileSystem.writeAsStringAsync(fileUri, data.raw_bytes_base64, {
              encoding: 'base64',
            });
            const ok = await Sharing.isAvailableAsync();
            if (ok) {
              await Sharing.shareAsync(fileUri, { mimeType: 'application/octet-stream', dialogTitle: 'Print Binary ESC/POS File' });
            } else {
              Alert.alert('Receipt', 'Binary file saved but cannot share natively.', [{ text: 'Close' }]);
            }
          } else {
            // Legacy fall back for old structures
            const { items, restaurantName, tableNo, total, address } = data;
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
          }
        } catch (e) { Alert.alert('Print Error', 'Could not generate receipt.'); }

      } else if (data.type === 'OPEN_URL') {
        if (data.url) Linking.openURL(data.url).catch(() => {});
      } else if (data.type === 'LOGIN_FAILED') {
        clearTimeout(loginTimer.current);
        // Remove any previously remembered password so a bad/stale credential
        // cannot be replayed on the next launch.
        await Promise.all([
          SecureStore.deleteItemAsync(STORAGE_KEYS.password).catch(() => {}),
          SecureStore.setItemAsync(STORAGE_KEYS.remember, 'false').catch(() => {}),
        ]);
        setLoading(false);
        setError({
          title: 'Sign-in failed',
          message: `${data.message || 'The server rejected those credentials.'}\n\nUpdate your details and try again.`,
          action: 'login',
        });
      } else if (data.type === 'LOGOUT_COMPLETE') {
        await completeSignOut();
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
          <Text style={styles.errorTitle}>{error.title}</Text>
          <Text style={styles.errorText}>{error.message}</Text>

          {error.action === 'login' ? (
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: color }]}
              onPress={() => rootNav.replace('Login', { skipAutoLogin: true })}
            >
              <Text style={styles.retryText}>Back to sign in</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: color }]}
              onPress={retryFromError}
            >
              <Text style={styles.retryText}>↻  Retry</Text>
            </TouchableOpacity>
          )}

          {/* A stalled sign-in should also offer a way back to the form. */}
          {error.action === 'retryLogin' && (
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => rootNav.replace('Login', { skipAutoLogin: true })}
            >
              <Text style={styles.secondaryText}>Back to sign in</Text>
            </TouchableOpacity>
          )}
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
          accessibilityRole="button"
          accessibilityLabel="Reload page"
        >
          <MaterialCommunityIcons
            name={refreshing ? 'loading' : 'refresh'}
            size={20}
            color={refreshing ? color : COLORS.creamMuted}
          />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => setMenuOpen(true)}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <MaterialCommunityIcons name="dots-vertical" size={20} color={COLORS.creamMuted} />
          <View
            style={[
              styles.printerBadge,
              { backgroundColor: printer.connected ? COLORS.success : 'transparent' },
            ]}
          />
        </TouchableOpacity>
      </LinearGradient>

      {/* ── Overflow menu: printer + sign out ──────────── */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                rootNav.navigate('Printer');
              }}
            >
              <MaterialCommunityIcons name="printer" size={19} color={COLORS.cream} />
              <View style={styles.menuTextWrap}>
                <Text style={styles.menuText}>Printer</Text>
                <Text style={styles.menuSub}>
                  {printer.connected
                    ? printer.device?.device_name || 'Connected'
                    : 'Not connected'}
                </Text>
              </View>
              <View
                style={[
                  styles.menuDot,
                  { backgroundColor: printer.connected ? COLORS.success : COLORS.creamMuted },
                ]}
              />
            </TouchableOpacity>

            <View style={styles.menuDivider} />

            <TouchableOpacity style={styles.menuItem} onPress={handleSignOut}>
              <MaterialCommunityIcons name="logout" size={19} color={COLORS.danger} />
              <View style={styles.menuTextWrap}>
                <Text style={[styles.menuText, { color: COLORS.danger }]}>Sign out</Text>
                <Text style={styles.menuSub}>{username ? String(username) : 'End session'}</Text>
              </View>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

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
        onError={() => {
          setLoading(false);
          setError({
            title: 'No connection',
            message: 'Can\u2019t reach the server. Check your network and try again.',
          });
        }}
        onHttpError={({ nativeEvent }) => {
          const failedUrl = parseAppUrl(nativeEvent.url);
          const mainUrl = parseAppUrl(currentMainUrl.current || url);
          if (!failedUrl || (mainUrl && failedUrl.pathname !== mainUrl.pathname)) return;

          const code = nativeEvent.statusCode;
          if (code === 401 || code === 403) {
            setLoading(false);
            setError({
              title: 'Session expired',
              message: 'Your server session is no longer valid. Sign in again to continue.',
              action: 'login',
            });
          } else if (code >= 500) {
            setLoading(false);
            setError({
              title: 'Server error',
              message: `The server responded with ${code}. Try again in a moment.`,
            });
          } else if (code === 404) {
            setLoading(false);
            setError({
              title: 'Page not found',
              message: `${title} is not available on the server (404).`,
            });
          } else if (code === 400) {
            // The server aborts with 400 on a missing/stale CSRF token, which
            // otherwise looks identical to a rejected password.
            setLoading(false);
            setError({
              title: 'Session expired',
              message:
                'The server rejected the request because the security token was stale. Signing in again will issue a fresh one.',
              action: loginData ? 'login' : undefined,
            });
          }
        }}
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
  printerBadge: {
    position: 'absolute',
    top: 6,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 64,
    paddingRight: 12,
  },
  menuCard: {
    minWidth: 232,
    backgroundColor: COLORS.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.divider,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  menuTextWrap: { flex: 1 },
  menuText: { color: COLORS.cream, fontSize: 14, fontWeight: '700' },
  menuSub: { color: COLORS.creamMuted, fontSize: 11, marginTop: 2 },
  menuDot: { width: 8, height: 8, borderRadius: 4 },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.divider,
    marginHorizontal: 12,
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
  secondaryBtn: { paddingHorizontal: 20, paddingVertical: 10, marginTop: 2 },
  secondaryText: { color: COLORS.creamMuted, fontSize: 14, fontWeight: '600' },
});
