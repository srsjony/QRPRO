import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { COLORS } from '../constants/config';

/**
 * Catches render/lifecycle errors anywhere below it.
 *
 * Without this, an uncaught JS error in production leaves staff staring at a
 * blank screen mid-service with no way back except force-quitting the app.
 * Note that React error boundaries do not catch errors thrown inside async
 * callbacks or event handlers — those are handled where they occur.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, showDetail: false };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Keep the stack reachable from `adb logcat` for field diagnosis.
    console.error('[ErrorBoundary]', error?.message, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ error: null, showDetail: false });
  };

  render() {
    const { error, showDetail } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.icon}>⚠️</Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>
          The app hit an unexpected error. Tap below to return to the app — your saved
          restaurant and printer settings are untouched.
        </Text>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={this.handleReset}
          accessibilityRole="button"
          accessibilityLabel="Try again"
        >
          <Text style={styles.primaryText}>Try again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.detailBtn}
          onPress={() => this.setState({ showDetail: !showDetail })}
          accessibilityRole="button"
        >
          <Text style={styles.detailText}>{showDetail ? 'Hide details' : 'Show details'}</Text>
        </TouchableOpacity>

        {showDetail && (
          <ScrollView style={styles.detailBox}>
            <Text style={styles.detailBody}>{String(error?.stack || error?.message || error)}</Text>
          </ScrollView>
        )}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  icon: { fontSize: 52, marginBottom: 18 },
  title: { color: COLORS.cream, fontSize: 21, fontWeight: '800', marginBottom: 10 },
  message: {
    color: COLORS.creamMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 26,
  },
  primaryBtn: {
    backgroundColor: COLORS.ember,
    paddingHorizontal: 34,
    paddingVertical: 13,
    borderRadius: 14,
  },
  primaryText: { color: COLORS.bg, fontSize: 15, fontWeight: '800', letterSpacing: 0.5 },
  detailBtn: { marginTop: 18, padding: 8 },
  detailText: { color: COLORS.creamMuted, fontSize: 13, fontWeight: '600' },
  detailBox: {
    maxHeight: 200,
    alignSelf: 'stretch',
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  detailBody: { color: COLORS.creamMuted, fontSize: 11, lineHeight: 16 },
});
