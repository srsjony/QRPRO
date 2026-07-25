/**
 * Bluetooth thermal printer service.
 *
 * Wraps the `RNBLEPrinter` native module exposed by react-native-thermal-receipt-printer.
 * The library only exports USBPrinter / BLEPrinter / NetPrinter — there is no
 * `BluetoothManager` — so all Bluetooth work goes through BLEPrinter here.
 *
 * Responsibilities:
 *  - Android runtime permissions (12+ needs BLUETOOTH_SCAN / BLUETOOTH_CONNECT)
 *  - listing paired printers, connecting, remembering the last printer
 *  - printing raw ESC/POS bytes (base64) produced by the web page
 *  - a tiny subscribe/getState store so screens can show live connection status
 */
import { NativeModules, Platform, PermissionsAndroid } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { BLEPrinter } from 'react-native-thermal-receipt-printer';
import { STORAGE_KEYS } from '../constants/config';

const RNBLEPrinter = NativeModules.RNBLEPrinter;

/** True when the native module is actually present (i.e. not Expo Go / web). */
export const isPrinterSupported = () => !!RNBLEPrinter && Platform.OS !== 'web';

let state = {
  supported: isPrinterSupported(),
  initialized: false,
  connected: false,
  connecting: false,
  device: null, // { device_name, inner_mac_address }
  lastError: null,
};

const listeners = new Set();

export const getState = () => state;

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => {
    try {
      l(state);
    } catch (_) {}
  });
}

const errText = (e) =>
  String((e && (e.message || e.error)) || e || 'Unknown printer error');

/* ── Permissions ─────────────────────────────────────────────── */

export async function requestPermissions() {
  if (Platform.OS !== 'android') return true;

  // Android 12 (API 31) split Bluetooth into scan/connect runtime permissions.
  if (Platform.Version >= 31) {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return (
      granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
      granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED
    );
  }

  // Older Android discovers devices through location.
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/* ── Lifecycle ───────────────────────────────────────────────── */

export async function init() {
  if (!isPrinterSupported()) {
    setState({ supported: false, lastError: 'Bluetooth printing needs a native build.' });
    throw new Error('Bluetooth printing is not available in this build.');
  }
  if (state.initialized) return;

  await BLEPrinter.init();
  setState({ initialized: true, supported: true, lastError: null });
}

/**
 * Paired/bonded Bluetooth printers reported by the native module.
 * Returns [{ device_name, inner_mac_address }].
 */
export async function listDevices() {
  await init();
  const devices = await BLEPrinter.getDeviceList();
  return (Array.isArray(devices) ? devices : []).filter((d) => d && d.inner_mac_address);
}

export async function connect(device) {
  const mac = typeof device === 'string' ? device : device?.inner_mac_address;
  if (!mac) throw new Error('That printer has no Bluetooth address.');

  setState({ connecting: true, lastError: null });
  try {
    await init();
    const connected = await BLEPrinter.connectPrinter(mac);
    const resolved = {
      device_name:
        connected?.device_name || (typeof device === 'object' && device?.device_name) || 'Printer',
      inner_mac_address: connected?.inner_mac_address || mac,
    };
    setState({ connected: true, device: resolved });
    await rememberPrinter(resolved);
    return resolved;
  } catch (e) {
    setState({ connected: false, lastError: errText(e) });
    throw e;
  } finally {
    setState({ connecting: false });
  }
}

export async function disconnect() {
  try {
    if (state.initialized) await BLEPrinter.closeConn();
  } catch (_) {
    // Closing an already-dead socket is not worth surfacing.
  }
  setState({ connected: false, device: null });
}

/* ── Remembered printer ──────────────────────────────────────── */

async function rememberPrinter(device) {
  try {
    await SecureStore.setItemAsync(STORAGE_KEYS.printer, JSON.stringify(device));
  } catch (_) {}
}

export async function getSavedPrinter() {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEYS.printer);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export async function forgetPrinter() {
  try {
    await SecureStore.deleteItemAsync(STORAGE_KEYS.printer);
  } catch (_) {}
  await disconnect();
}

/**
 * Silently reconnect to the last used printer. Safe to call on app start:
 * resolves to null instead of throwing when there is nothing to reconnect to.
 */
export async function restore() {
  if (!isPrinterSupported() || state.connected || state.connecting) return null;
  const saved = await getSavedPrinter();
  if (!saved) return null;
  try {
    const ok = await requestPermissions();
    if (!ok) return null;
    return await connect(saved);
  } catch (_) {
    return null;
  }
}

/* ── Printing ────────────────────────────────────────────────── */

/**
 * printRawData only reports failures through its callback, so success is
 * inferred once the call has been handed to the native side without error.
 */
function printRawData(payload) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      err ? reject(new Error(errText(err))) : resolve();
    };

    try {
      RNBLEPrinter.printRawData(payload, done);
    } catch (e) {
      return done(e);
    }
    setTimeout(() => done(null), 700);
  });
}

function assertConnected() {
  if (!isPrinterSupported()) throw new Error('Bluetooth printing is not available in this build.');
  if (!state.connected) throw new Error('No printer connected.');
}

/** Print pre-built ESC/POS bytes (base64) — what the web page sends us. */
export async function printBase64(base64) {
  assertConnected();
  if (!base64) throw new Error('Nothing to print.');
  try {
    await printRawData(base64);
  } catch (e) {
    // A dead socket is the usual cause; drop the flag so the UI reflects reality.
    setState({ connected: false, lastError: errText(e) });
    throw e;
  }
}

/** Fallback when the page could not build ESC/POS bytes: print plain text. */
export async function printText(text) {
  assertConnected();
  if (!text) throw new Error('Nothing to print.');
  BLEPrinter.printBill(String(text), { beep: false, cut: true, tailingLine: true });
}

export async function printTest() {
  assertConnected();
  const stamp = new Date().toLocaleString();
  BLEPrinter.printBill(
    ['**TEST PRINT**', '', 'RestroMate Captain', stamp, '', 'Printer is working.', ''].join('\n'),
    { beep: false, cut: true, tailingLine: true }
  );
}
