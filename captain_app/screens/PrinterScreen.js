import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  Alert
} from 'react-native';
import { BluetoothManager } from 'react-native-thermal-receipt-printer';
import { COLORS } from '../constants/config';
import { PermissionsAndroid, Platform } from 'react-native';

export default function PrinterScreen({ navigation }) {
  const [devices, setDevices] = useState([]);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    initBluetooth();
  }, []);

  const requestPermissions = async () => {
    if (Platform.OS === 'android') {
      if (Platform.Version >= 31) {
        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ]);
        return (
          granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          granted['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED
        );
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    }
    return true;
  };

  const initBluetooth = async () => {
    try {
      const hasPermission = await requestPermissions();
      if (!hasPermission) {
        Alert.alert('Permission Denied', 'Bluetooth and Location permissions are required to scan for printers.');
        return;
      }

      const isEnabled = await BluetoothManager.isBluetoothEnabled();
      if (!isEnabled) {
        Alert.alert('Bluetooth Disabled', 'Please turn on Bluetooth to connect to your printer.');
        return;
      }
      scanDevices();
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'Failed to initialize Bluetooth on this device.');
    }
  };

  const scanDevices = async () => {
    setScanning(true);
    try {
      const res = await BluetoothManager.scanDevices();
      const parsed = typeof res === 'string' ? JSON.parse(res) : res;
      setPairedDevices(parsed.paired || []);
      setDevices(parsed.found || []);
    } catch (e) {
      console.error(e);
      Alert.alert('Scanning Failed', 'Could not scan for Bluetooth printers.');
    } finally {
      setScanning(false);
    }
  };

  const connectToDevice = async (address) => {
    setConnecting(true);
    try {
      await BluetoothManager.connect(address);
      Alert.alert('Connected', 'Successfully connected to printer!');
      navigation.goBack();
    } catch (e) {
      console.error(e);
      Alert.alert('Connection Failed', 'Could not connect to the selected printer.');
    } finally {
      setConnecting(false);
    }
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={styles.deviceRow}
      onPress={() => connectToDevice(item.mac)}
      disabled={connecting}
    >
      <View>
        <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
        <Text style={styles.deviceMac}>{item.mac}</Text>
      </View>
      <Text style={styles.connectText}>Connect</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Bluetooth Printers</Text>
        <TouchableOpacity style={styles.scanBtn} onPress={scanDevices} disabled={scanning}>
          {scanning ? <ActivityIndicator size="small" color={COLORS.bg} /> : <Text style={styles.scanText}>Scan</Text>}
        </TouchableOpacity>
      </View>

      {pairedDevices.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PAIRED DEVICES</Text>
          <FlatList
            data={pairedDevices}
            keyExtractor={item => item.mac}
            renderItem={renderItem}
            scrollEnabled={false}
          />
        </View>
      )}

      <View style={[styles.section, { flex: 1 }]}>
        <Text style={styles.sectionTitle}>FOUND DEVICES</Text>
        <FlatList
          data={devices}
          keyExtractor={item => item.mac}
          renderItem={renderItem}
          ListEmptyComponent={
             <Text style={styles.emptyText}>
                {scanning ? 'Scanning for devices...' : 'No devices found.'}
             </Text>
          }
        />
      </View>

      {connecting && (
        <View style={styles.overlay}>
          <View style={styles.overlayBox}>
            <ActivityIndicator size="large" color={COLORS.ember} />
            <Text style={styles.overlayText}>Connecting to printer...</Text>
          </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderColor: COLORS.divider,
    backgroundColor: COLORS.card,
  },
  backBtn: {
    padding: 8,
  },
  backText: {
    color: COLORS.creamMuted,
    fontSize: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.cream,
  },
  scanBtn: {
    backgroundColor: COLORS.ember,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 16,
    minWidth: 70,
    alignItems: 'center',
  },
  scanText: {
    color: '#000',
    fontWeight: '700',
    fontSize: 14,
  },
  section: {
    padding: 20,
  },
  sectionTitle: {
    fontSize: 12,
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
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  deviceName: {
    color: COLORS.cream,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  deviceMac: {
    color: COLORS.creamMuted,
    fontSize: 12,
  },
  connectText: {
    color: COLORS.ember,
    fontWeight: '700',
  },
  emptyText: {
    color: COLORS.creamMuted,
    textAlign: 'center',
    marginTop: 20,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayBox: {
    backgroundColor: COLORS.card,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
  },
  overlayText: {
    color: COLORS.cream,
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
  }
});
