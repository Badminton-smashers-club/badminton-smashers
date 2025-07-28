import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog'; // Adjust the path if necessary
import RecurringSlotsModal from '../components/RecurringSlotsModal'; // Adjust the path if necessary


const AdminDashboard = ({ userId, db, appId }) => {
    const [members, setMembers] = useState([]);
    const [slots, setSlots] = useState([]); // All slots, including booked ones
    const [newSlotDate, setNewSlotDate] = useState('');
    const [newSlotTime, setNewSlotTime] = useState('');
    const [message, setMessage] = useState('');
    const [showMemberModal, setShowMemberModal] = useState(false);
    const [currentMember, setCurrentMember] = useState(null);
    const [memberBalanceInput, setMemberBalanceInput] = useState('');
    const [showRecurringSlotModal, setShowRecurringSlotModal] = useState(false);
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');
  
  
    // Fetch members and slots
    useEffect(() => {
      if (!db) return;
  
      // Listen for all users (members and admins) from the public collection
      const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
      const unsubscribeUsers = onSnapshot(usersRef, (snapshot) => {
        const fetchedMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMembers(fetchedMembers);
      }, (error) => console.error("Error fetching members:", error));
  
      // Listen for all slots
      const slotsRef = collection(db, `artifacts/${appId}/public/data/slots`);
      const unsubscribeSlots = onSnapshot(slotsRef, (snapshot) => {
        const fetchedSlots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSlots(fetchedSlots);
      }, (error) => console.error("Error fetching slots:", error));
  
      return () => {
        unsubscribeUsers();
        unsubscribeSlots();
      };
    }, [db, appId]);
  
    const handleAddSlot = async (e) => {
      e.preventDefault();
      setMessage('');
      setAlertMessage('');
      if (!newSlotDate || !newSlotTime) {
        setAlertMessage('Please enter both date and time for the new slot.');
        setShowAlert(true);
        return;
      }
  
      try {
        const slotsCollectionRef = collection(db, `artifacts/${appId}/public/data/slots`);
        await addDoc(slotsCollectionRef, {
          date: newSlotDate,
          time: newSlotTime,
          available: true,
          bookedBy: null,
          preBooked: false // New slots are not pre-booked initially
        });
        setMessage('Slot added successfully!');
        setNewSlotDate('');
        setNewSlotTime('');
      } catch (error) {
        console.error("Error adding slot:", error);
        setAlertMessage('Failed to add slot. Please try again.');
        setShowAlert(true);
      }
    };
  
    const handleDeleteSlot = async (slotId, slotDate, slotTime) => {
      setMessage('');
      setAlertMessage('');
      const confirmed = await new Promise(resolve => {
          const confirmModal = document.createElement('div');
          confirmModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4';
          confirmModal.innerHTML = `
              <div class="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full space-y-6 text-center">
                  <h3 class="text-2xl font-bold text-red-700">Confirm Deletion</h3>
                  <p class="text-lg text-gray-700">Are you sure you want to delete the slot on ${slotDate} at ${slotTime}? This action cannot be undone.</p>
                  <div class="flex justify-center space-x-4 mt-6">
                      <button id="cancelDelete" class="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out">Cancel</button>
                      <button id="confirmDelete" class="bg-red-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-red-700 transition duration-200 ease-in-out">Delete</button>
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
        await deleteDoc(slotDocRef);
        setMessage('Slot deleted successfully!');
      } catch (error) {
        console.error("Error deleting slot:", error);
        setAlertMessage('Failed to delete slot. Please try again.');
        setShowAlert(true);
      }
    };
  
    const handleOpenMemberModal = (member) => {
      setCurrentMember(member);
      setMemberBalanceInput(member.balance?.toFixed(2) || '0.00');
      setShowMemberModal(true);
    };
  
    const handleUpdateMemberBalance = async () => {
      setMessage('');
      setAlertMessage('');
      if (!currentMember || isNaN(parseFloat(memberBalanceInput))) {
        setAlertMessage('Invalid balance input.');
        setShowAlert(true);
        return;
      }
      const newBalance = parseFloat(memberBalanceInput);
      try {
        // Update the public user data (master record)
        const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, currentMember.id);
        await updateDoc(publicUserDocRef, {
          balance: newBalance
        });
  
        // Also update the user's private profile data if they have a linked Firebase Auth UID
        if (currentMember.firebaseAuthUid) {
          const privateUserDocRef = doc(db, `artifacts/${appId}/users/${currentMember.firebaseAuthUid}/profile/data`);
          const privateUserDocSnap = await getDoc(privateUserDocRef);
          if (privateUserDocSnap.exists()) {
             await updateDoc(privateUserDocRef, {
                balance: newBalance
             });
          }
        }
  
        setMessage(`Balance for ${currentMember.name} updated successfully!`);
        setShowMemberModal(false);
      } catch (error) {
        console.error("Error updating member balance:", error);
        setAlertMessage('Failed to update member balance. Please try again.');
        setShowAlert(true);
      }
    };
  
    const handleAddRecurringSlots = async ({ startDate, time, recurrence, numWeeks }) => {
      setMessage('');
      setAlertMessage('');
      if (!startDate || !time || !numWeeks) {
        setAlertMessage('Please fill all fields for recurring slots.');
        setShowAlert(true);
        return;
      }
  
      try {
        const slotsCollectionRef = collection(db, `artifacts/${appId}/public/data/slots`);
        let currentDate = new Date(startDate + 'T' + time); // Combine date and time to handle timezone issues
        let slotsAddedCount = 0;
  
        for (let i = 0; i < numWeeks; i++) {
          // Ensure the date is correctly formatted as YYYY-MM-DD
          const slotDate = currentDate.toISOString().split('T')[0];
          const slotTime = time; // Time remains constant
  
          await addDoc(slotsCollectionRef, {
            date: slotDate,
            time: slotTime,
            available: true,
            bookedBy: null,
            preBooked: false,
            isRecurring: true // Mark as recurring
          });
          slotsAddedCount++;
  
          // Move to the next week
          currentDate.setDate(currentDate.getDate() + 7);
        }
        setMessage(`${slotsAddedCount} recurring slots added successfully!`);
        setShowRecurringSlotModal(false);
      } catch (error) {
        console.error("Error adding recurring slots:", error);
        setAlertMessage('Failed to add recurring slots. Please try again.');
        setShowAlert(true);
      }
    };
  
    // Helper to get member name from Firebase Auth UID
    const getMemberName = (firebaseAuthUid) => members.find(m => m.firebaseAuthUid === firebaseAuthUid)?.name || 'Unknown Player';
  
    return (
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-5xl w-full flex flex-col lg:flex-row gap-8 transform transition-all duration-300 ease-in-out hover:scale-105">
        {/* Left Section: Member Management */}
        <div className="flex-1 space-y-6">
          <h2 className="text-3xl font-bold text-blue-700 mb-4 flex items-center">
            <Users className="mr-2 text-purple-600" size={32} /> Member Management
          </h2>
          <p className="text-gray-500 text-sm">Admin User ID: <span className="font-mono text-xs break-all">{userId}</span></p>
  
          <div className="bg-blue-50 p-6 rounded-xl shadow-md">
            <h3 className="text-xl font-semibold text-gray-800 mb-4">All Members</h3>
            {members.length > 0 ? (
              <ul className="space-y-3">
                {members.map(member => (
                  <li key={member.id} className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-blue-200">
                    <div>
                      <span className="font-semibold text-blue-700">{member.name}</span> ({member.role})
                      <p className="text-sm text-gray-600">Balance: {member.balance?.toFixed(2) || '0.00'} €</p>
                      <p className="text-sm text-gray-600">Elo: {Math.round(member.eloRating || 1000)}</p> {/* Display Elo */}
                      <p className="text-xs text-gray-500">Public ID: {member.id}</p>
                      <p className="text-xs text-gray-500">Auth UID: {member.firebaseAuthUid ? member.firebaseAuthUid.substring(0, 8) + '...' : 'N/A'}</p>
                    </div>
                    <button
                      onClick={() => handleOpenMemberModal(member)}
                      className="bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-600 transition duration-200 ease-in-out"
                    >
                      Manage
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">No members found.</p>
            )}
          </div>
        </div>
  
        {/* Right Section: Slot Management */}
        <div className="flex-1 space-y-6">
          <h3 className="text-3xl font-bold text-blue-700 mb-4 flex items-center">
            <Calendar className="mr-2 text-indigo-600" size={32} /> Slot Management
          </h3>
  
          {/* Add New Slot */}
          <div className="bg-green-50 p-6 rounded-xl shadow-md">
            <h4 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <PlusCircle className="text-green-600 mr-2" size={22} /> Add New Slot
            </h4>
            <form onSubmit={handleAddSlot} className="space-y-4">
              <div>
                <label htmlFor="newSlotDate" className="block text-gray-700 text-sm font-medium mb-2">Date</label>
                <input
                  type="date"
                  id="newSlotDate"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={newSlotDate}
                  onChange={(e) => setNewSlotDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label htmlFor="newSlotTime" className="block text-gray-700 text-sm font-medium mb-2">Time</label>
                <input
                  type="time"
                  id="newSlotTime"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={newSlotTime}
                  onChange={(e) => setNewSlotTime(e.target.value)}
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out flex items-center justify-center"
              >
                <PlusCircle className="mr-2" size={20} /> Add Slot
              </button>
            </form>
          </div>
  
          {/* Recurring Slot */}
          <div className="bg-orange-50 p-6 rounded-xl shadow-md">
              <h4 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
                  <Clock className="text-orange-600 mr-2" size={22} /> Add Recurring Slots
              </h4>
              <button
                  onClick={() => setShowRecurringSlotModal(true)}
                  className="w-full bg-orange-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-orange-700 transition duration-200 ease-in-out flex items-center justify-center"
              >
                  <PlusCircle className="mr-2" size={20} /> Configure Recurring Slots
              </button>
          </div>
  
          {/* Existing Slots */}
          <div className="bg-red-50 p-6 rounded-xl shadow-md">
            <h4 className="text-xl font-semibold text-gray-800 mb-3 flex items-center">
              <Calendar className="text-red-600 mr-2" size={22} /> All Slots
            </h4>
            {slots.length > 0 ? (
              <ul className="space-y-3">
                {slots.map(slot => (
                  <li key={slot.id} className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-red-200">
                    <div>
                      <span className="font-semibold text-gray-800">{slot.date} at {slot.time} {slot.preBooked ? '(Pre-booked)' : ''} {slot.isRecurring ? '(Recurring)' : ''}</span>
                      <p className="text-sm text-gray-600">Status: {slot.available ? 'Available' : `Booked by ${slot.bookedBy ? getMemberName(slot.bookedBy) : 'N/A'}`}</p>
                    </div>
                    <button
                      onClick={() => handleDeleteSlot(slot.id, slot.date, slot.time)}
                      className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-600 transition duration-200 ease-in-out"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500">No slots created yet.</p>
            )}
          </div>
  
          {message && (
            <div className={`mt-4 p-3 rounded-lg text-center ${message.includes('success') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {message}
            </div>
          )}
        </div>
  
        {/* Member Management Modal */}
        {showMemberModal && currentMember && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
              <h3 className="text-2xl font-bold text-blue-700 text-center">Manage Member: {currentMember.name}</h3>
              <div>
                <label htmlFor="memberBalance" className="block text-gray-700 text-sm font-medium mb-2">Update Balance (€)</label>
                <input
                  type="number"
                  id="memberBalance"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={memberBalanceInput}
                  onChange={(e) => setMemberBalanceInput(e.target.value)}
                  step="0.01"
                />
              </div>
              <div className="flex justify-end space-x-4">
                <button
                  onClick={() => setShowMemberModal(false)}
                  className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateMemberBalance}
                  className="bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
                >
                  Update Balance
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
  
        {/* Recurring Slot Modal */}
        {showRecurringSlotModal && (
          <RecurringSlotsModal
            onClose={() => setShowRecurringSlotModal(false)}
            onAddRecurringSlots={handleAddRecurringSlots}
            message={message} // Pass message from AdminDashboard state
          />
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

export default AdminDashboard;