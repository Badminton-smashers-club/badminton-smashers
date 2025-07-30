// public/firebase-messaging-sw.js
// This script is the service worker responsible for handling push notifications.

// Import and configure the Firebase SDK for the service worker context
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// !!! IMPORTANT: Replace with your actual Firebase project configuration !!!
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const app = firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Customize how messages are handled when the app is in the background/closed
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);

    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: payload.notification.icon || '/firebase-logo.png', // Ensure you have an icon file in your public folder
        data: payload.data // Pass along any custom data from the payload
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});