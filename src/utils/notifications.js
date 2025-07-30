// src/utils/notifications.js
import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore';

// Call this function early in your App, e.g., in App.js after Firebase init
export const setupNotifications = async (app, auth, db, userId, appId) => {
    // Check for Service Worker and Notification API support
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
        console.warn("Notifications or Service Workers not fully supported in this browser.");
        return;
    }

    const messaging = getMessaging(app);

    try {
        // Request permission from the user
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log("Notification permission granted.");

            // Get FCM registration token. This token is unique to the device/browser.
            const currentToken = await getToken(messaging, {
                // !!! IMPORTANT: Replace with your actual Web Push Certificates VAPID key !!!
                vapidKey: 'BHGE-JYDTyupqstVTxjxJEYvnyCMnbpvlBjRoeXAJwX6-_cw5aUUxGcocUKvbiPnL8M2-B5Uj9DhR-7XYSrnN8A'
            });

            if (currentToken) {
                console.log("FCM Registration Token:", currentToken);
                // Save the token to Firestore for the current user's private profile
                if (db && userId) {
                    const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
                    await updateDoc(userProfileRef, {
                        fcmToken: currentToken,
                        fcmTokenLastUpdated: new Date() // Optional: track when token was last updated
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
    onMessage(messaging, (payload) => {
        console.log('Message received. ', payload);
        // Customize how the notification is displayed when the app is active
        const notificationTitle = payload.notification.title;
        const notificationOptions = {
            body: payload.notification.body,
            icon: payload.notification.icon || '/firebase-logo.png' // Ensure you have an icon in your public folder
        };
        new Notification(notificationTitle, notificationOptions);
    });
};