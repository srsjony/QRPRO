import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebViewScreen from '../screens/WebViewScreen';
import { COLORS } from '../constants/config';

const Tab = createBottomTabNavigator();

const TABS = [
  { name: 'Dashboard', path: '/dashboard', icon: 'view-dashboard', color: COLORS.ember },
  { name: 'Inventory', path: '/inventory', icon: 'package-variant-closed', color: '#ef4444' },
  { name: 'Kitchen', path: '/kitchen_current', icon: 'chef-hat', color: '#f59e0b' },
  { name: 'Billing', path: '/billing', icon: 'cash-register', color: '#22c55e' },
  { name: 'Reports', path: '/sales_report', icon: 'chart-bar', color: '#8b5cf6' },
  { name: 'Profiles', path: '/select_profile', icon: 'account-group', color: '#0ea5e9' },
];

const TAB_BY_NAME = TABS.reduce((acc, tab) => ({ ...acc, [tab.name]: tab }), {});

function TabBar({ state, navigation }) {
  // edgeToEdgeEnabled is on, so the bar has to clear the system nav bar itself.
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 4) }]}>
      {state.routes.map((rte, i) => {
        const focused = state.index === i;
        // Look up by route name rather than index so the two lists cannot drift.
        const tab = TAB_BY_NAME[rte.name] || TABS[i];

        return (
          <TouchableOpacity
            key={rte.key}
            style={styles.tabItem}
            activeOpacity={0.7}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={tab.name}
            onPress={() => {
              if (focused) {
                // Tapping the active tab reloads it — handy after editing data.
                navigation.emit({ type: 'tabPress', target: rte.key, canPreventDefault: true });
              } else {
                navigation.navigate(rte.name);
              }
            }}
          >
            {focused && <View style={[styles.tabIndicator, { backgroundColor: tab.color }]} />}
            <MaterialCommunityIcons
              name={tab.icon}
              size={23}
              color={focused ? tab.color : COLORS.creamMuted}
            />
            <Text style={[styles.tabLabel, focused && { color: tab.color }]}>{tab.name}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function NativeTabNavigator({ route }) {
  const { username } = route.params || {};

  return (
    <Tab.Navigator
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, lazy: true }}
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
            username,
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
    paddingTop: 5,
    minHeight: Platform.OS === 'ios' ? 60 : 52,
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
