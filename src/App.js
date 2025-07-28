import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut, connectAuthEmulator } from 'firebase/auth'; 
import { getFirestore, doc, getDoc, connectFirestoreEmulator } from 'firebase/firestore'; 
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';

// Import your page components (ensure these files exist in src/pages/)
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import MemberDashboard from './pages/MemberDashboard';
import AdminDashboard from './pages/AdminDashboard';
import MatchManagementPage from './pages/MatchManagementPage';
import LeaderboardPage from './pages/LeaderboardPage';

// --- Context for Firebase and User Data ---
const AppContext = createContext(null);

// --- MAIN APP COMPONENT ---
const App = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [isAuthenticated, setIsAuthenticated] = useState(false); // Reflects if a *full profile* is loaded
  const [userRole, setUserRole] = useState(null); // 'member' or 'admin'
  const [userId, setUserId] = useState(null); // Firebase Auth UID
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isDbReady, setIsDbReady] = useState(false); // New state to track Firestore readiness
  const [userData, setUserData] = useState(null); // Stores current user's private data from Firestore
  const [publicUserId, setPublicUserId] = useState(null); // Stores the ID of the user's public profile
  const [appId, setAppId] = useState(null); // State to hold the Firebase Project ID

  // Firebase Initialization and Authentication
  useEffect(() => {
    try {
      const firebaseConfig = {
        apiKey: "AIzaSyDKwvLR1ytSmKcl_Dw7CP09clBYw_xouEE",
        authDomain: "smashers-badminton.firebaseapp.com",
        projectId: "smashers-badminton",
        storageBucket: "smashers-badminton.firebasestorage.app",
        messagingSenderId: "743415345915",
        appId: "1:743415345915:web:d8d04bcdce55b8848db65e",
        measurementId: "G-MBDWPN0VNP" // Optional, if you use Analytics
      };

      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);

      // Connect to Firebase Emulators if running locally
      if (window.location.hostname === "localhost") {
        connectFirestoreEmulator(firestoreDb, 'localhost', 8080);
        connectAuthEmulator(firebaseAuth, 'http://localhost:9099');
        console.log("App.js: Connected to Firebase Emulators.");
      }

      setDb(firestoreDb);
      setAuth(firebaseAuth);
      setAppId(firebaseConfig.projectId);
      setIsDbReady(true);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          console.log("App.js: onAuthStateChanged - Firebase Auth User IS authenticated. UID:", user.uid);
          setUserId(user.uid); 

          const userProfileRef = doc(firestoreDb, `artifacts/${firebaseConfig.projectId}/users/${user.uid}/profile/data`);
          let userDocSnap;
          try {
              userDocSnap = await getDoc(userProfileRef);
          } catch (readError) {
              console.error("App.js: Error reading user profile document:", readError);
              userDocSnap = { exists: () => false };
          }

          if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            console.log("App.js: User profile EXISTS. Navigating to:", data.role === 'admin' ? 'adminDashboard' : 'memberDashboard');
            setUserData(data);
            setUserRole(data.role);
            setPublicUserId(data.publicId);
            setIsAuthenticated(true); // Set true only if a full profile exists
            setCurrentPage(data.role === 'admin' ? 'adminDashboard' : 'memberDashboard');
          } else {
            console.log("App.js: User profile DOES NOT EXIST. Navigating to login page to create profile.");
            setUserData(null);
            setUserRole(null); // Explicitly set to null if no profile
            setPublicUserId(null);
            setIsAuthenticated(false); // Explicitly set false if no profile
            setCurrentPage('login');
          }
        } else {
          console.log("App.js: onAuthStateChanged - No Firebase Auth user authenticated. Navigating to login page.");
          setUserId(null);
          setIsAuthenticated(false);
          setUserRole(null);
          setUserData(null);
          setPublicUserId(null);
          setCurrentPage('login');
        }
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    }
    catch (error) {
      console.error("App.js: Error initializing Firebase:", error);
      setIsAuthReady(true);
    }
  }, []);

  const navigate = (page) => {
    setCurrentPage(page);
  };

  const handleLogout = async () => {
    if (auth) {
      try {
        await signOut(auth);
        console.log("App.js: User signed out.");
        setUserId(null);
        setIsAuthenticated(false);
        setUserRole(null);
        setUserData(null);
        setPublicUserId(null);
        setCurrentPage('home');
      } catch (error) {
        console.error("App.js: Error signing out:", error);
      }
    }
  };

  // Wait for both auth and DB to be ready before rendering the main app
  if (!isAuthReady || !isDbReady || appId === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-xl font-semibold text-gray-700">Loading application...</div>
      </div>
    );
  }

  // Render the selected PageComponent based on currentPage state
  let PageComponent;
  switch (currentPage) {
    case 'home':
      PageComponent = <HomePage navigate={navigate} isAuthenticated={isAuthenticated} />;
      break;
    case 'login':
      PageComponent = <LoginPage navigate={navigate} auth={auth} db={db} appId={appId} isDbReady={isDbReady} />;
      break;
    case 'memberDashboard':
      // Only show dashboard if isAuthenticated is true (meaning full profile exists) and role matches
      PageComponent = isAuthenticated && userRole === 'member' ? <MemberDashboard userId={userId} publicUserId={publicUserId} db={db} appId={appId} userData={userData} setUserData={setUserData} /> : <LoginPage navigate={navigate} auth={auth} db={db} appId={appId} isDbReady={isDbReady} />;
      break;
    case 'adminDashboard':
      // Only show dashboard if isAuthenticated is true (meaning full profile exists) and role matches
      PageComponent = isAuthenticated && userRole === 'admin' ? <AdminDashboard userId={userId} db={db} appId={appId} /> : <LoginPage navigate={navigate} auth={auth} db={db} appId={appId} isDbReady={isDbReady} />;
      break;
    case 'matchManagement':
      // Only allow access if isAuthenticated is true (meaning full profile exists)
      PageComponent = isAuthenticated ? <MatchManagementPage userId={userId} db={db} appId={appId} /> : <LoginPage navigate={navigate} auth={auth} db={db} appId={appId} isDbReady={isDbReady} />;
      break;
    case 'leaderboard':
      PageComponent = <LeaderboardPage db={db} appId={appId} />;
      break;
    default:
      PageComponent = <HomePage navigate={navigate} isAuthenticated={isAuthenticated} />;
  }


  return (
    <AppContext.Provider value={{ db, auth, userId, isAuthenticated, userRole, userData, setUserData, appId: appId }}>
      <div className="min-h-screen bg-gradient-to-br from-blue-100 to-purple-100 font-inter flex flex-col">
        {/* Header */}
        <header className="bg-white shadow-md p-4 flex items-center justify-between rounded-b-xl">
          <h1 className="text-3xl font-bold text-blue-800 flex items-center">
            <Trophy className="mr-2 text-yellow-500" size={32} />
            Smashers Badminton
          </h1>
          <nav className="flex space-x-4">
            <button onClick={() => navigate('home')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
              <Home className="mr-1" size={20} /> Home
            </button>
            {/* Conditionally render dashboard links based on isAuthenticated and userRole */}
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
            {/* Matches and Leaderboard might be accessible to unauthenticated users depending on rules, but currently they also require isAuthenticated *before* a full profile is loaded, which is incorrect.  They should also be guarded by isAuthenticated for consistency */}
            {isAuthenticated && (
              <button onClick={() => navigate('matchManagement')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
                <Trophy className="mr-1" size={20} /> Matches
              </button>
            )}
            {isAuthenticated && (
              <button onClick={() => navigate('leaderboard')} className="flex items-center text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-lg transition duration-200 ease-in-out hover:bg-blue-50">
                <TrendingUp className="mr-1" size={20} /> Leaderboard
              </button>
            )}
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

        {/* Main Content Area */}
        <main className="flex-grow p-6 flex items-center justify-center">
          {PageComponent} {/* Render the selected PageComponent */}
        </main>

        {/* Footer */}
        <footer className="bg-white shadow-inner p-4 text-center text-gray-600 text-sm rounded-t-xl mt-auto">
          &copy; {new Date().getFullYear()} Smashers Badminton Group. All rights reserved.
        </footer>
      </div>
    </AppContext.Provider>
  );
};

export default App;