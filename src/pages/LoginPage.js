const LoginPage = ({ navigate, auth, db, appId }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState(''); // For registration
    const [isRegistering, setIsRegistering] = useState(false);
    const [message, setMessage] = useState('');
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');
  
    // Pre-populate some dummy users if the collection is empty
    useEffect(() => {
      const setupDummyUsers = async () => {
        if (!db) return;
        const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
        const querySnapshot = await getDocs(usersRef);
  
        if (querySnapshot.empty) {
          console.log("Setting up dummy users...");
          // Add dummy member
          await addDoc(usersRef, {
            username: 'member1',
            password: 'password123',
            name: 'Alice Member',
            role: 'member',
            balance: 50.00,
            scores: [],
            eloRating: 1000, // Default Elo for new users
            gamesPlayed: 0,
            firebaseAuthUid: null // Will be updated on first login/registration
          });
          // Add dummy admin
          await addDoc(usersRef, {
            username: 'admin1',
            password: 'adminpassword',
            name: 'Charlie Admin',
            role: 'admin',
            balance: 0.00,
            scores: [],
            eloRating: 1000, // Default Elo for new users
            gamesPlayed: 0,
            firebaseAuthUid: null // Will be updated on first login/registration
          });
          setMessage('Dummy users created: member1/password123, admin1/adminpassword. Try logging in!');
        }
      };
      if (db) {
        setupDummyUsers();
      }
    }, [db, appId]);
  
    const handleAuth = async (e) => {
      e.preventDefault();
      setMessage('');
      setAlertMessage('');
  
      try {
        // Find the user in the public users collection
        const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
        const q = query(usersRef, where("username", "==", username));
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
  
          // Create new public user document
          userDocRef = await addDoc(usersRef, {
            username: username,
            password: password, // In real app, hash and salt passwords!
            name: name.trim(),
            role: 'member', // New registrations are always members
            balance: 0.00,
            scores: [],
            eloRating: 1000, // Default Elo for new registrations
            gamesPlayed: 0,
            firebaseAuthUid: auth.currentUser.uid // Link public user to current anonymous Firebase Auth UID
          });
          publicUserData = { id: userDocRef.id, username, password, name: name.trim(), role: 'member', balance: 0.00, scores: [], eloRating: 1000, gamesPlayed: 0, firebaseAuthUid: auth.currentUser.uid };
          setMessage('Registration successful! Logging you in...');
  
        } else {
          // --- Login Logic ---
          if (querySnapshot.empty) {
            setAlertMessage('Invalid username or password.');
            setShowAlert(true);
            return;
          }
          userDocRef = querySnapshot.docs[0].ref;
          publicUserData = querySnapshot.docs[0].data();
          publicUserData.id = querySnapshot.docs[0].id; // Add doc ID to data
  
          if (publicUserData.password !== password) { // Simple password check (NOT secure for production)
            setAlertMessage('Invalid username or password.');
            setShowAlert(true);
            return;
          }
          setMessage('Login successful!');
        }
  
        // Update the public user document with the current Firebase Auth UID if it's missing or different
        if (publicUserData.firebaseAuthUid !== auth.currentUser.uid) {
          await updateDoc(userDocRef, { firebaseAuthUid: auth.currentUser.uid });
          publicUserData.firebaseAuthUid = auth.currentUser.uid; // Update local state
        }
  
        // Create or update the user's private profile data (linked to the Firebase Auth UID)
        const userProfileRef = doc(db, `artifacts/${appId}/users/${auth.currentUser.uid}/profile/data`);
        await setDoc(userProfileRef, {
          name: publicUserData.name,
          role: publicUserData.role,
          balance: publicUserData.balance,
          scores: publicUserData.scores,
          eloRating: publicUserData.eloRating || 1000, // Ensure Elo is set, default if missing
          gamesPlayed: publicUserData.gamesPlayed || 0, // Ensure gamesPlayed is set
          publicId: publicUserData.id, // Store the ID of their public profile
          username: publicUserData.username,
          // Do NOT store password in private profile
        }, { merge: true });
  
        navigate(publicUserData.role === 'admin' ? 'adminDashboard' : 'memberDashboard');
  
      } catch (error) {
        console.error("Authentication error:", error);
        setAlertMessage('An error occurred during authentication. Please try again.');
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
  