// src/utils/notifications.js
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore'; // Assuming Firestore is initialized via app or directly passed
import React, { createContext, useContext } from 'react';
/**
 * Sets up Firebase Cloud Messaging (FCM) notifications.
 *
 * @param {object} app The Firebase app instance.
 * @param {object} auth The Firebase auth instance.
 * @param {object} db The Firestore instance.
 * @param {string} userId The current user's ID.
 * @param {string} appId The application ID.
 * @param {string} vapidKey Your Firebase project's VAPID key.
 * @param {function} onMessageReceivedCallback Callback function to handle incoming messages in the foreground.
 * It will receive ({ notification, data }) payload. This callback will be provided by MemberDashboard.js.
 */
export const setupNotifications = async (app, auth, db, userId, appId, vapidKey, onMessageReceivedCallback) => {
    // Check for Service Worker and Notification API support
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
        console.warn("Notifications or Service Workers not fully supported in this browser.");
        return;
    }

    if (!userId) {
        console.log("FCM setup: userId is not available yet.");
        return; // Wait for userId to be available
    }

    const messaging = getMessaging(app);

    try {
        // Request permission from the user
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log("Notification permission granted.");

            // Get FCM registration token. This token is unique to the device/browser.
            const currentToken = await getToken(messaging, { vapidKey: vapidKey });

            if (currentToken) {
                console.log("FCM Registration Token:", currentToken);
                // Save the token to Firestore for the current user's private profile
                if (db && userId) {
                    const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
                    await updateDoc(userProfileRef, {
                        fcmToken: currentToken,
                        fcmTokenLastUpdated: new Date()
                    });
                    console.log("FCM token saved to user profile.");
                }
            } else {
                console.log('No registration token available. Request permission to generate one.');
            }
        } else {
            console.warn("Notification permission denied.");
        }
    } catch (error) {
        console.error("Error setting up notifications:", error);
    }

    // Handle incoming messages when the app is in the foreground
    // This now uses the provided callback from App.js/MemberDashboard.js
    onMessage(messaging, (payload) => {
        console.log('FCM Message received in foreground (via utils/notifications): ', payload);
        if (onMessageReceivedCallback && typeof onMessageReceivedCallback === 'function') {
            onMessageReceivedCallback(payload);
        } else {
            // Fallback for debugging, if callback isn't provided/valid, use native browser notification
            console.warn("onMessageReceivedCallback not provided or invalid. Displaying basic alert.");
            if (payload.notification) {
                new Notification(payload.notification.title || 'Notification', {
                    body: payload.notification.body,
                    icon: payload.notification.icon || '/firebase-logo.png'
                });
            }
        }
    });
};

// This provider is not strictly needed anymore if App.js is handling FCM init.
// However, if you have other uses for a NotificationContext (e.g., a custom toast
// system that's not the AlertDialog), you could keep it for those.
// For now, let's assume setupNotifications is used directly by App.js.
// If your App.js imports NotificationProvider and wraps children with it,
// keep this part as a minimal placeholder.


const NotificationContext = createContext(null);

export const NotificationProvider = ({ children }) => {
    // This provider will just pass down null for now, as message state is in MemberDashboard
    return (
        <NotificationContext.Provider value={null}>
            {children}
        </NotificationContext.Provider>
    );
};

export const useNotification = () => {
    return useContext(NotificationContext); // Returns null, as it's not providing setters
};