import React, { useState, useEffect } from 'react';
// Only import what's needed for LoginPage itself
import { collection, query, where, getDocs, addDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { LogIn, User } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog'; // Ensure this path is correct if CustomAlertDialog is a separate file
import { signInAnonymously } from 'firebase/auth'; // <--- ADDED THIS IMPORT

const LoginPage = ({ navigate, auth, db, appId, isDbReady }) => { // Added isDbReady prop
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(''); // For registration
  const [isRegistering, setIsRegistering] = useState(false);
  const [message, setMessage] = useState('');
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');

  // Effect to set up dummy users if the collection is empty
  useEffect(() => {
    const setupDummyUsers = async () => {
      console.log('LoginPage useEffect: Attempting to setup dummy users...');
      console.log('LoginPage useEffect: db:', db ? 'initialized' : 'null', 'appId:', appId, 'isDbReady:', isDbReady);

      // Ensure db, appId, and isDbReady are available before attempting Firestore operations
      if (!db || !appId || !isDbReady) {
        console.log('LoginPage useEffect: db, appId, or isDbReady not ready, skipping dummy user setup.');
        return;
      }

      try {
        const usersRefPath = `artifacts/${appId}/public/data/users`;
        const usersRef = collection(db, usersRefPath);
        console.log('LoginPage useEffect: Querying users collection for dummy setup. Path:', usersRefPath);
        const querySnapshot = await getDocs(usersRef);

        if (querySnapshot.empty) {
          console.log("LoginPage useEffect: Users collection empty. Setting up dummy users...");
          // Add dummy member
          await addDoc(usersRef, {
            username: 'member1',
            password: 'password123',
            name: 'Alice Member',
            role: 'member',
            balance: 50.00,
            scores: [],
            eloRating: 1000,
            gamesPlayed: 0,
            firebaseAuthUid: null
          });
          // Add dummy admin
          await addDoc(usersRef, {
            username: 'admin1',
            password: 'adminpassword',
            name: 'Charlie Admin',
            role: 'admin',
            balance: 0.00,
            scores: [],
            eloRating: 1000,
            gamesPlayed: 0,
            firebaseAuthUid: null
          });
          setMessage('Dummy users created: member1/password123, admin1/adminpassword. Try logging in!');
          console.log("LoginPage useEffect: Dummy users added successfully.");
        } else {
          console.log("LoginPage useEffect: Dummy users already exist, skipping setup.");
        }
      } catch (error) {
        console.error("LoginPage useEffect: Error setting up dummy users:", error);
        setAlertMessage(`Error setting up dummy users: ${error.message}`);
        setShowAlert(true);
      }
    };

    if (db && appId && isDbReady) {
      setupDummyUsers();
    }
  }, [db, appId, isDbReady]); // Re-run effect if db, appId, or isDbReady changes

  const handleAuth = async (e) => {
    e.preventDefault();
    setMessage('');
    setAlertMessage('');

    console.log('LoginPage handleAuth: Starting authentication process...');
    console.log('LoginPage handleAuth: db:', db ? 'initialized' : 'null', 'appId:', appId, 'auth:', auth ? 'initialized' : 'null', 'isDbReady:', isDbReady);

    if (!db || !appId || !auth || !isDbReady) { // auth.currentUser might be null initially
      setAlertMessage('Application not fully initialized. Please wait and try again.');
      setShowAlert(true);
      console.error("LoginPage handleAuth: Firebase/Auth/AppId/isDbReady not ready.");
      return;
    }

    try {
      // Step 1: Ensure an anonymous Firebase Auth user exists for Firestore UID linkage
      // This is now done only when the user attempts to log in/register
      let currentAuthUser = auth.currentUser;
      if (!currentAuthUser) {
        console.log('LoginPage handleAuth: No current Firebase Auth user, signing in anonymously...');
        const userCredential = await signInAnonymously(auth);
        currentAuthUser = userCredential.user;
        console.log('LoginPage handleAuth: Signed in anonymously. UID:', currentAuthUser.uid);
      } else {
        console.log('LoginPage handleAuth: Existing Firebase Auth user. UID:', currentAuthUser.uid);
      }

      // Find the user in the public users collection
      const usersRefPath = `artifacts/${appId}/public/data/users`;
      const usersRef = collection(db, usersRefPath);
      const q = query(usersRef, where("username", "==", username));
      console.log('LoginPage handleAuth: Querying public users for login/registration. Path:', usersRefPath);
      const querySnapshot = await getDocs(q);

      let userDocRef;
      let publicUserData;

      if (isRegistering) {
        // --- Registration Logic ---
        if (!querySnapshot.empty) {
          setAlertMessage('Username already exists. Please choose a different one.');
          setShowAlert(true);
          return;
        }
        if (!name.trim()) {
          setAlertMessage('Please enter your name for registration.');
          setShowAlert(true);
          return;
        }

        console.log('LoginPage handleAuth: Registering new public user...');
        userDocRef = await addDoc(usersRef, {
          username: username,
          password: password, // In real app, hash and salt passwords!
          name: name.trim(),
          role: 'member',
          balance: 0.00,
          scores: [],
          eloRating: 1000,
          gamesPlayed: 0,
          firebaseAuthUid: currentAuthUser.uid // Link public user to current Firebase Auth UID
        });
        publicUserData = { id: userDocRef.id, username, password, name: name.trim(), role: 'member', balance: 0.00, scores: [], eloRating: 1000, gamesPlayed: 0, firebaseAuthUid: currentAuthUser.uid };
        setMessage('Registration successful! Logging you in...');
        console.log('LoginPage handleAuth: New public user registered.');

      } else {
        // --- Login Logic ---
        if (querySnapshot.empty) {
          setAlertMessage('Invalid username or password.');
          setShowAlert(true);
          return;
        }
        userDocRef = querySnapshot.docs[0].ref;
        publicUserData = querySnapshot.docs[0].data();
        publicUserData.id = querySnapshot.docs[0].id;

        if (publicUserData.password !== password) {
          setAlertMessage('Invalid username or password.');
          setShowAlert(true);
          return;
        }
        setMessage('Login successful!');
        console.log('LoginPage handleAuth: User found and password matched.');
      }

      // Update the public user document with the current Firebase Auth UID if it's missing or different
      if (publicUserData.firebaseAuthUid !== currentAuthUser.uid) {
        console.log('LoginPage handleAuth: Updating public user with current Firebase Auth UID.');
        await updateDoc(userDocRef, { firebaseAuthUid: currentAuthUser.uid });
        publicUserData.firebaseAuthUid = currentAuthUser.uid;
      }

      // Create or update the user's private profile data (linked to the Firebase Auth UID)
      const userProfileRefPath = `artifacts/${appId}/users/${currentAuthUser.uid}/profile/data`;
      const userProfileRef = doc(db, userProfileRefPath);
      console.log('LoginPage handleAuth: Setting/updating private user profile. Path:', userProfileRefPath);
      await setDoc(userProfileRef, {
        name: publicUserData.name,
        role: publicUserData.role,
        balance: publicUserData.balance,
        scores: publicUserData.scores,
        eloRating: publicUserData.eloRating || 1000,
        gamesPlayed: publicUserData.gamesPlayed || 0,
        publicId: publicUserData.id,
        username: publicUserData.username,
      }, { merge: true });
      console.log('LoginPage handleAuth: Private user profile set/updated.');

      // After successful login/registration, navigate to the appropriate dashboard
      navigate(publicUserData.role === 'admin' ? 'adminDashboard' : 'memberDashboard');

    } catch (error) {
      console.error("LoginPage handleAuth: Authentication error:", error);
      setAlertMessage(`An error occurred during authentication: ${error.message}. Please try again.`);
      setShowAlert(true);
    }
  };

  return (
    <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full transform transition-all duration-300 ease-in-out hover:scale-105">
      <h2 className="text-3xl font-bold text-blue-700 mb-6 text-center">{isRegistering ? 'Register New Member' : 'Member / Admin Login'}</h2>
      <form onSubmit={handleAuth} className="space-y-6">
        {isRegistering && (
          <div>
            <label htmlFor="name" className="block text-gray-700 text-sm font-medium mb-2">Your Name</label>
            <input
              type="text"
              id="name"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required={isRegistering}
            />
          </div>
        )}
        <div>
          <label htmlFor="username" className="block text-gray-700 text-sm font-medium mb-2">Username</label>
          <input
            type="text"
            id="username"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-gray-700 text-sm font-medium mb-2">Password</label>
          <input
            type="password"
            id="password"
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        <button
          type="submit"
          className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 px-6 rounded-xl text-lg font-semibold shadow-lg hover:from-blue-600 hover:to-indigo-700 transform hover:-translate-y-1 transition duration-300 ease-in-out"
        >
          {isRegistering ? (<><User className="inline-block mr-2" size={20} /> Register</>) : (<><LogIn className="inline-block mr-2" size={20} /> Login</>)}
        </button>
      </form>
      {message && (
        <p className={`mt-4 text-center ${message.includes('successful') ? 'text-green-600' : 'text-red-600'} font-medium`}>
          {message}
        </p>
      )}
      <button
        onClick={() => setIsRegistering(!isRegistering)}
        className="w-full mt-4 text-blue-600 hover:text-blue-800 font-medium text-sm transition duration-200 ease-in-out"
      >
        {isRegistering ? 'Already have an account? Login' : 'New member? Register here'}
      </button>
      <p className="mt-6 text-center text-sm text-gray-500">
        For testing: Member Username: <span className="font-semibold">member1</span>, Password: <span className="font-semibold">password123</span><br/>
        Admin Username: <span className="font-semibold">admin1</span>, Password: <span className="font-semibold">adminpassword</span>
      </p>
      {showAlert && (
        <CustomAlertDialog
          message={alertMessage}
          onConfirm={() => setShowAlert(false)}
          onCancel={() => setShowAlert(false)}
          confirmText="Ok"
          cancelText="Close"
        />
      )}
    </div>
  );
};

export default LoginPage;
