import React, { useState, useEffect, useContext } from 'react';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog'; // Adjust the path if necessary
import { AppContext } from '../App'; // Import AppContext

const MemberDashboard = () => {
    // Consume necessary states from AppContext, including userData and setUserData
    const { db, auth, userId, isAuthenticated, isAuthReady, appId, userData, setUserData } = useContext(AppContext);

    // Initialize states using userData from context
    const [balance, setBalance] = useState(userData?.balance || 0);
    const [scores, setScores] = useState(userData?.scores || []);
    const [eloRating, setEloRating] = useState(userData?.eloRating || 1000);
    const [slots, setSlots] = useState([]); // All available slots
    const [myBookedSlots, setMyBookedSlots] = useState([]); // Slots booked by this user
    const [message, setMessage] = useState('');
    const [showBookingModal, setShowBookingModal] = useState(false);
    const [showEditProfileModal, setShowEditProfileModal] = useState(false);
    const [newUserName, setNewUserName] = useState(userData?.name || '');
    // const [showPreBookingModal, setShowPreBookingModal] = useState(false); // Kept commented as in original
    // const [preBookDate, setPreBookDate] = useState(''); // Kept commented as in original
    // const [preBookTime, setPreBookTime] = useState(''); // Kept commented as in original
    // const [showWaitingListModal, setShowWaitingListModal] = useState(false); // Kept commented as in original
    // const [selectedWaitingSlot, setSelectedWaitingSlot] = useState(null); // Kept commented as in original
    const [waitingListMessages, setWaitingListMessages] = useState([]);
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');
    const [hasMadeFirstBooking, setHasMadeFirstBooking] = useState(userData?.hasMadeFirstBooking || false);
    const [allMembers, setAllMembers] = useState([]); // New state to hold all members for match display
    const [matches, setMatches] = useState([]); // New state to hold user's matches
    const [filteredSlots, setFilteredSlots] = useState([]); // To store only available slots for display
    const [availableSlotCount, setAvailableSlotCount] = useState(0); // Count of currently displayed available slots
    const [topUpLink, setTopUpLink] = useState('');
    const [lastTopUpTimestamp, setLastTopUpTimestamp] = useState(null); // Firestore Timestamp object or null
    const appSettingsDocId = 'appConfig'; // Fixed ID for your app settings document, MUST match AdminDashboard
    const [appSettings, setAppSettings] = useState(null); // Ensure this state exists
    const [alertDialogOnConfirm, setAlertDialogOnConfirm] = useState(null);
    const [alertDialogOnCancel, setAlertDialogOnCancel] = useState(null);
    const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null); // To hold the slot object when booking


    // NEW STATES FOR ROLE CHECK
    const [currentUserRole, setCurrentUserRole] = useState(null);
    const [loadingRole, setLoadingRole] = useState(true);

    // Helper function to determine player grade based on Elo rating
    const getGrade = (elo) => {
        if (elo >= 1500) {
            return 'A';
        } else if (elo >= 1350) {
            return 'B';
        } else if (elo >= 1200) {
            return 'C';
        } else {
            return 'D';
        }
    };

    // Helper function to group slots by date
    const groupSlotsByDate = (slotsArray) => {
        const grouped = {};
        slotsArray.forEach(slot => {
            const date = formatSlotDateTime(slot.dateTime, 'date');
            if (!grouped[date]) {
                grouped[date] = [];
            }
            grouped[date].push(slot);
        });
        return grouped;
    };
  
    // Helper function to safely format slot date and time
    const formatSlotDateTime = (dateTimeString, type = 'date') => {
        if (!dateTimeString) {
            return 'N/A';
        }
        const dateObj = new Date(dateTimeString);
        
        if (isNaN(dateObj.getTime())) {
            console.error("Invalid dateTime string encountered:", dateTimeString);
            return 'Invalid Date';
        }

        if (type === 'date') {
            return dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        } else if (type === 'time') {
            return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } else if (type === 'full') {
            return dateObj.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
        }
        return 'N/A';
    };

    // EFFECT 1: Fetch Current User's Role (for admin check)
    useEffect(() => {
        const fetchUserRole = async () => {
            if (db && userId && isAuthenticated) {
                try {
                    setLoadingRole(true);
                    // Fetch role from the public user document, consistent with security rules
                    const userPublicDocRef = doc(db, `artifacts/${appId}/public/data/users/${userId}`);
                    const userDocSnap = await getDoc(userPublicDocRef);

                    if (userDocSnap.exists()) {
                        setCurrentUserRole(userDocSnap.data().role || null);
                    } else {
                        console.log("Public user profile not found for role check. Defaulting to null role.");
                        setCurrentUserRole(null);
                    }
                } catch (error) {
                    console.error("Error fetching current user role:", error);
                    setCurrentUserRole(null);
                } finally {
                    setLoadingRole(false);
                }
            } else if (isAuthReady && !isAuthenticated) {
                // If auth is ready but not authenticated, user is guest, role is null
                setCurrentUserRole(null);
                setLoadingRole(false);
            }
        };

        fetchUserRole();
    }, [db, userId, appId, isAuthenticated, isAuthReady]); // Dependencies for role fetching

    useEffect(() => {
        if (!db || !appId) return;
    
        const appSettingsRef = doc(db, 'artifacts', appId, 'public', 'data', appSettingsDocId);
        const unsubscribeAppSettings = onSnapshot(appSettingsRef, (docSnap) => {
          if (docSnap.exists()) {
            const settingsData = docSnap.data();
            setAppSettings(settingsData); // Set the entire appSettings object
            setTopUpLink(settingsData.topUpLink || '');
          } else {
            console.log("No app settings document found!");
            setAppSettings(null);
          }
        }, (error) => {
          console.error("Error fetching app settings:", error);
          setShowAlert(true);
          setAlertMessage(`Error fetching app settings: ${error.message}`);
        });
    
        return () => unsubscribeAppSettings();
      }, [db, appId, setShowAlert, setAlertMessage]);

    // EFFECT 2: Main data fetching and subscriptions
    useEffect(() => {
        if (!db || !userId || !isAuthenticated || !isAuthReady) {
            console.log("MemberDashboard useEffect: Not ready to fetch data.", { db, userId, isAuthenticated, isAuthReady });
            return;
        }
        console.log("MemberDashboard useEffect: Authenticated and ready. Fetching data...");
  
        // 1. Listen for user private profile data
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        const unsubscribeProfile = onSnapshot(userProfileRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                setUserData(data); // Update context
                setBalance(data.balance || 0);
                setScores(data.scores || []);
                setEloRating(data.eloRating || 1000);
                setNewUserName(data.name || '');
                setHasMadeFirstBooking(data.hasMadeFirstBooking || false);
                setLastTopUpTimestamp(data.lastTopUpTimestamp || null); // Fetch lastTopUpTimestamp
            } else {
                console.log("MemberDashboard: User private profile does not exist or not found after auth.");
                setUserData(null);
            }
        }, (error) => console.error("Error fetching user private profile:", error));
  
        // 2. Listen for all slots (public data)
        const slotsRef = collection(db, `artifacts/${appId}/public/data/slots`);
        const unsubscribeSlots = onSnapshot(slotsRef, (snapshot) => {
            const allFetchedSlots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            setSlots(allFetchedSlots); // Update main 'slots' state with ALL slots

            // Sort ALL fetched slots by dateTime for consistent grouping and display order
            allFetchedSlots.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

            // filteredSlots now holds ALL slots, not just available ones (used for modal display)
            setFilteredSlots(allFetchedSlots);
            // availableSlotCount will still count only truly available slots for the general display
            setAvailableSlotCount(allFetchedSlots.filter(slot => !slot.isBooked).length);

            // Set slots booked by the current user
            setMyBookedSlots(allFetchedSlots.filter(slot => slot.bookedBy === userId));
        }, (error) => console.error("Error fetching slots:", error));

        // 3. Listen for waiting list notifications specific to this user
        const waitingListRef = collection(db, `artifacts/${appId}/public/data/waitingLists`);
        const unsubscribeWaitingList = onSnapshot(waitingListRef, (snapshot) => {
            const messages = [];
            snapshot.docs.forEach(docSnap => {
                const data = docSnap.data();
                // Check if the current user is the first one on the waiting list and slot is available
                if (data.users && data.users[0] === userId && data.slotAvailable) {
                    messages.push(`Slot on ${data.date} at ${data.time} is now available!`);
                }
            });
            setWaitingListMessages(messages);
        }, (error) => console.error("Error fetching waiting list:", error));
  
        // 4. Listen for all members (public data) for displaying names in matches
        const membersRef = collection(db, `artifacts/${appId}/public/data/users`);
        const unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
            const fetchedMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllMembers(fetchedMembers);
        }, (error) => console.error("Error fetching members:", error));
  
        // 5. Listen for user's matches
        const matchesRef = collection(db, `artifacts/${appId}/public/data/matches`);
        const q = query(matchesRef, where('players', 'array-contains', userId));
        const unsubscribeMatches = onSnapshot(q, (snapshot) => {
            const fetchedMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMatches(fetchedMatches.sort((a, b) => new Date(b.date + 'T' + b.time) - new Date(a.date + 'T' + a.time)));
        }, (error) => console.error("Error fetching matches:", error));

        // 6. Listen for app settings (e.g., top-up link)
        const appSettingsRef = doc(db, `artifacts/${appId}/public/data/appSettings`, appSettingsDocId);
        const unsubscribeAppSettings = onSnapshot(appSettingsRef, (docSnap) => {
            if (docSnap.exists()) {
                setTopUpLink(docSnap.data().topUpLink || '');
            } else {
                setTopUpLink('');
            }
        }, (error) => console.error("Error fetching member app settings:", error));

        // Cleanup function for all listeners
        return () => {
            unsubscribeProfile();
            unsubscribeSlots();
            unsubscribeWaitingList();
            unsubscribeMembers();
            unsubscribeMatches();
            unsubscribeAppSettings();
        };
    }, [db, userId, appId, isAuthenticated, isAuthReady, setUserData]); // Dependencies for main data fetching

    // EFFECT 3: Call setupDummySlots if admin and data is ready
    useEffect(() => {
        // Ensure db is ready, user is authenticated, role has been loaded, and user is an admin
        if (db && userId && !loadingRole && currentUserRole === 'admin') {
            console.log("Attempting to setup dummy slots as admin...");
            const setupDummySlots = async () => {
                const slotsCollectionRef = collection(db, `artifacts/${appId}/public/data/slots`);
                try {
                    const existingSlots = await getDocs(slotsCollectionRef);
                    if (existingSlots.empty) {
                        console.log("Setting up dummy slots...");
                        await addDoc(slotsCollectionRef, { dateTime: '2025-08-01T10:00:00.000Z', isBooked: false, bookedBy: null });
                        await addDoc(slotsCollectionRef, { dateTime: '2025-08-01T11:00:00.000Z', isBooked: false, bookedBy: null });
                        await addDoc(slotsCollectionRef, { dateTime: '2025-08-02T09:00:00.000Z', isBooked: false, bookedBy: null });
                        await addDoc(slotsCollectionRef, { dateTime: '2025-08-02T10:00:00.000Z', isBooked: false, bookedBy: null });
                        await addDoc(slotsCollectionRef, { dateTime: '2025-08-08T18:00:00.000Z', isBooked: false, bookedBy: null });
                        await addDoc(slotsCollectionRef, { dateTime: '2025-08-09T19:00:00.000Z', isBooked: false, bookedBy: null });
                        console.log("Dummy slots setup complete.");
                    } else {
                        console.log("Dummy slots already exist. Skipping setup.");
                    }
                } catch (error) {
                    console.error("Error setting up dummy slots (check security rules & admin role):", error);
                }
            };
            setupDummySlots();
        } else if (!loadingRole && currentUserRole !== 'admin') {
            console.log("User is not an admin or role not yet determined, skipping dummy slot setup.");
        }
    }, [db, userId, appId, loadingRole, currentUserRole]); // Dependencies for dummy slots setup

    const handleInitiateTopUp = async () => {
        setMessage('');
        setAlertMessage('');
        if (!topUpLink) {
            setAlertMessage('No top-up link is configured by the admin yet.');
            setShowAlert(true);
            return;
        }

        window.open(topUpLink, '_blank');

        try {
            if (userId) {
                const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
                await updateDoc(userProfileRef, {
                    lastTopUpTimestamp: new Date(),
                });
                setMessage('Redirecting to top-up page. Your top-up period has been reset.');
            }
        } catch (error) {
            console.error("Error updating last top-up timestamp:", error);
            setAlertMessage('Failed to record top-up attempt. Please try again.');
            setShowAlert(true);
        }
    };

    const handleBookSlot = async (slot) => { // This is your actual function for booking
        setSelectedSlotForBooking(slot);
        // Use the fetched slotBookingCost, default to 4 if appSettings or slotBookingCost is not yet available
        const slotCost = appSettings?.slotBookingCost || 4;
    
        setAlertMessage(
            `Confirm booking for ${formatSlotDateTime(slot.dateTime, 'date')} at ${formatSlotDateTime(slot.dateTime, 'time')}? ` +
            `A fee of ${slotCost} EUR will be deducted from your balance.`
        );
        setShowAlert(true);
        setAlertDialogOnConfirm(() => async () => {
            setShowAlert(false);
            try {
                // Your existing logic for updating the slot
                await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'slots', slot.id), {
                    bookedPlayers: arrayUnion(userId),
                    waitingList: arrayRemove(userId), // Assuming you remove from waiting list on booking
                });
                // You will add the balance deduction here in the next step (Cloud Function)
    
                setShowAlert(true);
                setAlertMessage('Slot booked successfully!');
                setAlertDialogOnConfirm(() => () => setShowAlert(false));
                setAlertDialogOnCancel(null); // No cancel needed for success message
    
            } catch (error) {
                console.error("Error booking slot:", error);
                setShowAlert(true);
                setAlertMessage(`Error booking slot: ${error.message}`);
                setAlertDialogOnConfirm(() => () => setShowAlert(false));
                setAlertDialogOnCancel(null);
            } finally {
                setSelectedSlotForBooking(null);
            }
        });
        setAlertDialogOnCancel(() => () => {
            setShowAlert(false);
            setSelectedSlotForBooking(null);
        });
    };
    

    const handleCancelSlot = async (slotId, slotDateTimeStr) => {
        setMessage('');
        setAlertMessage('');
        const confirmed = await new Promise(resolve => {
            const confirmModal = document.createElement('div');
            confirmModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
            confirmModal.innerHTML = `
                <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-6 text-center">
                    <h3 class="text-2xl font-bold text-red-700">Confirm Cancellation</h3>
                    <p class="text-lg text-gray-700">Are you sure you want to cancel the slot on ${formatSlotDateTime(slotDateTimeStr, 'full')}? This will refund your balance.</p>
                    <div class="flex justify-center space-x-4 mt-6">
                        <button id="cancelDelete" class="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out">Cancel</button>
                        <button id="confirmDelete" class="bg-red-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-red-700 transition duration-200 ease-in-out">Confirm</button>
                    </div>
                </div>
            `;
            document.body.appendChild(confirmModal);

            document.getElementById('cancelDelete').onclick = () => {
                document.body.removeChild(confirmModal);
                resolve(false);
            };
            document.getElementById('confirmDelete').onclick = () => {
                document.body.removeChild(confirmModal);
                resolve(true);
            };
        });

        if (!confirmed) {
            return;
        }

        try {
            const slotDocRef = doc(db, `artifacts/${appId}/public/data/slots`, slotId);
            await updateDoc(slotDocRef, {
                isBooked: false,
                bookedBy: null,
                preBooked: false
            });

            // Refund balance to private profile
            const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
            await updateDoc(userProfileRef, {
                balance: balance + 10
            });

            // Refund balance to public user data as well
            const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
            await updateDoc(publicUserDocRef, {
                balance: balance + 10
            });

            const slotDate = new Date(slotDateTimeStr).toISOString().split('T')[0];
            const slotTime = new Date(slotDateTimeStr).toTimeString().split(' ')[0].substring(0, 5);
            const waitingListDocRef = doc(db, `artifacts/${appId}/public/data/waitingLists`, `${slotDate}_${slotTime}`);
            const waitingListSnap = await getDoc(waitingListDocRef);

            let cancellationMessage = `Slot on ${formatSlotDateTime(slotDateTimeStr, 'full')} cancelled successfully! 10€ refunded.`;

            if (waitingListSnap.exists()) {
                const waitingListData = waitingListSnap.data();
                if (waitingListData.users && waitingListData.users.length > 0) {
                    const updatedWaitingUsers = waitingListData.users.slice(1);
                    await updateDoc(waitingListDocRef, { users: updatedWaitingUsers, slotAvailable: true });
                    cancellationMessage = `Slot on ${formatSlotDateTime(slotDateTimeStr, 'full')} cancelled. Notified next person on waiting list.`;
                } else {
                    await deleteDoc(waitingListDocRef);
                }
            }
            setMessage(cancellationMessage);

        } catch (error) {
            console.error("Error cancelling slot:", error);
            setAlertMessage('Failed to cancel slot. Please try again.');
            setShowAlert(true);
        }
    };

    const handleUpdateUserName = async () => {
        setMessage('');
        setAlertMessage('');
        if (!newUserName.trim()) {
            setAlertMessage('Name cannot be empty.');
            setShowAlert(true);
            return;
        }
        try {
            // Update private profile
            const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
            await updateDoc(userProfileRef, {
                name: newUserName.trim()
            });
    
            // Update public user data
            const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, userId);
            await updateDoc(publicUserDocRef, {
                name: newUserName.trim()
            });
    
            setMessage('Profile name updated successfully!');
            setShowEditProfileModal(false);
        } catch (error) {
            console.error("Error updating user name:", error);
            setAlertMessage('Failed to update profile. Please try again.');
            setShowAlert(true);
        }
    };
  
    // handlePreBookSlot commented out as per original file
    // const handlePreBookSlot = async () => { /* ... */ };
  
    const handleJoinWaitingList = async (slotDateTimeStr) => {
        setMessage('');
        setAlertMessage('');

        if (!userId || !db || !appId) {
            setAlertMessage("User, Database or App ID not ready.");
            setShowAlert(true);
            return;
        }

        const slotDate = new Date(slotDateTimeStr).toISOString().split('T')[0];
        const slotTime = new Date(slotDateTimeStr).toTimeString().split(' ')[0].substring(0, 5);
        const waitingListId = `${slotDate}_${slotTime}`;

        try {
            const waitingListDocRef = doc(db, `artifacts/${appId}/public/data/waitingLists`, waitingListId);
            const waitingListSnap = await getDoc(waitingListDocRef);

            if (waitingListSnap.exists()) {
                const waitingListData = waitingListSnap.data();
                if (waitingListData.users && waitingListData.users.includes(userId)) {
                    setAlertMessage('You are already on the waiting list for this slot.');
                    setShowAlert(true);
                    return;
                }
                await updateDoc(waitingListDocRef, {
                    users: [...(waitingListData.users || []), userId],
                    slotAvailable: false
                });
            } else {
                await setDoc(waitingListDocRef, {
                    date: slotDate,
                    time: slotTime,
                    users: [userId],
                    slotAvailable: false
                });
            }
            setMessage(`You have joined the waiting list for the slot on ${formatSlotDateTime(slotDateTimeStr, 'full')}.`);
        } catch (error) {
            console.error("Error joining waiting list:", error);
            setAlertMessage('Failed to join waiting list. Please try again.');
            setShowAlert(true);
        }
    };

    // Filter for slots that are booked by the current user
    const cancellableSlots = myBookedSlots.filter(slot => slot.bookedBy === userId);
    
    // The `unavailableSlots`, `uniqueUnavailableDates`, `timesForSelectedUnavailableDate` variables
    // related to a waiting list selection UI that appears to be unused in the current JSX.
    // Keeping them as per the original for now, but they could be removed if not needed.
    const unavailableSlots = slots.filter(slot => slot.isBooked); // Changed from !slot.available to slot.isBooked
    const uniqueUnavailableDates = [...new Set(unavailableSlots.map(slot => formatSlotDateTime(slot.dateTime, 'date')))].sort();
    const timesForSelectedUnavailableDate = (date) => unavailableSlots.filter(slot => formatSlotDateTime(slot.dateTime, 'date') === date).map(slot => formatSlotDateTime(slot.dateTime, 'time')).sort();


    // Display loading state while role is being determined
    if (loadingRole) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-center text-gray-700 text-xl">Loading user data...</div>
            </div>
        );
    }

    return (
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-4xl w-full flex flex-col lg:flex-row gap-8 transform transition-all duration-300 ease-in-out hover:scale-105">
            {/* Left Section: Balance and Scores */}
            <div className="flex-1 space-y-6">
                <h2 className="text-3xl font-bold text-blue-700 mb-4">Member Dashboard</h2>
                <p className="text-gray-600 text-lg mb-4">Welcome, <span className="font-semibold text-blue-800">{userData?.name || 'Member'}</span>!</p>
                {/* Display Current User Role for debugging/info */}
                <p className="text-gray-500 text-sm">Your Role: <span className="font-mono text-xs break-all">{currentUserRole || 'Not Set'}</span></p>

                {/* Balance */}
                <div className="bg-blue-50 p-6 rounded-xl shadow-md flex items-center justify-between">
                    <div className="flex items-center">
                        <DollarSign className="text-blue-600 mr-3" size={24} />
                        <span className="text-xl font-semibold text-gray-800">Balance:</span>
                    </div>
                    <span className="text-2xl font-bold text-blue-800">{balance}€</span>
                </div>
                {/* Top Up Balance Section */}
                <div className="bg-white p-6 rounded-2xl shadow-xl space-y-4 rounded-xl">
                    <h3 className="text-2xl font-bold text-gray-800 text-center">Top Up Balance</h3>
                    <p className="text-center text-gray-600">
                        Your current balance: <span className="font-bold text-blue-700 text-xl">{balance}€</span>
                    </p>
                    {(() => {
                        const twoWeeksInMs = 14 * 24 * 60 * 60 * 1000;
                        const canTopUp = !lastTopUpTimestamp || (new Date().getTime() - lastTopUpTimestamp.toDate().getTime() >= twoWeeksInMs);
                        
                        const nextTopUpDate = lastTopUpTimestamp 
                            ? new Date(lastTopUpTimestamp.toDate().getTime() + twoWeeksInMs) 
                            : null;

                        return (
                            <>
                                <button
                                    onClick={handleInitiateTopUp}
                                    disabled={!canTopUp || !topUpLink}
                                    className={`w-full py-3 px-6 rounded-xl text-lg font-semibold shadow-lg transition duration-300 ease-in-out transform hover:-translate-y-1
                                        ${canTopUp && topUpLink
                                            ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                                            : 'bg-gray-300 text-gray-600 cursor-not-allowed'
                                        }`}
                                >
                                    <DollarSign className="inline-block mr-2" size={20} />
                                    {canTopUp ? 'Top Up My Balance Now!' : 'Top Up Available Soon'}
                                </button>
                                {!canTopUp && nextTopUpDate && (
                                    <p className="text-center text-gray-500 text-sm mt-2">
                                        Next top-up available on: {nextTopUpDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                                    </p>
                                )}
                                {!topUpLink && (
                                    <p className="text-center text-red-500 text-sm mt-2">
                                        Top-up link not configured by admin yet.
                                    </p>
                                )}
                            </>
                                );
                            })()}
                        </div>
                {/* Elo Rating and Grade */}
                <div className="bg-yellow-50 p-6 rounded-xl shadow-md flex flex-col space-y-2">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <Trophy className="text-yellow-600 mr-3" size={24} />
                            <span className="text-xl font-semibold text-gray-800">Elo Rating:</span>
                        </div>
                        <span className="text-2xl font-bold text-yellow-800">{Math.round(eloRating)}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-yellow-200">
                        <div className="flex items-center">
                            <Info className="text-yellow-600 mr-3" size={20} />
                            <span className="text-lg font-medium text-gray-700">Player Grade:</span>
                        </div>
                        <span className="text-xl font-bold text-yellow-700">{getGrade(eloRating)}</span>
                    </div>
                </div>

                {/* Message Display */}
                {message && (
                    <p className={`mt-4 text-center ${message.includes('successfully') || message.includes('refunded') ? 'text-green-600' : 'text-red-600'} font-medium`}>
                        {message}
                    </p>
                )}

                {/* Waiting List Notifications */}
                {waitingListMessages.length > 0 && (
                    <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4 rounded-lg shadow-md mb-4" role="alert">
                        <p className="font-bold">Notifications:</p>
                        <ul className="list-disc list-inside">
                            {waitingListMessages.map((msg, index) => (
                                <li key={index}>{msg}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {/* Edit Profile Button */}
                <button
                    onClick={() => setShowEditProfileModal(true)}
                    className="w-full flex items-center justify-center bg-gray-200 text-gray-800 py-3 px-6 rounded-xl text-lg font-semibold shadow-md hover:bg-gray-300 transition duration-300 ease-in-out transform hover:-translate-y-1"
                >
                    <Edit className="mr-2" size={20} /> Edit Profile
                </button>

                {/* Book Slot Button */}
                <button
                    onClick={() => setShowBookingModal(true)}
                    className="w-full flex items-center justify-center bg-blue-600 text-white py-3 px-6 rounded-xl text-lg font-semibold shadow-lg hover:bg-blue-700 transition duration-300 ease-in-out transform hover:-translate-y-1"
                >
                    <PlusCircle className="mr-2" size={20} /> Book Slot
                </button>

                {/* Pre-Book Slot Button (Commented out as in original)
                <button
                    onClick={() => setShowPreBookingModal(true)}
                    className="w-full flex items-center justify-center bg-purple-600 text-white py-3 px-6 rounded-xl text-lg font-semibold shadow-lg hover:bg-purple-700 transition duration-300 ease-in-out transform hover:-translate-y-1"
                >
                    <Clock className="mr-2" size={20} /> Pre-Book Slot
                </button> */}
            </div>

            {/* Right Section: My Booked Slots */}
            <div className="flex-1 space-y-6">
                <h3 className="text-2xl font-bold text-blue-700 mb-4">My Booked Slots</h3>
                {myBookedSlots.length > 0 ? (
                    <ul className="space-y-4">
                        {myBookedSlots.map(slot => (
                            <li key={slot.id} className="bg-white p-4 rounded-xl shadow-md flex items-center justify-between border border-blue-200">
                                <div>
                                    <p className="font-semibold text-lg text-gray-800 flex items-center"><Calendar size={18} className="mr-2 text-blue-500" /> {formatSlotDateTime(slot.dateTime, 'full')}</p>
                                    {slot.preBooked && <span className="text-sm text-purple-600 font-medium ml-6">(Pre-Booked)</span>}
                                </div>
                                <button
                                    onClick={() => handleCancelSlot(slot.id, slot.dateTime)}
                                    className="bg-red-500 text-white px-3 py-1 rounded-lg shadow-sm hover:bg-red-600 transition duration-200 ease-in-out text-sm"
                                >
                                    Cancel
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-600 text-center py-8 bg-gray-50 rounded-lg">No slots booked yet.</p>
                )}

                {/* Matches Overview */}
                <h3 className="text-2xl font-bold text-blue-700 mt-8 mb-4">My Matches</h3>
                {matches.length > 0 ? (
                    <ul className="space-y-4">
                        {matches.map(match => {
                            const team1Names = match.team1.map(uid => allMembers.find(m => m.firebaseAuthUid === uid)?.name || 'Unknown Player').join(' & ');
                            const team2Names = match.team2.map(uid => allMembers.find(m => m.firebaseAuthUid === uid)?.name || 'Unknown Player').join(' & ');
                            const userEloChange = match.eloChanges?.find(change => change.userId === userId)?.change || 0;
                            const eloChangeColor = userEloChange >= 0 ? 'text-green-600' : 'text-red-600';
                            const eloChangeSign = userEloChange >= 0 ? '+' : '';

                            return (
                                <li key={match.id} className="bg-white p-4 rounded-xl shadow-md border border-green-200">
                                    <p className="font-semibold text-lg text-gray-800 flex items-center mb-2"><Trophy size={18} className="mr-2 text-green-500" /> Match on {match.date} at {match.time}</p>
                                    <p className="text-gray-700 ml-6 mb-1">
                                        <span className="font-medium">Teams:</span> {team1Names} vs {team2Names}
                                    </p>
                                    <p className="text-gray-700 ml-6 mb-1">
                                        <span className="font-medium">Score:</span> {match.score1} - {match.score2}
                                    </p>
                                    <p className={`text-gray-700 ml-6 ${eloChangeColor}`}>
                                        <span className="font-medium">Your Elo Change:</span> {eloChangeSign}{userEloChange}
                                    </p>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="text-gray-600 text-center py-8 bg-gray-50 rounded-lg">No matches played yet.</p>
                )}
            </div>

            {/* Booking Modal */}
            {showBookingModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-6 overflow-y-auto max-h-[90vh]">
                        <h3 className="text-2xl font-bold text-blue-700 text-center mb-4">Book a Slot or Join Waiting List</h3>

                        {filteredSlots.length > 0 ? (
                            Object.entries(groupSlotsByDate(filteredSlots))
                                .sort(([dateA], [dateB]) => new Date(dateA) - new Date(dateB))
                                .map(([date, slotsForDate]) => (
                                <div key={date} className="mb-6 border border-gray-200 rounded-lg p-4">
                                    <h4 className="text-xl font-semibold text-gray-700 mb-3 border-b pb-2">
                                        {formatSlotDateTime(date, 'date')} <span className="text-gray-500 text-base">({slotsForDate.length} slots)</span>
                                    </h4>
                                    <ul className="space-y-3">
                                        {slotsForDate.map(slot => (
                                            <li key={slot.id} className={`flex items-center justify-between p-4 rounded-lg shadow-sm ${slot.isBooked ? 'bg-red-50' : 'bg-green-50'}`}>
                                                <span className="text-gray-700 font-medium">
                                                    {formatSlotDateTime(slot.dateTime, 'time')}
                                                </span>
                                                {slot.isBooked ? (
                                                    <button
                                                        onClick={() => handleJoinWaitingList(slot.dateTime)}
                                                        className="bg-orange-500 text-white py-2 px-4 rounded-lg shadow-md hover:bg-orange-600 transition duration-200 ease-in-out"
                                                    >
                                                        Join Waiting List
                                                    </button>
                                                ) : (
                                                    <button
                                                        onClick={() => handleBookSlot(slot.id, slot.dateTime)}
                                                        className="bg-green-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition duration-200 ease-in-out"
                                                    >
                                                        Book (10€)
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))
                        ) : (
                            <p className="text-center text-gray-500">No slots available or booked at the moment.</p>
                        )}
                        <div className="flex justify-end space-x-4 mt-6">
                            <button
                                onClick={() => setShowBookingModal(false)}
                                className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Pre-Booking Modal (Commented out as in original) */}
            {/* {showPreBookingModal && ( /* ... */ }

            {/* Edit Profile Modal */}
            {showEditProfileModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-6">
                        <h3 className="text-2xl font-bold text-blue-700 text-center">Edit Profile</h3>
                        <div>
                            <label htmlFor="newUserName" className="block text-gray-700 text-sm font-bold mb-2">Your Name:</label>
                            <input
                                type="text"
                                id="newUserName"
                                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:ring focus:border-blue-500 transition duration-200 ease-in-out"
                                value={newUserName}
                                onChange={(e) => setNewUserName(e.target.value)}
                                required
                            />
                        </div>
                        <div className="flex justify-end space-x-4">
                            <button
                                onClick={() => setShowEditProfileModal(false)}
                                className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateUserName}
                                className="bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
                            >
                                Save Changes
                            </button>
                        </div>
                        {message && (
                            <p className={`mt-4 text-center ${message.includes('success') ? 'text-green-600' : 'text-red-600'} font-medium`}>
                                {message}
                            </p>
                        )}
                    </div>
                </div>
            )}
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

export default MemberDashboard;