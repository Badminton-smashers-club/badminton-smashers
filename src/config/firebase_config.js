// src/config/firebaseConfig.js (new file)
const getFirebaseConfig = () => {
    if (process.env.REACT_APP_ENV === 'development') {
      return {
        apiKey: process.env.REACT_APP_FIREBASE_API_KEY_DEV,
        authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN_DEV,
        projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID_DEV,
        // ... other dev config
      };
    } else if (process.env.REACT_APP_ENV === 'production') {
      return {
        apiKey: process.env.REACT_APP_FIREBASE_API_KEY_PROD,
        authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN_PROD,
        projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID_PROD,
        // ... other prod config
      };
    } else { // Default to local emulators if no specific env set
      return { /* your local emulator config, or just the prod config if emulators are connected */ };
    }
  };
  export const firebaseConfig = getFirebaseConfig();
  
  // In your App.js:
  // import { firebaseConfig } from './config/firebaseConfig';
  // const app = initializeApp(firebaseConfig);