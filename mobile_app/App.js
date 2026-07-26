import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Platform
} from 'react-native';
import { WebView } from 'react-native-webview';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';

// Configuration
const PWA_URL = 'https://kayceeeasy.github.io/Staff-Attendance/';
const OFFICE_LAT = 6.4518631;
const OFFICE_LON = 3.5277863;
const GEOFENCE_RADIUS_METERS = 100;
const BACKGROUND_GEOFENCE_TASK = 'BACKGROUND_GEOFENCE_TASK';

// Configure Notifications
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

if (Platform.OS === 'android') {
  Notifications.setNotificationChannelAsync('default', {
    name: 'Office Attendance',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#10b981',
  });
}

// Register Background Geofencing Task
TaskManager.defineTask(BACKGROUND_GEOFENCE_TASK, async ({ data: { eventType, region }, error }) => {
  if (error) {
    console.warn('Background Location Error:', error.message);
    return;
  }
  if (eventType === Location.GeofencingEventType.Enter) {
    try {
      const lastActionDate = await SecureStore.getItemAsync('last_action_date');
      const todayStr = new Date().toISOString().split('T')[0];
      
      if (lastActionDate !== todayStr) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "📍 Arrived at Office!",
            body: "You've entered the office area. Click to sign in now!",
            data: { action: 'SIGN_IN' },
            channelId: 'default',
          },
          trigger: null,
        });
      }
    } catch (e) {
      console.warn('Notification trigger error:', e);
    }
  }
});

export default function App() {
  const webViewRef = useRef(null);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    // Listen for network connection changes and auto-recover WebView when back online
    const unsubscribe = NetInfo.addEventListener((state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsConnected((prev) => {
        if (!prev && online) {
          // Auto-reload WebView as soon as device returns online
          setTimeout(() => {
            webViewRef.current?.reload();
          }, 500);
        }
        return online;
      });
    });

    (async () => {
      // 1. Request Foreground & Background Location Permissions
      const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
      if (fgStatus === 'granted') {
        const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
        if (bgStatus === 'granted') {
          startBackgroundGeofencing();
        }
      }

      // 2. Request Push Notification Permissions & Schedule Evening Reminder
      const { status: notifStatus } = await Notifications.requestPermissionsAsync();
      if (notifStatus === 'granted') {
        scheduleEveningSignOutReminder();
      }
    })();

    return () => unsubscribe();
  }, []);

  const startBackgroundGeofencing = async () => {
    try {
      const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_GEOFENCE_TASK);
      if (!isRegistered) {
        await Location.startGeofencingAsync(BACKGROUND_GEOFENCE_TASK, [{
          latitude: OFFICE_LAT,
          longitude: OFFICE_LON,
          radius: GEOFENCE_RADIUS_METERS,
          notifyOnEnter: true,
          notifyOnExit: false,
        }]);
      }
    } catch (e) {
      console.warn('Could not start background geofencing:', e.message);
    }
  };

  const scheduleEveningSignOutReminder = async () => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "🔔 Sign-Out Reminder",
          body: "Office hours are concluding. Don't forget to sign out before leaving!",
          data: { action: 'SIGN_OUT' },
          channelId: 'default',
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 16,
          minute: 45,
        },
      });
    } catch (e) {
      console.warn('Could not schedule sign-out reminder:', e);
    }
  };

  const handleWebViewMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data || '{}');
      if (data.type === 'OFFLINE_SYNC_SUCCESS') {
        const actionText = data.action === 'IN' ? 'Sign-In' : 'Sign-Out';
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "🟢 Offline Attendance Synced",
            body: `Your ${actionText} record for ${data.name || 'staff'} has been updated live!`,
            data: { action: data.action },
            channelId: 'default',
          },
          trigger: null,
        });
      }
    } catch (e) {
      console.warn('WebView message error:', e);
    }
  };

  const renderOfflineFallback = () => (
    <View style={styles.offlineContainer}>
      <Text style={styles.offlineEmoji}>📶</Text>
      <Text style={styles.offlineTitle}>Connection Disconnected</Text>
      <Text style={styles.offlineSub}>
        No active internet connection. The app will automatically refresh and reconnect as soon as your signal returns.
      </Text>
      <TouchableOpacity 
        style={styles.retryButton} 
        onPress={() => webViewRef.current?.reload()}
        activeOpacity={0.8}
      >
        <Text style={styles.retryText}>🔄 Retry Connection</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Immersive Full Screen Status Bar */}
      <StatusBar 
        barStyle="light-content" 
        backgroundColor="transparent" 
        translucent={true} 
        hidden={true} 
      />
      <WebView
        ref={webViewRef}
        source={{ uri: PWA_URL }}
        style={styles.webview}
        userAgent="LifecardApp/1.0 (MobileNative)"
        injectedJavaScript="window.isNativeMobileApp = true; true;"
        javaScriptEnabled={true}
        domStorageEnabled={true}
        geolocationEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        allowsInlineMediaPlayback={true}
        onMessage={handleWebViewMessage}
        renderError={renderOfflineFallback}
        onPermissionRequest={(event) => {
          event.grant();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  offlineContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  offlineEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  offlineTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  offlineSub: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
  },
  retryText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
});
