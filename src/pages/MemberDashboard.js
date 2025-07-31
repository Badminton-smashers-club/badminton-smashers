import React, { useState, useEffect, useContext, useCallback } from 'react';
import { 
    doc, getDoc, setDoc, updateDoc, orderBy, limit, onSnapshot, collection, query, where, getDocs, deleteDoc, addDoc 
} from 'firebase/firestore';

import { getFunctions, httpsCallable } from 'firebase/functions';
import { 
    Trophy, DollarSign, Info, PlusCircle, Calendar, Edit, XCircle, Bell, List
} from 'lucide-react';
import { getMessaging, getToken, onMessage } from "firebase/messaging"; // NEW IMPORT
import CustomAlertDialog from '../components/CustomAlertDialog';
import { AppContext } from '../App';
import { formatSlotDateTime } from '../utils/datehelpers';
import { getMemberName } from '../utils/memberhelpers';

const MemberDashboard = () => {
    const { 
        db, userId, isAuthenticated, isAuthReady, appId, userData, setUserData, functions,
        setFcmMessageDisplayCallback // Get this setter from AppContext
    } = useContext(AppContext);

    const [balance, setBalance] = useState(userData?.balance || 0);
    const [scores, setScores] = useState(userData?.scores || []);
    const [eloRating, setEloRating] = useState(userData?.eloRating || 1000);
    const [hasMadeFirstBooking, setHasMadeFirstBooking] = useState(userData?.hasMadeFirstBooking || false);
    const [myBookedSlots, setMyBookedSlots] = useState([]);
    const [slots, setSlots] = useState([]);
    const [matches, setMatches] = useState([]);
    const [appSettings, setAppSettings] = useState(null);
    const [message, setMessage] = useState('');
    const [selectedSlotForBooking, setSelectedSlotForBooking] = useState(null);
    const [showEditProfileModal, setShowEditProfileModal] = useState(false);
    const [newUserName, setNewUserName] = useState(userData?.name || '');
    const [waitingListMessages, setWaitingListMessages] = useState([]);
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');
    const [alertDialogOnConfirm, setAlertDialogOnConfirm] = useState(null);
    const [alertDialogOnCancel, setAlertDialogOnCancel] = useState(null);
    const [myWaitingListEntries, setMyWaitingListEntries] = useState([]);
    const [transactions, setTransactions] = useState([]);
    const [loadingDashboard, setLoadingDashboard] = useState(true);
    const [isBookingSlot, setIsBookingSlot] = useState(false);
    const [isCancellingBooking, setIsCancellingBooking] = useState(false);
    const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
    const [isToppingUp, setIsToppingUp] = useState(false);

    const [topUpLink, setTopUpLink] = useState('');
    const [lastTopUpTimestamp, setLastTopUpTimestamp] = useState(null);
    const [allMembers, setAllMembers] = useState([]);
    const [filteredSlots, setFilteredSlots] = useState([]);
    const [availableSlotCount, setAvailableSlotCount] = useState(0);
    const [fcmToken, setFcmToken] = useState(null); // NEW STATE

    const appSettingsDocId = 'settings'; 
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

    // Helper function to group slots by date (not currently used in rendering, but kept for potential future use)
    const groupSlotsByDate = (slotsArray) => {
        const grouped = {};
        slotsArray.forEach(slot => {
            const date = formatSlotDateTime(slot.timestamp, 'date');
            if (!grouped[date]) {
                grouped[date] = [];
            }
            grouped[date].push(slot);
        });
        return grouped;
    };
  
    // EFFECT 1: Fetch Current User's Role (for admin check in dummy slot setup)
    useEffect(() => {
        const fetchUserRole = async () => {
            if (db && userId && isAuthenticated) {
                try {
                    setLoadingRole(true);
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
                setCurrentUserRole(null);
                setLoadingRole(false);
            }
        };

        fetchUserRole();
    }, [db, userId, appId, isAuthenticated, isAuthReady]);

    // EFFECT 2: Main data fetching and subscriptions
    useEffect(() => {
        if (!db || !userId || !isAuthenticated || !isAuthReady || !appId || !functions) {
            console.log("MemberDashboard useEffect: Not ready to fetch data.", { db, userId, isAuthenticated, isAuthReady, appId, functions });
            return;
        }
        console.log("MemberDashboard useEffect: Authenticated and ready. Fetching data...");
        setLoadingDashboard(true);
  
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
                setLastTopUpTimestamp(data.lastTopUpTimestamp || null);
            } else {
                console.log("MemberDashboard: User private profile does not exist or not found after auth.");
                setUserData(null);
            }
        }, (error) => console.error("Error fetching user private profile:", error));
  
        // 2. Listen for all slots (public data)
        const slotsRef = collection(db, `artifacts/${appId}/public/data/slots`);
        const unsubscribeSlots = onSnapshot(slotsRef, (snapshot) => {
            const allFetchedSlots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            setSlots(allFetchedSlots); 
            allFetchedSlots.sort((a, b) => (a.timestamp?.toDate() || new Date(0)) - (b.timestamp?.toDate() || new Date(0)));
            setFilteredSlots(allFetchedSlots);
            setAvailableSlotCount(allFetchedSlots.filter(slot => !slot.isBooked && (slot.timestamp?.toDate() || new Date()) >= new Date()).length); 

            // NEW: Fetch waiting list entries to determine slot status
            const waitingListCollectionRef = collection(db, `artifacts/${appId}/public/data/waitingLists`);
            const waitingListQuery = query(waitingListCollectionRef, where("users", "array-contains", userId));
            getDocs(waitingListQuery).then(waitlistSnapshot => {
                const fetchedWaitingList = waitlistSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setMyWaitingListEntries(fetchedWaitingList); // Store waiting list entries

                // Filter and set slots booked by the current user, including waiting list status
                const bookedAndWaitingSlots = allFetchedSlots.filter(slot => {
                    const isBookedByUser = slot.bookedBy === userId && slot.isBooked;
                    const isUserOnWaitlistForSlot = fetchedWaitingList.some(wl => wl.slotId === slot.id && wl.users[0] === userId); // Check if user is on waitlist AND first in line

                    return (isBookedByUser || isUserOnWaitlistForSlot) && (slot.timestamp?.toDate() || new Date()) >= new Date();
                }).map(slot => {
                    // Determine status for display
                    const isUserOnWaitlistForSlot = fetchedWaitingList.some(wl => wl.slotId === slot.id && wl.users[0] === userId);
                    return {
                        ...slot,
                        statusDisplay: slot.isBooked ? 'Confirmed' : (isUserOnWaitlistForSlot ? 'Waiting List' : 'Unknown')
                    };
                }).sort((a,b) => (a.timestamp?.toDate() || new Date(0)) - (b.timestamp?.toDate() || new Date(0)));

                setMyBookedSlots(bookedAndWaitingSlots);

            }).catch(error => console.error("Error fetching waiting list for booked slots:", error));
        }, (error) => console.error("Error fetching slots:", error));

        // 3. Listen for waiting list notifications specific to this user
        const waitingListRef = collection(db, `artifacts/${appId}/public/data/waitingLists`);
        const q = query(waitingListRef, where("users", "array-contains", userId));
        const unsubscribeWaitingList = onSnapshot(q, (snapshot) => {
            const messages = snapshot.docs.map(docSnap => {
                const data = docSnap.data();
                // Check if the current user is the first in line and the slot is available
                if (data.users && data.users[0] === userId && data.slotAvailable) {
                    return `Slot on ${formatSlotDateTime(data.date, 'date')} at ${data.time} is now available!`;
                }
                return null; // Don't include if not the first or not available
            }).filter(Boolean); // Filter out nulls
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
        // Use a single query with OR if possible, or combine results from two queries
        // Firestore does not directly support OR queries across different fields or array-contains with OR.
        // So, fetching two queries and combining is the correct approach.
        const qMatchesTeam1 = query(matchesRef, where('team1', 'array-contains', userId));
        const qMatchesTeam2 = query(matchesRef, where('team2', 'array-contains', userId));

        const unsubscribeMatchesTeam1 = onSnapshot(qMatchesTeam1, (snapshot1) => {
            const fetchedMatches1 = snapshot1.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const unsubscribeMatchesTeam2 = onSnapshot(qMatchesTeam2, (snapshot2) => {
                const fetchedMatches2 = snapshot2.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Combine and remove duplicates
                const combinedMatches = [...fetchedMatches1, ...fetchedMatches2];
                const uniqueMatches = Array.from(new Map(combinedMatches.map(match => [match.id, match])).values());

                setMatches(uniqueMatches.sort((a, b) => {
                    const dateA = a.slotTimestamp?.toDate() || new Date(0);
                    const dateB = b.slotTimestamp?.toDate() || new Date(0);
                    return dateB.getTime() - dateA.getTime(); // Newest first
                }));
                setLoadingDashboard(false);
            }, (error) => {
                console.error("Error fetching matches (team2):", error);
                setAlertMessage(`Error fetching matches: ${error.message}`);
                setShowAlert(true);
                setLoadingDashboard(false);
            });
            return unsubscribeMatchesTeam2; // Return the unsubscribe function for the inner snapshot
        }, (error) => {
            console.error("Error fetching matches (team1):", error);
            setAlertMessage(`Error fetching matches: ${error.message}`);
            setShowAlert(true);
            setLoadingDashboard(false);
        });


        // 6. Listen for app settings (e.g., top-up link)
        const appSettingsRef = doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', appSettingsDocId);
        const unsubscribeAppSettings = onSnapshot(appSettingsRef, (docSnap) => {
            if (docSnap.exists()) {
                setAppSettings(docSnap.data());
                setTopUpLink(docSnap.data().topUpLink || '');
            } else {
                console.warn("App settings document not found.");
                setAppSettings({});
                setTopUpLink('');
            }
        }, (error) => console.error("Error fetching member app settings:", error));

        // ... inside useEffect for data fetching

            // 7. Listen for user's transaction history
            const transactionsRef = collection(db, `artifacts/${appId}/users/${userId}/transactions`);
            const qTransactions = query(transactionsRef, orderBy('timestamp', 'desc'), limit(20)); // Limit to last 20 for performance
            const unsubscribeTransactions = onSnapshot(qTransactions, (snapshot) => {
                const fetchedTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setTransactions(fetchedTransactions);
            }, (error) => console.error("Error fetching transaction history:", error));

        return () => {
            unsubscribeProfile();
            unsubscribeSlots();
            unsubscribeWaitingList();
            unsubscribeMembers();
            unsubscribeMatchesTeam1(); // Unsubscribe the outer snapshot
            unsubscribeAppSettings();
        };
    }, [db, userId, appId, isAuthenticated, isAuthReady, setUserData, functions]);

    // EFFECT 3: Call setupDummySlots if admin and data is ready
    useEffect(() => {
        if (db && userId && !loadingRole && currentUserRole === 'admin') {
            console.log("Attempting to setup dummy slots as admin...");
            const setupDummySlots = async () => {
                const slotsCollectionRef = collection(db, `artifacts/${appId}/public/data/slots`);
                try {
                    const existingSlots = await getDocs(slotsCollectionRef);
                    if (existingSlots.empty) {
                        console.log("Setting up dummy slots...");
                        // Use Firestore Timestamps for consistency
                        await addDoc(slotsCollectionRef, { timestamp: new Date('2025-08-01T10:00:00Z'), time: '10:00', isBooked: false, bookedBy: null, available: true });
                        await addDoc(slotsCollectionRef, { timestamp: new Date('2025-08-01T11:00:00Z'), time: '11:00', isBooked: false, bookedBy: null, available: true });
                        await addDoc(slotsCollectionRef, { timestamp: new Date('2025-08-02T09:00:00Z'), time: '09:00', isBooked: false, bookedBy: null, available: true });
                        await addDoc(slotsCollectionRef, { timestamp: new Date('2025-08-02T10:00:00Z'), time: '10:00', isBooked: false, bookedBy: null, available: true });
                        await addDoc(slotsCollectionRef, { timestamp: new Date('2025-08-08T18:00:00Z'), time: '18:00', isBooked: false, bookedBy: null, available: true });
                        await addDoc(slotsCollectionRef, { timestamp: new Date('2025-08-09T19:00:00Z'), time: '19:00', isBooked: false, bookedBy: null, available: true });
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
    }, [db, userId, appId, loadingRole, currentUserRole]);

    // EFFECT 4: Register FCM Message Display Callback
    useEffect(() => {
        // This function will be called by setupNotifications in App.js
        const handleFCMMessage = (payload) => {
            const { notification, data } = payload;

            let displayMessage = '';
            if (notification && notification.body) {
                displayMessage = notification.body;
            } else if (data && data.message) {
                displayMessage = data.message;
            }

            // Determine if it should be a simple message or trigger AlertDialog
            if (data && data.type) {
                switch (data.type) {
                    case 'slot_available_game_day':
                    case 'slot_available_priority':
                        setMessage(`Action required: A slot on ${data.date} at ${data.time} is now available!`);
                        break;
                    case 'slot_refund_direct_rebook':
                    case 'slot_refund_replacement':
                        setMessage(`Refund Processed: Your cancelled slot on ${data.date} at ${data.time} was re-booked. Amount: ${data.amount}€`);
                        // Refresh user balance immediately
                        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
                        getDoc(userProfileRef).then(docSnap => {
                            if (docSnap.exists()) setUserData(docSnap.data());
                        }).catch(err => console.error("Error fetching user data after refund:", err));
                        break;
                    case 'cancellation_fee_charged':
                        setMessage(`Cancellation Finalized: Your slot on ${data.date} at ${data.time} was not re-booked. No refund issued.`);
                        break;
                    default:
                        console.log("Unhandled FCM data type:", data.type);
                        setAlertMessage(displayMessage); // Fallback to AlertDialog for unknown types
                        setShowAlert(true);
                }
            } else if (displayMessage) {
                // If there's a notification body but no specific data.type, use AlertDialog
                setAlertMessage(displayMessage);
                setShowAlert(true);
            }
        };

        // Register this callback with App.js's context
        if (setFcmMessageDisplayCallback) {
            setFcmMessageDisplayCallback(handleFCMMessage);
        }

        // Cleanup: Deregister the callback when component unmounts
        return () => {
            if (setFcmMessageDisplayCallback) {
                setFcmMessageDisplayCallback(null);
            }
        };
    }, [db, appId, userId, setUserData, setFcmMessageDisplayCallback, setMessage, setAlertMessage, setShowAlert]); // These are your local setters, so they are correct dependencies// --- Event Handlers ---

    const handleBookSlot = async (slotId, slotDateTimeInput) => {
        // Remove setMessage('') and setAlertMessage('') here.
        if (!db || !userId || !functions || !appSettings) return;

        const slotCost = appSettings.slotBookingCost || 4;
        const formattedDateTime = formatSlotDateTime(slotDateTimeInput, 'full', new Date(slotDateTimeInput).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

        // Use setAlertMessage and setShowAlert for the confirmation dialog
        setAlertMessage(
            `Confirm booking for ${formattedDateTime}? ` +
            `A fee of ${slotCost} EUR will be deducted from your balance. If the slot is full, you will be added to the waiting list.`
        );
        setShowAlert(true);
        setAlertDialogOnConfirm(() => async () => {
            setShowAlert(false); // Close the confirmation alert
            setIsBookingSlot(true);
            try {
                const bookSlotCallable = httpsCallable(functions, 'bookSlot');
                const result = await bookSlotCallable({ slotId: slotId, appId: appId });

                if (result.data.success) {
                    if (result.data.waitlistPosition) {
                        // User added to waitlist, use setMessage for a simple toast
                        setMessage(`Slot is full. You have been added to the waiting list. Your position: ${result.data.waitlistPosition}. You will be notified if it becomes available.`);
                    } else {
                        // Slot booked successfully, use setMessage for a simple toast
                        setMessage(result.data.message || 'Slot booked successfully!');
                    }
                } else {
                    // Booking failed, use setAlertMessage for a prominent error
                    setAlertMessage(`Booking failed: ${result.data.message || 'Unknown error.'}`);
                    setShowAlert(true); // Show error alert
                }
            } catch (error) {
                console.error("Error booking slot:", error);
                setAlertMessage(`Failed to book slot: ${error.message}`);
                setShowAlert(true); // Show error alert
            } finally {
                setIsBookingSlot(false); // Reset loading state
                setAlertDialogOnConfirm(null); // Clear confirm action
                setAlertDialogOnCancel(null); // Clear cancel action
            }
        });
        setAlertDialogOnCancel(() => () => {
            setShowAlert(false); // Close the confirmation alert
            // setSelectedSlotForBooking(null); // This state isn't managed by this context.
            setAlertDialogOnConfirm(null);
            setAlertDialogOnCancel(null);
        });
    };

    const handleCancelBooking = async (slotId, slotDateTimeInput) => {
        // Remove setMessage('') and setAlertMessage('') here.
        if (!db || !userId || !functions) return;

        const formattedDateTime = formatSlotDateTime(slotDateTimeInput, 'full');

        // Use setAlertMessage and setShowAlert for the confirmation dialog
        setAlertMessage(
            `Are you sure you want to cancel the slot on ${formattedDateTime}? ` +
            `Your refund will be processed if a replacement player books the slot.`
        );
        setShowAlert(true);
        setAlertDialogOnConfirm(() => async () => {
            setIsCancellingBooking(true);
            setShowAlert(false); // Close the notification component immediately on confirm
            try {
                const cancelSlotCallable = httpsCallable(functions, 'cancelSlot');
                const result = await cancelSlotCallable({ slotId: slotId, appId: appId });

                if (result.data.success) {
                    // Cancellation success, use setMessage for a simple toast
                    setMessage(result.data.message || 'Slot cancellation requested! Refund will be processed if a replacement is found.');
                } else {
                    // Cancellation failed, use setAlertMessage for a prominent error
                    setAlertMessage(`Failed to cancel slot: ${result.data.message || 'Unknown error.'}`);
                    setShowAlert(true);
                }
            } catch (error) {
                console.error("Error cancelling slot:", error);
                setAlertMessage(`Error cancelling slot: ${error.message}`);
                setShowAlert(true);
            } finally {
                setIsCancellingBooking(false); // Reset loading state
                setAlertDialogOnConfirm(null);
                setAlertDialogOnCancel(null);
            }
        });
        setAlertDialogOnCancel(() => () => {
            setShowAlert(false); // Close the notification component on cancel
            setAlertDialogOnConfirm(null);
            setAlertDialogOnCancel(null);
        });
    };


    const handleUpdateUserName = async () => {
        setMessage('');
        setAlertMessage('');
        if (!db || !userId || !newUserName.trim()) {
            setAlertMessage('Name cannot be empty.');
            setShowAlert(true);
            return;
        }

        setIsUpdatingProfile(true);
        try {
            const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
            await updateDoc(userProfileRef, { name: newUserName });

            const publicUserRef = doc(db, `artifacts/${appId}/public/data/users/${userId}`);
            await updateDoc(publicUserRef, { name: newUserName });

            setMessage('Profile updated successfully!');
            setShowEditProfileModal(false);
        } catch (error) {
            console.error("Error updating user name:", error);
            setAlertMessage(`Failed to update profile: ${error.message}`);
            setShowAlert(true);
        } finally {
            setIsUpdatingProfile(false);
        }
    };

    const handleTopUp = async () => {
        setMessage('');
        setAlertMessage('');
        if (!db || !userId || !functions || !appSettings?.topUpPaymentLink) {
            setAlertMessage("Top-up service not available or app settings missing.");
            setShowAlert(true);
            return;
        }

        setIsToppingUp(true);
        try {
            const response = await fetch(appSettings.topUpPaymentLink, { method: 'POST' });
            
            if (response.ok) {
                const amount = 10;
                const processTopUpCallable = httpsCallable(functions, 'processTopUp');
                const result = await processTopUpCallable({ userId, appId, amount });

                if(result.data.success) {
                    setMessage(result.data.message || 'Top-up processed!');
                } else {
                    setAlertMessage(result.data.message || 'Top-up failed.');
                }
                setShowAlert(true);
            } else {
                setAlertMessage('Failed to initiate top-up payment.');
                setShowAlert(true);
            }
        } catch (error) {
            console.error("Error topping up:", error);
            setAlertMessage(`Error: ${error.message}`);
            setShowAlert(true);
        } finally {
            setIsToppingUp(false);
        }
    };

    const scrollToSection = useCallback((sectionId) => {
        const section = document.getElementById(sectionId);
        if (section) {
            section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    if (!isAuthReady || loadingDashboard || loadingRole) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-gray-600">
                <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mb-4"></div>
                <p>Loading member dashboard...</p>
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="text-center text-red-600 p-8">
                Please log in to view your dashboard.
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-8">
                Member Dashboard
            </h2>

            {message && (
                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg relative mb-4" role="alert">
                    <span className="block sm:inline">{message}</span>
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3">
                        <XCircle className="h-6 w-6 text-green-500 cursor-pointer" onClick={() => setMessage('')} />
                    </span>
                </div>
            )}
            {showAlert && (
                <CustomAlertDialog
                    message={alertMessage}
                    onConfirm={alertDialogOnConfirm || (() => setShowAlert(false))}
                    onCancel={alertDialogOnCancel || (() => setShowAlert(false))}
                    confirmText="Ok"
                    cancelText="Close"
                    showCancelButton={alertDialogOnCancel !== null}
                />
            )}

                <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col sm:flex-row items-center justify-between rounded-xl">
                    <div className="text-center sm:text-left mb-4 sm:mb-0">
                        <h3 className="text-2xl font-bold text-gray-800">Welcome, {userData?.name || 'Member'}!</h3>
                        <p className="text-gray-600">Your current balance: <span className="font-semibold text-blue-600">{balance} €</span></p>
                        {/* New: Transaction History Link */}
                        <button
                            onClick={() => scrollToSection('transaction-history-section')}
                            className="text-blue-600 hover:text-blue-800 text-sm font-medium underline mt-1 inline-flex items-center"
                        >
                            <List size={16} className="mr-1" /> View Transaction History
                        </button>
                        <p className="text-gray-600 mt-2">Your Elo Rating: <span className="font-semibold text-purple-600">{eloRating}</span></p>
                        <p className="text-gray-600">Your Grade: <span className="font-semibold text-purple-600">{getGrade(eloRating)}</span></p>
                        <p className="text-gray-600">Games Played: <span className="font-semibold text-orange-600">{userData?.gamesPlayed || 0}</span></p>
                        <p className="text-gray-600">Wins: <span className="font-semibold text-green-600">{userData?.wins || 0}</span></p>
                        <p className="text-gray-600">Losses: <span className="font-semibold text-red-600">{userData?.losses || 0}</span></p>
                    </div>
                    <div className="flex flex-col space-y-2">
                        <button
                            onClick={() => setShowEditProfileModal(true)}
                            className="bg-gray-200 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-300 transition duration-200 ease-in-out flex items-center justify-center"
                            disabled={isUpdatingProfile}
                        >
                            <Edit className="mr-2" size={20} /> {isUpdatingProfile ? 'Updating...' : 'Edit Profile'}
                        </button>
                        <button
                            onClick={handleTopUp}
                            className="bg-purple-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-purple-700 transition duration-200 ease-in-out flex items-center justify-center"
                            disabled={isToppingUp}
                        >
                            <DollarSign className="mr-2" size={20} /> {isToppingUp ? 'Processing...' : 'Top Up Balance'}
                        </button>
                    </div>
                </div>
                

                {waitingListMessages.length > 0 && (
                    <div className="bg-blue-50 p-6 rounded-2xl shadow-xl rounded-xl">
                        <h3 className="text-2xl font-bold text-blue-800 text-center mb-4">Waiting List Updates</h3>
                        <ul className="list-disc list-inside text-gray-700 space-y-2">
                            {waitingListMessages.map((msg, index) => (
                                <li key={index} className="flex items-center">
                                    <Bell className="text-blue-500 mr-2" size={18} /> {msg}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="bg-white p-6 rounded-2xl shadow-xl space-y-4 rounded-xl">
                    <h3 className="text-2xl font-bold text-gray-800 text-center">My Booked Slots</h3>
                    {myBookedSlots.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
                                <thead className="bg-gray-100 text-gray-600 uppercase text-sm leading-normal">
                                    <tr>
                                        <th className="py-3 px-6 text-left">Date</th>
                                        <th className="py-3 px-6 text-left">Time</th>
                                        <th className="py-3 px-6 text-left">Status</th> {/* Added Status column */}
                                        <th className="py-3 px-6 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600 text-sm font-light">
                                    {myBookedSlots.map(slot => (
                                        <tr key={slot.id} className="border-b border-gray-200 hover:bg-gray-50">
                                            <td className="py-3 px-6 text-left whitespace-nowrap">
                                                {formatSlotDateTime(slot.timestamp, 'date')}
                                            </td>
                                            <td className="py-3 px-6 text-left">
                                                {formatSlotDateTime(slot.timestamp, 'time', slot.time)}
                                            </td>
                                            <td className="py-3 px-6 text-left">
                                                <span className={`px-2 py-1 rounded-full text-xs font-semibold 
                                                    ${slot.statusDisplay === 'Confirmed' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                    {slot.statusDisplay}
                                                </span>
                                            </td> {/* Display status here */}
                                            <td className="py-3 px-6 text-center">
                                                {slot.statusDisplay === 'Confirmed' && ( // Only show cancel for confirmed slots
                                                    <button
                                                        onClick={() => handleCancelBooking(slot.id, slot.timestamp?.toDate() || `${slot.date}T${slot.time}:00`)}
                                                        className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition duration-200 ease-in-out"
                                                        title="Cancel Booking"
                                                        disabled={isCancellingBooking}
                                                    >
                                                        <XCircle size={18} />
                                                    </button>
                                                )}
                                                {slot.statusDisplay === 'Waiting List' && ( // Maybe add an option to leave waiting list
                                                    <span className="text-gray-500 italic text-sm">Waiting...</span>
                                                    // You could add a button here to `leaveWaitingList` if you implement such a Cloud Function
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-center text-gray-500">You have no upcoming booked slots or waiting list entries.</p>
                    )}
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-xl space-y-4 rounded-xl">
                    <h3 className="text-2xl font-bold text-gray-800 text-center">
                        Available Slots ({availableSlotCount}) {/* Display the count here */}
                    </h3>
                    {slots.filter(s => s.available && !s.isBooked && (s.timestamp?.toDate() || new Date()) >= new Date()).length > 0 ? (
                        <div className="overflow-x-auto max-h-80 custom-scrollbar"> {/* Added max-h-80 and custom-scrollbar */}
                            <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
                                <thead className="bg-gray-100 text-gray-600 uppercase text-sm leading-normal sticky top-0 bg-gray-100"> {/* Added sticky top-0 */}
                                    <tr>
                                        <th className="py-3 px-6 text-left">Date</th>
                                        <th className="py-3 px-6 text-left">Time</th>
                                        <th className="py-3 px-6 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600 text-sm font-light">
                                    {slots.filter(s => s.available && !s.isBooked && (s.timestamp?.toDate() || new Date()) >= new Date()).map(slot => (
                                        <tr key={slot.id} className="border-b border-gray-200 hover:bg-gray-50">
                                            <td className="py-3 px-6 text-left whitespace-nowrap">
                                                {formatSlotDateTime(slot.timestamp, 'date')}
                                            </td>
                                            <td className="py-3 px-6 text-left">
                                                {formatSlotDateTime(slot.timestamp, 'time', slot.time)}
                                            </td>
                                            <td className="py-3 px-6 text-center space-x-2">
                                                <button
                                                    onClick={() => handleBookSlot(slot.id, slot.timestamp?.toDate() || `${slot.date}T${slot.time}:00`)}
                                                    className="bg-blue-600 text-white p-2 rounded-full hover:bg-blue-700 transition duration-200 ease-in-out"
                                                    title="Book Slot"
                                                    disabled={isBookingSlot}
                                                >
                                                    <PlusCircle size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-center text-gray-500">No available slots at the moment.</p>
                    )}
                </div>

                <h3 className="text-2xl font-bold text-gray-800 mt-8 mb-4">My Matches</h3>
                {matches.length > 0 ? (
                    <ul className="space-y-4">
                        {matches.map(match => {
                            // Defensive check for the 'match' object itself
                            if (!match) {
                                console.warn("Found a null or undefined match object in the matches array.");
                                return null; // Skip rendering this entry
                            }
                            // Defensive checks for team1 and team2 properties
                            const team1Names = (match.team1 || []).map(uid => getMemberName(uid, allMembers)).join(' & ');
                            const team2Names = (match.team2 || []).map(uid => getMemberName(uid, allMembers)).join(' & ');
                            // console.log("scoredisplay", match);
                            // const scoreDisplay = (match.scores.team1 !== null && match.scores.team2 !== null) 
                            //     ? `${match.scores.team1} - ${match.scores.team2}` 
                            //     : 'N/A';
                            const statusColor = match.status === 'confirmed' ? 'text-green-600' : 
                                                match.status === 'pending_score' ? 'text-blue-600' :
                                                match.status === 'rejected' ? 'text-red-600' : 'text-yellow-600';

                            return (
                                <li key={match.id} className="bg-white p-4 rounded-xl shadow-md border border-gray-200">
                                    <p className="font-semibold text-lg text-gray-800 flex items-center mb-2">
                                        <Trophy size={18} className="mr-2 text-blue-500" /> Match on {formatSlotDateTime(match.slotTimestamp, 'date', match.slotTime)}
                                    </p>
                                    <p className="text-gray-700 ml-6 mb-1">
                                        <span className="font-medium">Teams:</span> {team1Names} vs {team2Names}
                                    </p>
                                    {/* <p className="text-gray-700 ml-6 mb-1">
                                        <span className="font-medium">Score:</span> {scoreDisplay}
                                    </p> */}
                                    <p className={`text-gray-700 ml-6 ${statusColor}`}>
                                        <span className="font-medium">Status:</span> {match.status.replace(/_/g, ' ')}
                                    </p>
                                    {match.status === 'pending_confirmation' && (
                                        <p className="text-gray-700 ml-6 text-sm">
                                            Confirmed by: {(match.confirmedBy || []).map(uid => getMemberName(uid, allMembers)).join(', ')}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="text-gray-600 text-center py-8 bg-gray-50 rounded-lg">No matches involving you found yet.</p>
                )}
                
                <div id="transaction-history-section" className="bg-white p-6 rounded-2xl shadow-xl space-y-4 rounded-xl"> {/* Added ID here */}
                    <h3 className="text-2xl font-bold text-gray-800 text-center">Transaction History</h3>
                    {transactions.length > 0 ? (
                        <div className="overflow-x-auto max-h-96 custom-scrollbar">
                            <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
                                <thead className="bg-gray-100 text-gray-600 uppercase text-sm leading-normal sticky top-0 bg-gray-100">
                                    <tr>
                                        <th className="py-3 px-6 text-left">Date & Time</th>
                                        <th className="py-3 px-6 text-left">Type</th>
                                        <th className="py-3 px-6 text-left">Description</th>
                                        <th className="py-3 px-6 text-right">Amount (€)</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600 text-sm font-light">
                                    {transactions.map(transaction => (
                                        <tr key={transaction.id} className="border-b border-gray-200 hover:bg-gray-50">
                                            <td className="py-3 px-6 text-left whitespace-nowrap">
                                                {formatSlotDateTime(transaction.timestamp, 'full')}
                                            </td>
                                            <td className="py-3 px-6 text-left">
                                                {transaction.type.replace(/_/g, ' ')}
                                            </td>
                                            <td className="py-3 px-6 text-left">
                                                {transaction.description}
                                            </td>
                                            <td className={`py-3 px-6 text-right font-semibold ${transaction.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>
                                                {transaction.amount.toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-center text-gray-500">No transaction history available.</p>
                    )}
                </div>

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
                                disabled={isUpdatingProfile}
                            >
                                {isUpdatingProfile ? 'Saving...' : 'Save Changes'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MemberDashboard;