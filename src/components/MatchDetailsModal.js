import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';

const MatchDetailsModal = ({ match, members, onClose }) => {
    // Helper to get member name from Firebase Auth UID
    const getMemberName = (firebaseAuthUid) => members.find(m => m.firebaseAuthUid === firebaseAuthUid)?.name || 'Unknown Player';
  
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-md w-full space-y-6">
          <h3 className="text-2xl font-bold text-blue-700 text-center">Match Details</h3>
          <div className="space-y-2 text-gray-700">
            <p><strong>Date:</strong> {match.date}</p>
            <p><strong>Team 1:</strong> {match.team1.map(getMemberName).join(' & ')}</p>
            <p><strong>Team 2:</strong> {match.team2.map(getMemberName).join(' & ')}</p>
            <p className="text-xl font-bold text-blue-800">Score: {match.score1} - {match.score2}</p>
            <p><strong>Added By:</strong> {getMemberName(match.addedBy)}</p>
            <p><strong>Confirmed By:</strong> {match.confirmedBy.length > 0 ? match.confirmedBy.map(getMemberName).join(', ') : 'None'}</p>
            <p><strong>Status:</strong> <span className={`font-semibold ${match.status === 'confirmed' ? 'text-green-600' : 'text-orange-600'}`}>{match.status.replace('_', ' ')}</span></p>
            {/* You could add Elo changes here if stored per match */}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg shadow-md hover:bg-gray-400 transition duration-200 ease-in-out"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  };

export default MatchDetailsModal