import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';

// --- Context for Firebase and User Data ---
const AppContext = createContext(null);

// --- UTILS (Conceptual: utils/elo.js) ---
const calculateEloChange = (playerElo, opponentElo, outcome, gamesPlayed = 0) => {
  // K-factor: Higher for newer players, lower for established players
  // This is a simplified variable K-factor. More advanced systems might use different thresholds.
  let kFactor;
  if (gamesPlayed < 10) { // New players have higher volatility
    kFactor = 40;
  } else if (playerElo < 1500) { // Mid-range players
    kFactor = 32;
  } else { // High-rated players
    kFactor = 24;
  }

  // Expected score for player A against player B
  const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  // Elo change
  const eloChange = kFactor * (outcome - expectedScore);
  return eloChange;
};

// --- COMPONENTS (Conceptual: components/CustomAlertDialog.js) ---


// --- COMPONENTS (Conceptual: components/MatchDetailsModal.js) ---


// --- COMPONENTS (Conceptual: components/RecurringSlotsModal.js) ---


// --- PAGES (Conceptual: pages/HomePage.js) ---

// --- PAGES (Conceptual: pages/LoginPage.js) ---

// --- PAGES (Conceptual: pages/MemberDashboard.js) ---

// --- PAGES (Conceptual: pages/AdminDashboard.js) ---

// --- PAGES (Conceptual: pages/MatchManagementPage.js) ---

// --- PAGES (Conceptual: pages/LeaderboardPage.js) ---

// --- MAIN APP COMPONENT (Conceptual: App.js) ---
const App = () => {
  const [currentPage, setCurrentPage] = useState('home');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState(null); // 'member' or 'admin'
  const [userId, setUserId] = useState(null); // Firebase Auth UID
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userData, setUserData] = useState(null); // Stores current user's private data from Firestore
  const [publicUserId, setPublicUserId] = useState(null); // Stores the ID of the user's public profile

  // Firebase Initialization and Authentication
  useEffect(() => {
    try {
      const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);

      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid); // Set Firebase Auth UID
          setIsAuthenticated(true);

          // Attempt to fetch user's private profile data
          const userProfileRef = doc(firestoreDb, `artifacts/${__app_id}/users/${user.uid}/profile/data`);
          const userDocSnap = await getDoc(userProfileRef);

          if (userDocSnap.exists()) {
            const data = userDocSnap.data();
            setUserData(data);
            setUserRole(data.role);
            setPublicUserId(data.publicId); // Set the ID of their public profile
            setCurrentPage(data.role === 'admin' ? 'adminDashboard' : 'memberDashboard');
          } else {
            // This case might happen if an anonymous user is signed in but hasn't "registered" yet.
            // Or if their private profile was deleted.
            // Default to member and prompt for login/registration.
            setUserRole('member');
            setUserData(null); // No private data yet
            setPublicUserId(null);
            setCurrentPage('login'); // Redirect to login/register to establish profile
          }
        } else {
          setUserId(null);
          setIsAuthenticated(false);
          setUserRole(null);
          setUserData(null);
          setPublicUserId(null);
          setCurrentPage('home'); // Go to home if logged out

          // Sign in anonymously if no token is provided (for initial setup or public access)
          if (typeof __initial_auth_token === 'undefined') {
            await signInAnonymously(firebaseAuth);
          }
        }
        setIsAuthReady(true);
      });

      // Sign in with custom token if available
      const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
      if (initialAuthToken) {
        signInWithCustomToken(firebaseAuth, initialAuthToken)
          .catch((error) => {
            console.error("Error signing in with custom token:", error);
            // Fallback to anonymous sign-in if custom token fails
            signInAnonymously(firebaseAuth);
          });
      } else {
        signInAnonymously(firebaseAuth);
      }

      return () => unsubscribe(); // Clean up auth listener
    } catch (error) {
      console.error("Error initializing Firebase:", error);
      setIsAuthReady(true); // Mark as ready even on error to avoid infinite loading
    }
  }, []);

  const navigate = (page) => {
    setCurrentPage(page);
  };

  const handleLogout = async () => {
    if (auth) {
      try {
        await signOut(auth);
        console.log("User signed out.");
        setUserId(null);
        setIsAuthenticated(false);
        setUserRole(null);
        setUserData(null);
        setPublicUserId(null);
        setCurrentPage('home');
      } catch (error) {
        console.error("Error signing out:", error);
      }
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100">
        <div className="text-xl font-semibold text-gray-700">Loading application...</div>
      </div>
    );
  }

  const renderPage = () => {
    switch (currentPage) {
      case 'home':
        return <HomePage navigate={navigate} isAuthenticated={isAuthenticated} />;
      case 'login':
        return <LoginPage navigate={navigate} auth={auth} db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} />;
      case 'memberDashboard':
        return isAuthenticated && userRole === 'member' ? <MemberDashboard userId={userId} publicUserId={publicUserId} db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} userData={userData} setUserData={setUserData} /> : <LoginPage navigate={navigate} auth={auth} db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} />;
      case 'adminDashboard':
        return isAuthenticated && userRole === 'admin' ? <AdminDashboard userId={userId} db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} /> : <LoginPage navigate={navigate} auth={auth} db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} />;
      case 'matchManagement':
        return isAuthenticated ? <MatchManagementPage userId={userId} db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} /> : <LoginPage navigate={navigate} auth={auth} db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} />;
      case 'leaderboard':
        return <LeaderboardPage db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} />;
      default:
        return <HomePage navigate={navigate} isAuthenticated={isAuthenticated} />;
    }
  };

  return (
    <AppContext.Provider value={{ db, auth, userId, isAuthenticated, userRole, userData, setUserData, appId: typeof __app_id !== 'undefined' ? __app_id : 'default-app-id' }}>
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
          {renderPage()}
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