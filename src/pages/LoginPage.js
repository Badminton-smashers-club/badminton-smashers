// src/pages/LoginPage.js
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, doc, setDoc } from 'firebase/firestore';
import { LogIn, User, Eye, EyeOff, Send } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog';
// Import Firebase Auth methods
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  sendPasswordResetEmail
} from 'firebase/auth';

const LoginPage = ({ navigate, auth, db, appId, isDbReady }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [message, setMessage] = useState('');
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showResendVerification, setShowResendVerification] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [showForgotPasswordInput, setShowForgotPasswordInput] = useState(false); // New state
  const [forgotPasswordEmail, setForgotPasswordEmail] = useState(''); // New state
  const [isSendingResetEmail, setIsSendingResetEmail] = useState(false); // New state

  useEffect(() => {
    setEmail('');
    setPassword('');
    setName('');
    setMessage('');
    setAlertMessage('');
    setShowAlert(false);
    setShowResendVerification(false);
    setResendCooldown(0);
    setShowForgotPasswordInput(false); // Add this line
    setForgotPasswordEmail(''); // Add this line
    setIsSendingResetEmail(false); // Add this line
  }, [isRegistering]);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setTimeout(() => {
        setResendCooldown(prev => prev - 1);
      }, 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);


  const handleSubmit = async (e) => {
    e.preventDefault();
    console.log("handleSubmit triggered!");
    console.log("isRegistering:", isRegistering);
    console.log("auth:", auth);
    console.log("db:", db);
    console.log("isDbReady:", isDbReady);

    setMessage('');
    setAlertMessage('');
    setShowResendVerification(false);

    if (!auth || !db || !isDbReady) {
      console.error("Firebase not ready. Auth:", auth, "DB:", db, "isDbReady:", isDbReady);
      setAlertMessage('Firebase is not ready. Please try again in a moment. Ensure Firebase config is correct in App.js.');
      setShowAlert(true);
      return;
    }

    if (isRegistering) {
      console.log("Handling Registration...");
      if (!name.trim()) {
        setAlertMessage('Name cannot be empty.');
        setShowAlert(true);
        return;
      }

      setIsCheckingName(true); // <--- ADD THIS LINE: Start checking name
      try {
        // [NEW] 1. Check if username already exists
        const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
        const q = query(usersRef, where("name", "==", name.trim())); // Use trim() for consistency
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
          setAlertMessage('Error: This display name is already taken. Please choose a different one.');
          setShowAlert(true);
          setIsCheckingName(false); // <--- ADD THIS LINE: Stop checking name on error
          return; // Stop registration if name is taken
        }
        // console.log("Attempting to check for existing user by email...");
        // const q = query(collection(db, `artifacts/${appId}/public/data/users`), where("email", "==", email));
        // const querySnapshot = await getDocs(q);
        // console.log("Firestore query for existing user completed. Snapshot empty:", querySnapshot.empty); // <--- NEW DEBUG LOG
        // if (!querySnapshot.empty) {
        //   setAlertMessage('An account with this email already exists.');
        //   setShowAlert(true);
        //   return;
        // }
        // console.log("No existing user found. Proceeding to create user...");

        const userCred = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCred.user;
        console.log("User created in Auth:", user.uid);

        const isLocalEnv = window.location.hostname === "localhost";
        if (user && !user.emailVerified && !isLocalEnv) {
            console.log("Sending verification email...");
            await sendEmailVerification(user);
            console.log("Verification email sent to:", user.email);
        } else if (isLocalEnv) {
            console.log("Skipping email verification in local environment.");
        }

        console.log("Creating public user profile in Firestore...");
        console.log("App ID:", appId);
        console.log("User ID:", user.uid);
        const publicUserRef = doc(db, `artifacts/${appId}/public/data/users`, user.uid);
        await setDoc(publicUserRef, {
          name: name.trim(),
          role: 'member',
          createdAt: new Date(),
          firebaseAuthUid: user.uid,
          registrationFeePending: 4, // Set pending fee
          eloRating: 1000,
          scores: []
        });
        console.log("Public profile created.");

        console.log("Creating private user profile in Firestore...");
        const userProfileRef = doc(db, `artifacts/${appId}/users/${user.uid}/profile/data`);
        await setDoc(userProfileRef, {
          firebaseAuthUid: user.uid,
          name: name.trim(),
          email: email,
          registrationFeePending: 4, // Set pending fee
          scores: [],
          eloRating: 1000,
          gamesPlayed: 0,
        });
        console.log("Private profile created.");

        if (!isLocalEnv) {
            console.log("Signing out after registration (production flow)...");
            await signOut(auth);
        } else {
            console.log("Staying signed in after registration (local flow)...");
        }

        setAlertMessage('Registration successful. Please confirm your email ID to login.');
        setShowAlert(true);
        setIsRegistering(false);
        setEmail('');
        setPassword('');
        setName('');
        console.log("Registration process completed successfully.");

      } catch (error) {
        console.error("Registration error caught:", error.code, error.message);
        if (error.code === 'auth/email-already-in-use') {
          setAlertMessage('This email is already registered. Please try logging in or use a different email.');
        } else if (error.code === 'auth/weak-password') {
          setAlertMessage('Password should be at least 6 characters.');
        } else {
          setAlertMessage('Registration failed: ' + error.message);
        }
        setShowAlert(true);
      }
      finally {
        setIsCheckingName(false); // <--- ADD THIS LINE: Always stop checking name
      }
    } else {
      console.log("Handling Login...");
      try {
        await signInWithEmailAndPassword(auth, email, password);
        console.log("Login attempt successful. App.js will handle further authentication state.");

      } catch (error) {
        console.error("Login error caught:", error.code, error.message);
        const isLocalEnv = window.location.hostname === "localhost";

        if (error.code === 'auth/email-not-verified' && !isLocalEnv) {
            setAlertMessage('Your email address has not been verified. Please check your inbox or resend the verification email.');
            setShowResendVerification(true);
        } else if (
            error.code === 'auth/invalid-email' ||
            error.code === 'auth/user-disabled' ||
            error.code === 'auth/user-not-found' ||
            error.code === 'auth/wrong-password' ||
            (error.code === 'auth/email-not-verified' && isLocalEnv)
        ) {
            setAlertMessage('Invalid username or password.');
        } else {
            setAlertMessage('Login failed: An unexpected error occurred. Please try again.');
        }
        setShowAlert(true);
      }
    }
  };

  const handleResendVerification = async () => {
    setMessage('');
    setAlertMessage('');
    if (!auth || !auth.currentUser) {
        setAlertMessage('No user logged in to resend verification email.');
        setShowAlert(true);
        return;
    }
    if (resendCooldown > 0) {
        setAlertMessage(`Please wait ${resendCooldown} seconds before resending.`);
        setShowAlert(true);
        return;
    }

    try {
        await sendEmailVerification(auth.currentUser);
        setAlertMessage('Verification email sent! Please check your inbox (and spam folder).');
        setShowAlert(true);
        setResendCooldown(60);
        setShowResendVerification(false);
    } catch (error) {
        console.error("Error resending verification email:", error);
        setAlertMessage('Failed to send verification email. Please try again later.');
        setShowAlert(true);
    }
  };
  const handleForgotPassword = async () => {
    setMessage('');
    setAlertMessage('');
    if (!forgotPasswordEmail.trim()) {
      setAlertMessage('Please enter your email address to reset your password.');
      setShowAlert(true);
      return;
    }
    if (!auth) {
      setAlertMessage('Firebase Auth is not ready. Please try again.');
      setShowAlert(true);
      return;
    }

    setIsSendingResetEmail(true); // Start loading state
    try {
      await sendPasswordResetEmail(auth, forgotPasswordEmail);
      setAlertMessage('Password reset email sent! Please check your inbox (and spam folder).');
      setShowAlert(true);
      setShowForgotPasswordInput(false); // Hide input after sending
      setForgotPasswordEmail(''); // Clear email
    } catch (error) {
      console.error("Error sending password reset email:", error);
      if (error.code === 'auth/user-not-found') {
        setAlertMessage('No account found with that email address.');
      } else if (error.code === 'auth/invalid-email') {
        setAlertMessage('Please enter a valid email address.');
      } else {
        setAlertMessage('Failed to send password reset email. Please try again later.');
      }
      setShowAlert(true);
    } finally {
      setIsSendingResetEmail(false); // End loading state
    }
  };

  return (
    <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full transform transition-all duration-300 ease-in-out hover:scale-105">
      <h2 className="text-3xl font-bold text-blue-700 mb-6 text-center">
        {isRegistering ? 'Register' : 'Login'}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        {isRegistering && (
          <div>
            <label htmlFor="name" className="block text-gray-700 text-sm font-bold mb-2">
              Name
            </label>
            <input
              type="text"
              id="name"
              className="shadow appearance-none border rounded-xl w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ease-in-out"
              placeholder="Your Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required={isRegistering}
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="block text-gray-700 text-sm font-bold mb-2">
            Email
          </label>
          <input
            type="email"
            id="email"
            className="shadow appearance-none border rounded-xl w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ease-in-out"
            placeholder="Email Address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-gray-700 text-sm font-bold mb-2">
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              id="password"
              className="shadow appearance-none border rounded-xl w-full py-3 px-4 pr-10 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ease-in-out"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-500 hover:text-gray-700"
            >
              {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
            </button>
          </div>
        </div>
        <button
          type="submit"
          className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 px-6 rounded-xl text-lg font-semibold shadow-lg hover:from-blue-600 hover:to-indigo-700 transform hover:-translate-y-1 transition duration-300 ease-in-out"
          disabled={!isDbReady || !auth || isCheckingName} // <--- ADD THIS LINE
        >
          {isCheckingName ? ( // <--- ADD THIS BLOCK FOR LOADING STATE
            <>
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Checking Name...
            </>
          ) : (
            isRegistering ? (
              <>
                <User className="inline-block mr-2" size={20} /> Register
              </>
            ) : (
              <>
                <LogIn className="inline-block mr-2" size={20} /> Login
              </>
            )
          )}
        </button>
      </form>
      {!isRegistering && ( // Only show in login mode
        <div className="mt-4 text-center">
          {!showForgotPasswordInput ? (
            <button
              onClick={() => {
                setShowForgotPasswordInput(true);
                setForgotPasswordEmail(email); // Pre-fill with existing email if available
              }}
              className="text-blue-600 hover:text-blue-800 font-medium text-sm transition duration-200 ease-in-out"
            >
              Forgot Password?
            </button>
          ) : (
            <div className="flex flex-col items-center space-y-3 mt-4">
              <input
                type="email"
                className="shadow appearance-none border rounded-xl w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 transition duration-200 ease-in-out"
                placeholder="Enter your email for reset"
                value={forgotPasswordEmail}
                onChange={(e) => setForgotPasswordEmail(e.target.value)}
                autoFocus
              />
              <button
                onClick={handleForgotPassword}
                disabled={isSendingResetEmail || !forgotPasswordEmail.trim()}
                className="w-full bg-indigo-500 text-white py-2 px-4 rounded-lg shadow-md hover:bg-indigo-600 transition duration-200 ease-in-out flex items-center justify-center"
              >
                {isSendingResetEmail ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2" size={20} /> Send Reset Email
                  </>
                )}
              </button>
              <button
                onClick={() => setShowForgotPasswordInput(false)}
                className="text-gray-600 hover:text-gray-800 font-medium text-sm transition duration-200 ease-in-out mt-2"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
      {message && (
        <p className={`mt-4 text-center ${message.includes('successful') ? 'text-green-600' : 'text-red-600'} font-medium`}>
          {message}
        </p>
      )}

      {showResendVerification && (
          <button
            onClick={handleResendVerification}
            disabled={resendCooldown > 0}
            className={`w-full mt-4 flex items-center justify-center py-2 px-4 rounded-lg shadow-md transition duration-200 ease-in-out ${
                resendCooldown > 0
                ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
                : 'bg-yellow-500 text-white hover:bg-yellow-600'
            }`}
          >
            <Send className="mr-2" size={20} />
            {resendCooldown > 0 ? `Resend Email (${resendCooldown}s)` : 'Resend Verification Email'}
          </button>
      )}

      <button
        onClick={() => setIsRegistering(!isRegistering)}
        className="w-full mt-4 text-blue-600 hover:text-blue-800 font-medium text-sm transition duration-200 ease-in-out"
      >
        {isRegistering ? 'Already have an account? Login' : 'New member? Register here'}
      </button>

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