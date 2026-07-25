import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from '../constants/config';
import usePrinter from '../hooks/usePrinter';
import * as Printer from '../services/printer';

export default function PrinterScreen({ navigation, route }) {
  const printer = usePrinter();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyMac, setBusyMac] = useState(null);
  const [savedPrinter, setSavedPrinter] = useState(null);
  const [message, setMessage] = useState(null);

  // Set when the WebView sends us here because a print job needs a printer.
  const pendingJobLabel = route.params?.pendingJobLabel;

  const load = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      if (!Printer.isPrinterSupported()) {
        setMessage(
          'Bluetooth printing needs the installed app (a development build or APK). It is unavailable in Expo Go.'
        );
        return;
      }

      const allowed = await Printer.requestPermissions();
      if (!allowed) {
        setMessage(
          Platform.OS === 'android' && Platform.Version >= 31
            ? 'Nearby devices permission is required to find your printer. Enable it in Settings › Apps › Restromate › Permissions.'
            : 'Location permission is required to discover Bluetooth printers.'
        );
        return;
      }

      setDevices(await Printer.listDevices());
    } catch (e) {
      setMessage(
        `Could not reach Bluetooth: ${e?.message || 'unknown error'}. Make sure Bluetooth is turned on.`
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    Printer.getSavedPrinter().then(setSavedPrinter);
    load();
  }, [load]);

  const handleConnect = async (device) => {
    setBusyMac(device.inner_mac_address);
    try {
      await Printer.connect(device);
      setSavedPrinter(await Printer.getSavedPrinter());
      Alert.alert(
        'Printer connected',
        `${device.device_name || 'Printer'} is ready.${
          pendingJobLabel ? `\n\nGo back to reprint ${pendingJobLabel}.` : ''
        }`,
        [
          { text: 'Print test', onPress: handleTestPrint },
          { text: 'Done', style: 'cancel', onPress: () => navigation.goBack() },
        ]
      );
    } catch (e) {
      Alert.alert(
        'Connection failed',
        `${e?.message || 'Could not connect.'}\n\nIf this keeps happening, pair the printer in Android Bluetooth settings first, then try again.`
      );
    } finally {
      setBusyMac(null);
    }
  };

  const handleTestPrint = async () => {
    try {
      await Printer.printTest();
    } catch (e) {
      Alert.alert('Test print failed', e?.message || 'Could not print.');
    }
  };

  const handleForget = async () => {
    Alert.alert('Forget printer', 'The app will stop reconnecting to this printer automatically.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: async () => {
          await Printer.forgetPrinter();
          setSavedPrinter(null);
        },
      },
    ]);
  };

  const renderItem = ({ item }) => {
    const mac = item.inner_mac_address;
    const isConnected = printer.connected && printer.device?.inner_mac_address === mac;
    const isBusy = busyMac === mac;

    return (
      <TouchableOpacity
        style={[styles.deviceRow, isConnected && styles.deviceRowActive]}
        onPress={() => handleConnect(item)}
        disabled={!!busyMac}
        accessibilityRole="button"
        accessibilityLabel={`${item.device_name || 'Unknown printer'}, ${
          isConnected ? 'connected' : 'tap to connect'
        }`}
      >
        <View style={styles.deviceInfo}>
          <Text style={styles.deviceName} numberOfLines={1}>
            {item.device_name || 'Unknown device'}
          </Text>
          <Text style={styles.deviceMac}>{mac}</Text>
        </View>
        {isBusy ? (
          <ActivityIndicator size="small" color={COLORS.ember} />
        ) : (
          <Text style={[styles.connectText, isConnected && styles.connectedText]}>
            {isConnected ? '✓ Connected' : 'Connect'}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Printer</Text>
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={load}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel="Refresh printer list"
        >
          {loading ? (
            <ActivityIndicator size="small" color={COLORS.bg} />
          ) : (
            <Text style={styles.scanText}>Refresh</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Current connection */}
      <View style={styles.statusCard}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: printer.connected ? COLORS.success : COLORS.creamMuted },
          ]}
        />
        <View style={styles.statusTextWrap}>
          <Text style={styles.statusTitle}>
            {printer.connected
              ? printer.device?.device_name || 'Printer connected'
              : 'No printer connected'}
          </Text>
          <Text style={styles.statusSub}>
            {printer.connected
              ? printer.device?.inner_mac_address
              : savedPrinter
              ? `Last used: ${savedPrinter.device_name}`
              : 'Pick a paired printer below'}
          </Text>
        </View>
        {printer.connected && (
          <TouchableOpacity onPress={handleTestPrint} style={styles.testBtn}>
            <Text style={styles.testBtnText}>Test</Text>
          </TouchableOpacity>
        )}
      </View>

      {pendingJobLabel && !printer.connected && (
        <Text style={styles.pendingNote}>
          Connect a printer to print {pendingJobLabel}.
        </Text>
      )}

      {message ? (
        <View style={styles.messageWrap}>
          <Text style={styles.messageIcon}>🖨️</Text>
          <Text style={styles.messageText}>{message}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          style={styles.list}
          contentContainerStyle={styles.listContent}
          data={devices}
          keyExtractor={(item) => item.inner_mac_address}
          renderItem={renderItem}
          refreshing={loading}
          onRefresh={load}
          ListHeaderComponent={<Text style={styles.sectionTitle}>PAIRED PRINTERS</Text>}
          ListEmptyComponent={
            loading ? null : (
              <Text style={styles.emptyText}>
                No paired printers found.{'\n\n'}Pair your thermal printer in Android Bluetooth
                settings first, then tap Refresh.
              </Text>
            )
          }
          ListFooterComponent={
            savedPrinter ? (
              <TouchableOpacity style={styles.forgetBtn} onPress={handleForget}>
                <Text style={styles.forgetText}>Forget saved printer</Text>
              </TouchableOpacity>
            ) : null
          }
        />
      )}

      {printer.connecting && (
        <View style={styles.overlay}>
          <View style={styles.overlayBox}>
            <ActivityIndicator size="large" color={COLORS.ember} />
            <Text style={styles.overlayText}>Connecting…</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.surface,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backText: { color: COLORS.cream, fontSize: 30, fontWeight: '300', lineHeight: 34 },
  title: { fontSize: 16, fontWeight: '700', color: COLORS.cream, letterSpacing: 0.5 },
  scanBtn: {
    backgroundColor: COLORS.ember,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    minWidth: 76,
    alignItems: 'center',
  },
  scanText: { color: COLORS.bg, fontWeight: '800', fontSize: 13 },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    margin: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusTextWrap: { flex: 1 },
  statusTitle: { color: COLORS.cream, fontSize: 15, fontWeight: '700' },
  statusSub: { color: COLORS.creamMuted, fontSize: 12, marginTop: 3 },
  testBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.ember,
  },
  testBtnText: { color: COLORS.ember, fontWeight: '700', fontSize: 13 },

  pendingNote: {
    color: COLORS.pending,
    fontSize: 13,
    paddingHorizontal: 20,
    marginBottom: 8,
  },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.creamMuted,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  deviceRow: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  deviceRowActive: { borderColor: COLORS.success },
  deviceInfo: { flex: 1 },
  deviceName: { color: COLORS.cream, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  deviceMac: { color: COLORS.creamMuted, fontSize: 12 },
  connectText: { color: COLORS.ember, fontWeight: '700', fontSize: 13 },
  connectedText: { color: COLORS.success },
  emptyText: {
    color: COLORS.creamMuted,
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 20,
    fontSize: 13,
  },
  forgetBtn: { alignSelf: 'center', marginTop: 28, padding: 10 },
  forgetText: { color: COLORS.danger, fontSize: 13, fontWeight: '600' },

  messageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  messageIcon: { fontSize: 48, marginBottom: 16 },
  messageText: {
    color: COLORS.creamMuted,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },
  retryBtn: {
    backgroundColor: COLORS.ember,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 14,
  },
  retryText: { color: COLORS.bg, fontWeight: '800', fontSize: 14 },

  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayBox: {
    backgroundColor: COLORS.card,
    padding: 28,
    borderRadius: 16,
    alignItems: 'center',
  },
  overlayText: { color: COLORS.cream, marginTop: 16, fontSize: 15, fontWeight: '600' },
});
