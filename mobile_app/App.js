import React, { useEffect, useState, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  Platform,
  ScrollView,
  RefreshControl
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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshEnabled, setRefreshEnabled] = useState(true);

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
        try {
          const savedScheduleStr = await SecureStore.getItemAsync('staff_schedule');
          if (savedScheduleStr) {
            const savedSchedule = JSON.parse(savedScheduleStr);
            await scheduleSignOutRemindersForWeek(savedSchedule);
          } else {
            await scheduleSignOutRemindersForWeek(null);
          }
        } catch (e) {
          console.warn('Could not load saved schedule on startup, using default:', e);
          await scheduleSignOutRemindersForWeek(null);
        }
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

  const scheduleSignOutRemindersForWeek = async (schedule) => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      
      let finalSchedule = schedule;
      if (!finalSchedule || typeof finalSchedule !== 'object') {
        // Fallback: Default to standard Monday-Friday office schedule
        finalSchedule = {
          'Monday': 'Office',
          'Tuesday': 'Office',
          'Wednesday': 'Office',
          'Thursday': 'Office',
          'Friday': 'Office'
        };
      }

      const dayMapping = {
        'Monday': 2,
        'Tuesday': 3,
        'Wednesday': 4,
        'Thursday': 5,
        'Friday': 6
      };

      let scheduledCount = 0;
      for (const [dayName, locationVal] of Object.entries(finalSchedule)) {
        const isOffice = String(locationVal || '').trim().toLowerCase() === 'office';
        const weekdayIndex = dayMapping[dayName];
        
        if (isOffice && weekdayIndex) {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: "🔔 Sign-Out Reminder",
              body: "Office hours are concluding. Don't forget to sign out before leaving!",
              data: { action: 'SIGN_OUT' },
              channelId: 'default',
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
              weekday: weekdayIndex,
              hour: 16,
              minute: 45,
            },
          });
          scheduledCount++;
        }
      }
      console.log(`Scheduled ${scheduledCount} office-day weekly sign-out reminders.`);
    } catch (e) {
      console.warn('Could not schedule weekly sign-out reminders:', e);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    webViewRef.current?.reload();
  };

  const handleScroll = (event) => {
    const y = event.nativeEvent.contentOffset.y;
    setRefreshEnabled(y <= 0);
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
      } else if (data.type === 'UPDATE_SCHEDULE') {
        if (data.name && data.schedule) {
          await SecureStore.setItemAsync('staff_name', data.name);
          await SecureStore.setItemAsync('staff_schedule', JSON.stringify(data.schedule));
          await scheduleSignOutRemindersForWeek(data.schedule);
        } else {
          await SecureStore.deleteItemAsync('staff_name');
          await SecureStore.deleteItemAsync('staff_schedule');
          await scheduleSignOutRemindersForWeek(null);
        }
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
      <ScrollView
        contentContainerStyle={styles.scrollViewContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            enabled={refreshEnabled}
            progressViewOffset={Platform.OS === 'ios' ? 0 : 30}
            colors={['#10b981']}
            tintColor="#10b981"
          />
        }
      >
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
          onScroll={handleScroll}
          onLoadEnd={() => setRefreshing(false)}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollViewContent: {
    flex: 1,
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
