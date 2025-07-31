// src/App.js

import React, { useState, useEffect, createContext, useMemo, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut, connectAuthEmulator } from 'firebase/auth'; 
import { getFirestore, doc, getDoc, connectFirestoreEmulator } from 'firebase/firestore'; 
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions'; // <-- ADD THIS LINE
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';

// Import your page components (ensure these files exist in src/pages/)
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import MemberDashboard from './pages/MemberDashboard';
import AdminDashboard from './pages/AdminDashboard';
import MatchManagementPage from './pages/MatchManagementPage';
import LeaderboardPage from './pages/LeaderboardPage';
import { setupNotifications } from './utils/notifications'; // Add this import
// const app = initializeApp(firebaseConfig)


// --- Context for Firebase and User Data ---
const AppContext = createContext(null);

// --- MAIN APP COMPONENT ---
const App = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Reflects if user is logged in AND email is verified (or bypassed in dev)
  const [userRole, setUserRole] = useState(null); // 'member' or 'admin'
  const [userId, setUserId] = useState(null); // Firebase Auth UID
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false); // Indicates auth state has been checked
  const [isDbReady, setIsDbReady] = useState(false); // Indicates db is connected
  const [firebaseAppInstance, setFirebaseAppInstance] = useState(null); // <--- ADD THIS LINE
  const [functions, setFunctions] = useState(null); // <-- ADD THIS LINE
  const fcmMessageDisplayCallbackRef = React.useRef(null); // Ref to store the callback
  const setFcmMessageDisplayCallback = React.useCallback((callback) => {
      fcmMessageDisplayCallbackRef.current = callback;
    }, []);

  // [NEW] Add userData state here
  const [userData, setUserData] = useState(null); // To store the full user profile data

  // Your Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
  const firebaseConfig = useMemo(() => ({ // WRAP with useMemo
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
    measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID
  }), []);

  const appId = firebaseConfig.projectId; // Use the appId from your config
  const useEmulators = process.env.REACT_APP_FIREBASE_USE_FIREBASE_EMULATORS === 'true';


  // Determine if running in a local development environment
  const isLocalEnv = window.location.hostname === "localhost";

  // Initialize Firebase app, auth, and firestore
  useEffect(() => {
    try {
      console.log("firebaseConfig",firebaseConfig);
      console.log("useEmulators",process.env.REACT_APP_FIREBASE_USE_FIREBASE_EMULATORS);
      const app = initializeApp(firebaseConfig);
      const authInstance = getAuth(app);
      const dbInstance = getFirestore(app);
      const functionsInstance = getFunctions(app); // <-- GET FUNCTIONS INSTANCE

      if (useEmulators) {
        connectAuthEmulator(authInstance, "http://127.0.0.1:9099");
        connectFirestoreEmulator(dbInstance, "127.0.0.1", 8080);
        connectFunctionsEmulator(functionsInstance, "127.0.0.1", 5001); // <-- CONNECT FUNCTIONS EMULATOR
        console.log("Connected to Firebase Emulators!");
      } else {
        console.log("Connecting to live Firebase project:", firebaseConfig.projectId);
      }

      setAuth(authInstance);
      setDb(dbInstance);
      setFunctions(functionsInstance); // <-- SET FUNCTIONS INSTANCE
      setFirebaseAppInstance(app);
      setIsDbReady(true);
    } catch (e) {
      console.error("Error initializing Firebase:", e);
    }
  }, [useEmulators, firebaseConfig]);

  // Auth state listener
  useEffect(() => {
    if (auth && db) { // Ensure auth and db are initialized before setting up listener
      const unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (user) {
          setUserId(user.uid);

          // Determine if email verification is required for authentication
          const emailVerificationRequired = !isLocalEnv; // Required in prod, bypassed in local

          // Check if user is authenticated based on email verification status (or bypass if local)
          if (!emailVerificationRequired || user.emailVerified) {
            const publicUserRef = doc(db, `artifacts/${appId}/public/data/users`, user.uid);
            const userDoc = await getDoc(publicUserRef);
            if (userDoc.exists()) {
              setIsAuthenticated(true);
              const data = userDoc.data(); // Get the public user data
              setUserRole(data.role); // Set user role from public data
              setUserData(data); // [NEW] Set the full public user data to state
              console.log("App: User authenticated and profile loaded:", user.uid);
            } else {
              // User is logged in (and email verified if required), but public profile doesn't exist yet.
              // This might happen on first login after verification/registration.
              // Keep isAuthenticated false until profile is confirmed loaded/created in LoginPage.
              setIsAuthenticated(false);
              setUserRole(null);
              setUserData(null); // [NEW] Clear user data if profile is missing
              console.log("App: User logged in, email verified (if required), but public profile not found. Awaiting profile creation on login.");
            }
          } else {
            // User is logged in but email is NOT verified AND verification IS required (i.e., production)
            setIsAuthenticated(false);
            setUserRole(null);
            setUserData(null); // [NEW] Clear user data
            console.log("App: User logged in but email not verified. Setting isAuthenticated to false. (This check is bypassed in local env)");
            // In a production environment, you might want to force a sign out here
            // or redirect to an email verification page.
            // await signOut(auth); // Uncomment if you want unverified users to be immediately logged out in prod
          }
        } else {
          // No user is logged in
          setIsAuthenticated(false);
          setUserRole(null);
          setUserId(null);
          setUserData(null); // [NEW] Clear user data on logout
          console.log("App: No user logged in.");
        }
        setIsAuthReady(true); // Authentication state has been determined (ready)
      });
      return () => unsubscribe();
    }
  }, [auth, db, appId, isLocalEnv]); // Added isLocalEnv as a dependency

  // NEW useEffect for Navigation after Auth State is Ready
  useEffect(() => {
    console.log('App.js (Navigation useEffect): isAuthenticated:', isAuthenticated, 'userRole:', userRole, 'isAuthReady:', isAuthReady, 'currentPage:', currentPage);

    // Only navigate if authentication is ready, user is authenticated,
    // and we have a user role (meaning user data has been fetched)
    // and if the current page is 'login' or 'home' (pages from which you'd navigate after auth)
    if (isAuthReady && isAuthenticated && userRole && (currentPage === 'login' || currentPage === 'home')) {
      console.log('App.js (Navigation useEffect): Navigation trigger condition met. Navigating...');
      if (userRole === 'admin') {
        setCurrentPage('adminDashboard');
      } else { // 'member' or any other role
        setCurrentPage('memberDashboard');
      }
    }
  }, [isAuthenticated, userRole, isAuthReady, currentPage]); // Depend on these states

      // [NEW] Setup notifications when user is authenticated
  useEffect(() => {
      if (isAuthenticated && auth && db && userId && appId && firebaseAppInstance) {
          setupNotifications(firebaseAppInstance, auth, db, userId, appId);
      }
  }, [isAuthenticated, auth, db, userId, appId, firebaseAppInstance]);
  
  useEffect(() => {
    if (firebaseAppInstance && auth && db && userId && appId && isAuthenticated && isAuthReady) {
        // Your VAPID key (get this from Firebase Project Settings -> Cloud Messaging -> Web Push certificates)
        const VAPID_KEY = 'BHGE-JYDTyupqstVTxjxJEYvnyCMnbpvlBjRoeXAJwX6-_cw5aUUxGcocUKvbiPnL8M2-B5Uj9DhR-7XYSrnN8A'; // <--- REPLACE THIS

        setupNotifications(firebaseAppInstance, auth, db, userId, appId, VAPID_KEY, (payload) => {
            // This is the callback that setupNotifications will call when a message is received
            if (fcmMessageDisplayCallbackRef.current) {
                fcmMessageDisplayCallbackRef.current(payload);
            } else {
                console.warn("FCM message received but no display callback registered in MemberDashboard.js.");
                // Optionally, fallback to a native browser notification here if no UI is active
                if (payload.notification) {
                    new Notification(payload.notification.title || 'Notification', {
                        body: payload.notification.body,
                        icon: payload.notification.icon || '/firebase-logo.png'
                    });
                }
            }
        });
    }
  }, [firebaseAppInstance, auth, db, userId, appId, isAuthenticated, isAuthReady]);


  const navigate = (page) => {
    setCurrentPage(page);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('login'); // Redirect to login page after logout
      console.log("User logged out successfully.");
    } catch (error) {
      console.error("Error logging out:", error.message);
    }
  };

  // Determine which page component to render based on currentPage and authentication state
  let PageComponent;
  if (currentPage === 'home') {
    PageComponent = <HomePage navigate={navigate} />;
  } else if (currentPage === 'login') {
    PageComponent = <LoginPage navigate={navigate} auth={auth} db={db} appId={appId} isDbReady={isDbReady} />;
  } else if (currentPage === 'memberDashboard' && isAuthenticated && userRole === 'member') {
    PageComponent = <MemberDashboard />;
  } else if (currentPage === 'adminDashboard' && isAuthenticated && userRole === 'admin') {
    PageComponent = <AdminDashboard navigate={navigate} />;
  }
  // [MODIFIED] Allow all authenticated users (members and admins) to access MatchManagementPage
  else if (currentPage === 'matchManagement' && isAuthenticated) { // Removed userRole === 'admin'
    PageComponent = <MatchManagementPage userId={userId} db={db} appId={appId} />;
  } else if (currentPage === 'leaderboard') {
    PageComponent = <LeaderboardPage navigate={navigate} appId={appId} db={db} />;
  } else {
    if (isAuthReady && !isAuthenticated && currentPage !== 'login' && currentPage !== 'home') {
      PageComponent = <LoginPage navigate={navigate} auth={auth} db={db} appId={appId} isDbReady={isDbReady} />;
      if (currentPage !== 'login') {
        navigate('login');
      }
    } else {
      PageComponent = <HomePage navigate={navigate} />;
    }
  }

  return (
    <AppContext.Provider value={{
      db, auth, userId, functions, userRole,
      isAuthenticated, setIsAuthenticated,
      isAuthReady,
      isDbReady,
      appId,
      userData,
      setUserData
    }}>
      {!isAuthReady ? (
        <div className="flex flex-col min-h-screen bg-gray-50 font-sans items-center justify-center text-xl text-gray-700">
          <img src="/loading-spinner.gif" alt="Loading..." className="w-16 h-16 mb-4" /> {/* Optional: add a loading spinner */}
          Loading application state...
        </div>
      ) : (
        // Only render the main application structure if authentication state is ready
        <div className="flex flex-col min-h-screen bg-gray-50 font-sans">
          {/* Header/Navigation */}
          <header className="flex items-center justify-between p-4 bg-white shadow-md rounded-b-xl">
            <div className="flex items-center space-x-6">
              <h1 className="text-3xl font-extrabold text-blue-700">Smashers Badminton</h1>
              <nav className="flex items-center space-x-2">
                <button onClick={() => navigate('home')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
                  <Home className="mr-1" size={20} /> Home
                </button>

                {/* Conditional Navigation for Authenticated Users */}
                {isAuthenticated && userRole === 'member' && (
                  <button onClick={() => navigate('memberDashboard')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
                    <User className="mr-1" size={20} /> Dashboard
                  </button>
                )}
                {isAuthenticated && userRole === 'admin' && (
                  <button onClick={() => navigate('adminDashboard')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
                    <Settings className="mr-1" size={20} /> Admin
                  </button>
                )}
                {isAuthenticated && (
                  <button onClick={() => navigate('matchManagement')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
                    <Calendar className="mr-1" size={20} /> Matches
                  </button>
                )}
                {(isAuthenticated || currentPage === 'leaderboard') && (
                  <button onClick={() => navigate('leaderboard')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
                    <TrendingUp className="mr-1" size={20} /> Leaderboard
                  </button>
                )}
              </nav>
            </div>

            <nav className="flex items-center space-x-3">
              {!isAuthenticated ? (
                <button onClick={() => navigate('login')} className="flex items-center bg-blue-600 text-white px-4 py-2 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out">
                  <LogIn className="mr-1" size={20} /> Login
                </button>
              ) : (
                <button onClick={handleLogout} className="flex items-center bg-red-500 text-white px-4 py-2 rounded-lg shadow-md hover:bg-red-600 transition duration-200 ease-in-out">
                  <LogOut className="mr-1" size={20} /> Logout
                </button>
              )}
            </nav>
          </header>

          {/* Main Content Area - This is where your pages will be rendered */}
          <main className="flex-grow p-6 flex items-center justify-center">
            {/* NEW AND SIMPLIFIED PAGE COMPONENT RENDERING LOGIC */}
            {(() => {
              if (!isAuthenticated) {
                // If not authenticated, always show LoginPage (or HomePage if it's public entry)
                return <LoginPage navigate={navigate} auth={auth} db={db} appId={appId} isDbReady={isDbReady} />;
              }

              // If authenticated, render based on currentPage and userRole
              switch (currentPage) {
                case 'home':
                  // After login, 'home' might default to the user's dashboard
                  return userRole === 'admin' ? <AdminDashboard navigate={navigate} /> : <MemberDashboard />;
                case 'memberDashboard':
                  return <MemberDashboard />;
                case 'adminDashboard':
                  return <AdminDashboard navigate={navigate} />;
                case 'matchManagement':
                  return <MatchManagementPage/>;
                case 'leaderboard':
                  return <LeaderboardPage navigate={navigate} appId={appId} db={db} />;
                case 'login': // If authenticated user somehow lands on login page, redirect to home/dashboard
                  return userRole === 'admin' ? <AdminDashboard navigate={navigate} /> : <MemberDashboard />;
                default:
                  // Fallback for any unknown or unhandled page state
                  return userRole === 'admin' ? <AdminDashboard navigate={navigate} /> : <MemberDashboard />;
              }
            })()}
          </main>

          {/* Footer */}
          <footer className="bg-white shadow-inner p-4 text-center text-gray-600 text-sm rounded-t-xl mt-auto">
            &copy; 2025 Smashers Badminton. All rights reserved.
          </footer>
        </div>
      )}
    </AppContext.Provider>
  );
};

export { AppContext };
export default App;