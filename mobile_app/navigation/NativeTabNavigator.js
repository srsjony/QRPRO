import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import WebViewScreen from '../screens/WebViewScreen';
import { COLORS } from '../constants/config';

const Tab = createBottomTabNavigator();

const TABS = [
  { name: 'Dashboard', path: '/dashboard', icon: 'view-dashboard',    color: COLORS.ember  },
  { name: 'Inventory', path: '/inventory', icon: 'package-variant-closed', color: '#ef4444'  },
  { name: 'Kitchen',   path: '/kitchen_current',   icon: 'chef-hat',          color: '#f59e0b'  },
  { name: 'Billing',   path: '/billing',   icon: 'cash-register',     color: '#22c55e'  },
  { name: 'Reports',   path: '/sales_report', icon: 'chart-bar',      color: '#8b5cf6'  },
  { name: 'Profiles',  path: '/select_profile', icon: 'account-group', color: '#0ea5e9'  },
];

function TabBar({ state, descriptors, navigation }) {
  return (
    <View style={styles.tabBar}>
      {state.routes.map((rte, i) => {
        const { options } = descriptors[rte.key];
        const focused = state.index === i;
        const tab = TABS[i];
        return (
          <TouchableOpacity
            key={rte.key}
            style={styles.tabItem}
            activeOpacity={0.7}
            onPress={() => {
              if (!focused) navigation.navigate(rte.name);
            }}
          >
            {focused && (
              <View style={[styles.tabIndicator, { backgroundColor: tab.color }]} />
            )}
            <MaterialCommunityIcons
              name={tab.icon}
              size={23}
              color={focused ? tab.color : COLORS.creamMuted}
            />
            <Text style={[styles.tabLabel, focused && { color: tab.color }]}>
              {tab.name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function NativeTabNavigator({ route, navigation }) {
  const { username } = route.params || {};

  const handleLogout = async () => {
    await SecureStore.deleteItemAsync('username');
    await SecureStore.deleteItemAsync('password');
    await SecureStore.setItemAsync('remember', 'false');
    navigation.replace('Login');
  };

  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {TABS.map((tab) => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={WebViewScreen}
          initialParams={{
            title: tab.name,
            path: tab.path,
            color: tab.color,
            isMainTab: true,
          }}
        />
      ))}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
    paddingTop: 5,
    height: Platform.OS === 'ios' ? 60 : 52,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    gap: 3,
  },
  tabIndicator: {
    position: 'absolute',
    top: -9,
    width: 28,
    height: 3,
    borderRadius: 2,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.creamMuted,
    letterSpacing: 0.5,
  },
});
