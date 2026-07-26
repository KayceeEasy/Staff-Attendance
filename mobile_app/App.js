import React, { useEffect } from 'react';
import {
  StyleSheet,
  View,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert
} from 'react-native';
import { WebView } from 'react-native-webview';
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
  useEffect(() => {
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
});
