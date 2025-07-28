import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog'; // Adjust the path if necessary

const MemberDashboard = ({ userId, publicUserId, db, appId, userData, setUserData }) => {
    const [balance, setBalance] = useState(userData?.balance || 0);
    const [scores, setScores] = useState(userData?.scores || []);
    const [eloRating, setEloRating] = useState(userData?.eloRating || 1000); // New state for Elo
    const [slots, setSlots] = useState([]); // All available slots
    const [myBookedSlots, setMyBookedSlots] = useState([]); // Slots booked by this user
    const [message, setMessage] = useState('');
    const [showBookingModal, setShowBookingModal] = useState(false);
    const [selectedSlotDate, setSelectedSlotDate] = useState('');
    const [selectedSlotTime, setSelectedSlotTime] = useState('');
    const [showEditProfileModal, setShowEditProfileModal] = useState(false);
    const [newUserName, setNewUserName] = useState(userData?.name || '');
    const [showPreBookingModal, setShowPreBookingModal] = useState(false);
    const [preBookDate, setPreBookDate] = useState('');
    const [preBookTime, setPreBookTime] = useState('');
    const [showWaitingListModal, setShowWaitingListModal] = useState(false);
    const [selectedWaitingSlot, setSelectedWaitingSlot] = useState(null);
    const [waitingListMessages, setWaitingListMessages] = useState([]);
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');
  
  
    // Fetch user data and slots on component mount and update
    useEffect(() => {
      if (!db || !userId) return;
  
      // Listen for changes to user's private profile data
      const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
      const unsubscribeProfile = onSnapshot(userProfileRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setUserData(data);
          setBalance(data.balance || 0);
          setScores(data.scores || []);
          setEloRating(data.eloRating || 1000); // Update Elo state
          setNewUserName(data.name || ''); // Update newUserName state if profile changes
        }
      }, (error) => console.error("Error fetching user profile:", error));
  
      // Listen for all available slots (public data)
      const slotsRef = collection(db, `artifacts/${appId}/public/data/slots`);
      const unsubscribeSlots = onSnapshot(slotsRef, (snapshot) => {
        const fetchedSlots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSlots(fetchedSlots);
        // Filter slots booked by the current user (using their Firebase Auth UID)
        setMyBookedSlots(fetchedSlots.filter(slot => slot.bookedBy === userId));
      }, (error) => console.error("Error fetching slots:", error));
  
      // Listen for waiting list updates for this user
      const waitingListRef = collection(db, `artifacts/${appId}/public/data/waitingLists`);
      const unsubscribeWaitingList = onSnapshot(waitingListRef, (snapshot) => {
          const messages = [];
          snapshot.docs.forEach(docSnap => {
              const data = docSnap.data();
              // Check if this user is the first in line for a slot that just became available
              if (data.users && data.users[0] === userId && data.slotAvailable) {
                  messages.push(`Slot on ${data.date} at ${data.time} is now available!`);
                  // Optionally, remove the message after displaying or mark it as read
                  // For now, just display. A more robust system would handle notification delivery.
              }
          });
          setWaitingListMessages(messages);
      }, (error) => console.error("Error fetching waiting list:", error));
  
  
      // Initial setup of dummy slots if none exist
      const setupDummySlots = async () => {
        const slotsCollectionRef = collection(db, `artifacts/${appId}/public/data/slots`);
        const existingSlots = await getDocs(slotsCollectionRef);
        if (existingSlots.empty) {
          console.log("Setting up dummy slots...");
          await addDoc(slotsCollectionRef, { date: '2025-08-01', time: '10:00', available: true, bookedBy: null, preBooked: false });
          await addDoc(slotsCollectionRef, { date: '2025-08-01', time: '11:00', available: true, bookedBy: null, preBooked: false });
          await addDoc(slotsCollectionRef, { date: '2025-08-02', time: '09:00', available: true, bookedBy: null, preBooked: false });
          await addDoc(slotsCollectionRef, { date: '2025-08-02', time: '10:00', available: true, bookedBy: null, preBooked: false });
          await addDoc(slotsCollectionRef, { date: '2025-08-08', time: '18:00', available: true, bookedBy: null, preBooked: false }); // For pre-booking
          await addDoc(slotsCollectionRef, { date: '2025-08-09', time: '19:00', available: true, bookedBy: null, preBooked: false }); // For pre-booking
        }
      };
      if (db) {
        setupDummySlots();
      }
  
      return () => {
        unsubscribeProfile();
        unsubscribeSlots();
        unsubscribeWaitingList();
      }; // Clean up listeners
    }, [db, userId, appId, setUserData]);
  
    const handleBookSlot = async () => {
      setMessage('');
      setAlertMessage('');
      if (!selectedSlotDate || !selectedSlotTime) {
        setAlertMessage('Please select a date and time to book.');
        setShowAlert(true);
        return;
      }
  
      // Check if the slot is actually available
      const slotToBook = slots.find(s => s.date === selectedSlotDate && s.time === selectedSlotTime && s.available);
  
      if (!slotToBook) {
        setAlertMessage('Selected slot is not available or does not exist.');
        setShowAlert(true);
        return;
      }
  
      if (balance < 10) { // Assume 10 euros per slot
        setAlertMessage('Insufficient balance to book this slot. Please top up.');
        setShowAlert(true);
        return;
      }
  
      try {
        const slotDocRef = doc(db, `artifacts/${appId}/public/data/slots`, slotToBook.id);
        await updateDoc(slotDocRef, {
          available: false,
          bookedBy: userId // Store Firebase Auth UID
        });
  
        // Deduct balance from private profile
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        await updateDoc(userProfileRef, {
          balance: balance - 10 // Deduct 10 euros
        });
  
        // Deduct balance from public user data as well for admin view consistency
        if (publicUserId) {
          const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, publicUserId);
          await updateDoc(publicUserDocRef, {
            balance: balance - 10
          });
        }
  
        setMessage(`Slot on ${selectedSlotDate} at ${selectedSlotTime} booked successfully! 10€ deducted.`);
        setShowBookingModal(false);
        setSelectedSlotDate('');
        setSelectedSlotTime('');
      } catch (error) {
        console.error("Error booking slot:", error);
        setAlertMessage('Failed to book slot. Please try again.');
        setShowAlert(true);
      }
    };
  
    const handleCancelSlot = async (slotId, slotDate, slotTime) => {
      setMessage('');
      setAlertMessage('');
      const confirmed = await new Promise(resolve => {
          const confirmModal = document.createElement('div');
          confirmModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
          confirmModal.innerHTML = `
              <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-6 text-center">
                  <h3 class="text-2xl font-bold text-red-700">Confirm Cancellation</h3>
                  <p class="text-lg text-gray-700">Are you sure you want to cancel the slot on ${slotDate} at ${slotTime}? This will refund your balance.</p>
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
          available: true,
          bookedBy: null,
          preBooked: false // Reset pre-booked status on cancellation
        });
  
        // Refund balance to private profile
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        await updateDoc(userProfileRef, {
          balance: balance + 10 // Refund 10 euros
        });
  
        // Refund balance to public user data as well
        if (publicUserId) {
          const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, publicUserId);
          await updateDoc(publicUserDocRef, {
            balance: balance + 10
          });
        }
  
        // Check waiting list for this slot
        const waitingListDocRef = doc(db, `artifacts/${appId}/public/data/waitingLists`, `${slotDate}_${slotTime}`);
        const waitingListSnap = await getDoc(waitingListDocRef);
  
        if (waitingListSnap.exists()) {
            const waitingListData = waitingListSnap.data();
            if (waitingListData.users && waitingListData.users.length > 0) {
                const nextUserInLine = waitingListData.users[0];
                // Notify the next user in line (in-app message for this demo)
                // In a real app, this would trigger a push notification
                // For now, we'll mark the slot as available for them and remove them from the list.
                const updatedWaitingUsers = waitingListData.users.slice(1);
                await updateDoc(waitingListDocRef, { users: updatedWaitingUsers, slotAvailable: true }); // Mark slot available for the first user
                setMessage(`Slot on ${slotDate} at ${slotTime} cancelled. Notified next person on waiting list.`);
            } else {
                setMessage(`Slot on ${slotDate} at ${slotTime} cancelled successfully! 10€ refunded.`);
                await deleteDoc(waitingListDocRef); // No more users on waiting list, delete the entry
            }
        } else {
            setMessage(`Slot on ${slotDate} at ${slotTime} cancelled successfully! 10€ refunded.`);
        }
  
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
        if (publicUserId) {
          const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, publicUserId);
          await updateDoc(publicUserDocRef, {
            name: newUserName.trim()
          });
        }
  
        setMessage('Profile name updated successfully!');
        setShowEditProfileModal(false);
      } catch (error) {
        console.error("Error updating user name:", error);
        setAlertMessage('Failed to update profile. Please try again.');
        setShowAlert(true);
      }
    };
  
    const handlePreBookSlot = async () => {
      setMessage('');
      setAlertMessage('');
      if (!preBookDate || !preBookTime) {
        setAlertMessage('Please select a date and time for pre-booking.');
        setShowAlert(true);
        return;
      }
  
      // Check if the slot is available
      const slotToPreBook = slots.find(s => s.date === preBookDate && s.time === preBookTime && s.available);
  
      if (!slotToPreBook) {
        setAlertMessage('Selected pre-booking slot is not available or does not exist.');
        setShowAlert(true);
        return;
      }
  
      if (balance < 10) { // Assume 10 euros per slot
        setAlertMessage('Insufficient balance to pre-book this slot. Please top up.');
        setShowAlert(true);
        return;
      }
  
      try {
        const slotDocRef = doc(db, `artifacts/${appId}/public/data/slots`, slotToPreBook.id);
        await updateDoc(slotDocRef, {
          available: false,
          bookedBy: userId, // Store Firebase Auth UID
          preBooked: true // Mark as pre-booked
        });
  
        // Deduct balance from private profile
        const userProfileRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
        await updateDoc(userProfileRef, {
          balance: balance - 10 // Deduct 10 euros
        });
  
        // Deduct balance from public user data as well for admin view consistency
        if (publicUserId) {
          const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, publicUserId);
          await updateDoc(publicUserDocRef, {
            balance: balance - 10
          });
        }
  
        setMessage(`Slot on ${preBookDate} at ${preBookTime} pre-booked successfully! 10€ deducted.`);
        setShowPreBookingModal(false);
        setPreBookDate('');
        setPreBookTime('');
      } catch (error) {
        console.error("Error pre-booking slot:", error);
        setAlertMessage('Failed to pre-book slot. Please try again.');
        setShowAlert(true);
      }
    };
  
    const handleJoinWaitingList = async () => {
      setMessage('');
      setAlertMessage('');
      if (!selectedWaitingSlot || !selectedWaitingSlot.date || !selectedWaitingSlot.time) {
          setAlertMessage('No slot selected for waiting list.');
          setShowAlert(true);
          return;
      }
  
      const { date, time } = selectedWaitingSlot;
      const waitingListDocRef = doc(db, `artifacts/${appId}/public/data/waitingLists`, `${date}_${time}`);
  
      try {
          const docSnap = await getDoc(waitingListDocRef);
          let usersOnList = [];
          if (docSnap.exists()) {
              usersOnList = docSnap.data().users || [];
          }
  
          if (usersOnList.includes(userId)) {
              setAlertMessage('You are already on the waiting list for this slot.');
              setShowAlert(true);
              setShowWaitingListModal(false);
              return;
          }
  
          usersOnList.push(userId);
          await setDoc(waitingListDocRef, { date, time, users: usersOnList, slotAvailable: false }, { merge: true });
          setMessage(`Joined waiting list for ${date} at ${time}.`);
          setShowWaitingListModal(false);
      } catch (error) {
          console.error("Error joining waiting list:", error);
          setAlertMessage('Failed to join waiting list. Please try again.');
          setShowAlert(true);
      }
    };
  
  
    const availableSlots = slots.filter(slot => slot.available);
    const uniqueDates = [...new Set(availableSlots.map(slot => slot.date))].sort();
    const timesForSelectedDate = selectedSlotDate ? availableSlots.filter(slot => slot.date === selectedSlotDate).map(slot => slot.time).sort() : [];
  
    // Filter slots for pre-booking (e.g., more than 2 days in advance)
    const today = new Date();
    const twoDaysLater = new Date(today);
    twoDaysLater.setDate(today.getDate() + 2);
  
    const preBookableSlots = slots.filter(slot => {
      const slotDateTime = new Date(`${slot.date}T${slot.time}`);
      return slot.available && slotDateTime > twoDaysLater;
    });
    const uniquePreBookDates = [...new Set(preBookableSlots.map(slot => slot.date))].sort();
    const timesForSelectedPreBookDate = preBookDate ? preBookableSlots.filter(slot => slot.date === preBookDate).map(slot => slot.time).sort() : [];
  
    // Filter for slots that are booked and can be potentially cancelled
    const cancellableSlots = myBookedSlots.filter(slot => slot.bookedBy === userId);
  
    // Filter for slots that are NOT available and can be joined on a waiting list
    const unavailableSlots = slots.filter(slot => !slot.available);
    const uniqueUnavailableDates = [...new Set(unavailableSlots.map(slot => slot.date))].sort();
    const timesForSelectedUnavailableDate = selectedWaitingSlot?.date ? unavailableSlots.filter(slot => slot.date === selectedWaitingSlot.date).map(slot => slot.time).sort() : [];
  
  
    return (
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-4xl w-full flex flex-col lg:flex-row gap-8 transform transition-all duration-300 ease-in-out hover:scale-105">
        {/* Left Section: Balance and Scores */}
        <div className="flex-1 space-y-6">
          <h2 className="text-3xl font-bold text-blue-700 mb-4">Member Dashboard</h2>
          <p className="text-gray-600 text-lg mb-4">Welcome, <span className="font-semibold text-blue-800">{userData?.name || 'Member'}</span>!</p>
          <p className="text-gray-500 text-sm">Your User ID: <span className="font-mono text-xs break-all">{userId}</span></p>
          <p className="text-gray-500 text-sm">Your Public Profile ID: <span className="font-mono text-xs break-all">{publicUserId || 'N/A'}</span></p>
  
  
          {/* Balance */}
          <div className="bg-blue-50 p-6 rounded-xl shadow-md flex items-center justify-between">
            <div className="flex items-center">
              <DollarSign className="text-green-600 mr-3" size={32} />
              <h3 className="text-xl font-semibold text-gray-800">Current Balance:</h3>
            </div>
            <span className="text-3xl font-bold text-green-700">{balance.toFixed(2)} €</span>
          </div>
  
          {/* Elo Rating */}
          <div className="bg-green-50 p-6 rounded-xl shadow-md flex items-center justify-between">
            <div className="flex items-center">
              <TrendingUp className="text-blue-600 mr-3" size={32} />
              <h3 className="text-xl font-semibold text-gray-800">Your Elo Rating:</h3>
            </div>
            <span className="text-3xl font-bold text-blue-700">{Math.round(eloRating)}</span>
          </div>
  
          {/* Edit Profile */}
          <div className="bg-orange-50 p-6 rounded-xl shadow-md">
            <h3 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <Edit className="text-orange-600 mr-2" size={22} /> Edit Profile
            </h3>
            <button
              onClick={() => setShowEditProfileModal(true)}
              className="w-full bg-orange-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-orange-700 transition duration-200 ease-in-out flex items-center justify-center"
            >
              <Edit className="mr-2" size={20} /> Update My Name
            </button>
          </div>
  
          {/* Past Performance */}
          <div className="bg-purple-50 p-6 rounded-xl shadow-md">
            <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
              <Trophy className="text-yellow-600 mr-2" size={24} /> Past Performance
            </h3>
            {scores.length > 0 ? (
              <ul className="space-y-2">
                {scores.map((score, index) => (
                  <li key={index} className="flex justify-between items-center text-gray-700 bg-white p-3 rounded-lg shadow-sm">
                    <span>{score.date}: vs {score.opponent} - Score: {score.score}</span>
                    <span className={`font-semibold ${score.win ? 'text-green-600' : 'text-red-600'}`}>
                      {score.win ? 'Win' : 'Loss'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">No past matches recorded yet.</p>
            )}
          </div>
        </div>
  
        {/* Right Section: Slot Management */}
        <div className="flex-1 space-y-6">
          <h3 className="text-2xl font-bold text-blue-700 mb-4 flex items-center">
            <Calendar className="mr-2 text-indigo-600" size={28} /> Slot Management
          </h3>
  
          {/* Book Slot Section */}
          <div className="bg-green-50 p-6 rounded-xl shadow-md">
            <h4 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <PlusCircle className="text-green-600 mr-2" size={22} /> Book a Slot (Today/Tomorrow)
            </h4>
            <button
              onClick={() => setShowBookingModal(true)}
              className="w-full bg-green-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-green-700 transition duration-200 ease-in-out flex items-center justify-center"
            >
              <Calendar className="mr-2" size={20} /> Find & Book Slot
            </button>
          </div>
  
          {/* Pre-Book Slot Section */}
          <div className="bg-blue-50 p-6 rounded-xl shadow-md">
            <h4 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <Calendar className="text-blue-600 mr-2" size={22} /> Pre-Book Slot (Long Term)
            </h4>
            <button
              onClick={() => setShowPreBookingModal(true)}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out flex items-center justify-center"
            >
              <Calendar className="mr-2" size={20} /> Pre-Book Future Slot
            </button>
          </div>
  
          {/* Join Waiting List Section */}
          <div className="bg-yellow-50 p-6 rounded-xl shadow-md">
            <h4 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <List className="text-yellow-600 mr-2" size={22} /> Join Waiting List
            </h4>
            <button
              onClick={() => setShowWaitingListModal(true)}
              className="w-full bg-yellow-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-yellow-700 transition duration-200 ease-in-out flex items-center justify-center"
            >
              <Clock className="mr-2" size={20} /> Join Waiting List
            </button>
          </div>
  
          {/* My Booked Slots Section */}
          <div className="bg-red-50 p-6 rounded-xl shadow-md">
            <h4 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <XCircle className="text-red-600 mr-2" size={22} /> My Booked Slots
            </h4>
            {cancellableSlots.length > 0 ? (
              <ul className="space-y-2">
                {cancellableSlots.map(slot => (
                  <li key={slot.id} className="flex justify-between items-center bg-white p-3 rounded-lg shadow-sm">
                    <span>{slot.date} at {slot.time} {slot.preBooked ? '(Pre-booked)' : ''}</span>
                    <button
                      onClick={() => handleCancelSlot(slot.id, slot.date, slot.time)}
                      className="bg-red-500 text-white px-3 py-1 rounded-md text-sm hover:bg-red-600 transition duration-200 ease-in-out"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">You have no slots booked.</p>
            )}
          </div>
  
          {message && (
            <div className={`mt-4 p-3 rounded-lg text-center ${message.includes('success') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {message}
            </div>
          )}
          {waitingListMessages.map((msg, index) => (
              <div key={index} className="mt-2 p-3 rounded-lg text-center bg-blue-100 text-blue-700">
                  <Bell className="inline-block mr-2" size={18} /> {msg}
              </div>
          ))}
        </div>
  
        {/* Booking Modal */}
        {showBookingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
              <h3 className="text-2xl font-bold text-blue-700 text-center">Book a Slot</h3>
              <div>
                <label htmlFor="slotDate" className="block text-gray-700 text-sm font-medium mb-2">Select Date</label>
                <select
                  id="slotDate"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={selectedSlotDate}
                  onChange={(e) => { setSelectedSlotDate(e.target.value); setSelectedSlotTime(''); }}
                  required
                >
                  <option value="">-- Select Date --</option>
                  {uniqueDates.map(date => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="slotTime" className="block text-gray-700 text-sm font-medium mb-2">Select Time</label>
                <select
                  id="slotTime"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={selectedSlotTime}
                  onChange={(e) => setSelectedSlotTime(e.target.value)}
                  required
                  disabled={!selectedSlotDate}
                >
                  <option value="">-- Select Time --</option>
                  {timesForSelectedDate.map(time => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setShowBookingModal(false)}
                  className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBookSlot}
                  className="bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
                >
                  Book Slot (10€)
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
  
        {/* Pre-Booking Modal */}
        {showPreBookingModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
              <h3 className="text-2xl font-bold text-blue-700 text-center">Pre-Book a Future Slot</h3>
              <div>
                <label htmlFor="preBookDate" className="block text-gray-700 text-sm font-medium mb-2">Select Date</label>
                <select
                  id="preBookDate"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={preBookDate}
                  onChange={(e) => { setPreBookDate(e.target.value); setPreBookTime(''); }}
                  required
                >
                  <option value="">-- Select Date --</option>
                  {uniquePreBookDates.map(date => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="preBookTime" className="block text-gray-700 text-sm font-medium mb-2">Select Time</label>
                <select
                  id="preBookTime"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={preBookTime}
                  onChange={(e) => setPreBookTime(e.target.value)}
                  required
                  disabled={!preBookDate}
                >
                  <option value="">-- Select Time --</option>
                  {timesForSelectedPreBookDate.map(time => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setShowPreBookingModal(false)}
                  className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePreBookSlot}
                  className="bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
                >
                  Pre-Book Slot (10€)
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
  
        {/* Join Waiting List Modal */}
        {showWaitingListModal && (
          <div className="fixed inset-0 bg-black bg-opacity50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
              <h3 className="text-2xl font-bold text-blue-700 text-center">Join Waiting List</h3>
              <div>
                <label htmlFor="waitingDate" className="block text-gray-700 text-sm font-medium mb-2">Select Date (Unavailable Slots)</label>
                <select
                  id="waitingDate"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={selectedWaitingSlot?.date || ''}
                  onChange={(e) => {
                      const date = e.target.value;
                      setSelectedWaitingSlot({ date, time: '' });
                  }}
                  required
                >
                  <option value="">-- Select Date --</option>
                  {uniqueUnavailableDates.map(date => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="waitingTime" className="block text-gray-700 text-sm font-medium mb-2">Select Time</label>
                <select
                  id="waitingTime"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={selectedWaitingSlot?.time || ''}
                  onChange={(e) => {
                      setSelectedWaitingSlot(prev => ({ ...prev, time: e.target.value }));
                  }}
                  required
                  disabled={!selectedWaitingSlot?.date}
                >
                  <option value="">-- Select Time --</option>
                  {timesForSelectedUnavailableDate.map(time => (
                    <option key={time} value={time}>{time}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setShowWaitingListModal(false)}
                  className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
                >
                  Cancel
                </button>
                <button
                  onClick={handleJoinWaitingList}
                  className="bg-yellow-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-yellow-700 transition duration-200 ease-in-out"
                >
                  Join Waiting List
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
  
        {/* Edit Profile Modal */}
        {showEditProfileModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
              <h3 className="text-2xl font-bold text-blue-700 text-center">Edit Your Profile</h3>
              <div>
                <label htmlFor="newUserName" className="block text-gray-700 text-sm font-medium mb-2">Your Name</label>
                <input
                  type="text"
                  id="newUserName"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
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
export default MemberDashboard