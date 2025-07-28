import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';

const RecurringSlotsModal = ({ onClose, onAddRecurringSlots, message }) => {
    const [startDate, setStartDate] = useState('');
    const [time, setTime] = useState('');
    const [recurrence, setRecurrence] = useState('weekly'); // Only weekly for now
    const [numWeeks, setNumWeeks] = useState(4); // Default to 4 weeks
  
    const handleSubmit = (e) => {
      e.preventDefault();
      onAddRecurringSlots({ startDate, time, recurrence, numWeeks });
    };
  
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
          <h3 className="text-2xl font-bold text-blue-700 text-center">Add Recurring Slots</h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="startDate" className="block text-gray-700 text-sm font-medium mb-2">Start Date</label>
              <input
                type="date"
                id="startDate"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="time" className="block text-gray-700 text-sm font-medium mb-2">Time</label>
              <input
                type="time"
                id="time"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="numWeeks" className="block text-gray-700 text-sm font-medium mb-2">Number of Weeks</label>
              <input
                type="number"
                id="numWeeks"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                value={numWeeks}
                onChange={(e) => setNumWeeks(Math.max(1, parseInt(e.target.value) || 1))}
                min="1"
                required
              />
            </div>
            <div className="flex justify-end space-x-4">
              <button
                type="button"
                onClick={onClose}
                className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
              >
                Add Recurring Slots
              </button>
            </div>
          </form>
          {message && (
            <p className={`mt-4 text-center ${message.includes('success') ? 'text-green-600' : 'text-red-600'} font-medium`}>
              {message}
            </p>
          )}
        </div>
      </div>
    );
  };
export default RecurringSlotsModal