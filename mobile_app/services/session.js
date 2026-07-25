import * as SecureStore from 'expo-secure-store';
import { BASE_URL, STORAGE_KEYS } from '../constants/config';

/**
 * Clear stored credentials and drop the server-side session.
 *
 * The WebView keeps a session cookie (sharedCookiesEnabled), so wiping local
 * credentials alone would leave the user silently signed in on next launch.
 * Hitting /logout invalidates that cookie too.
 */
export async function signOut() {
  await Promise.all([
    SecureStore.deleteItemAsync(STORAGE_KEYS.username).catch(() => {}),
    SecureStore.deleteItemAsync(STORAGE_KEYS.password).catch(() => {}),
    SecureStore.setItemAsync(STORAGE_KEYS.remember, 'false').catch(() => {}),
  ]);

  try {
    await fetch(`${BASE_URL}/logout`, { method: 'GET', credentials: 'include' });
  } catch (_) {
    // Offline sign-out still clears local credentials, which is the important part.
  }
}

/** Lightweight reachability probe — avoids pulling in a native netinfo module. */
export async function isServerReachable(timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await fetch(`${BASE_URL}/`, { method: 'HEAD', signal: controller.signal });
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
