import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog'; // Adjust the path if necessary


const HomePage = ({ navigate, isAuthenticated }) => {
    return (
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-2xl w-full text-center transform transition-all duration-300 ease-in-out hover:scale-105">
        <h2 className="text-5xl font-extrabold text-blue-700 mb-6 leading-tight">
          Welcome to <span className="text-purple-600">Smashers Badminton Group!</span>
        </h2>
        <p className="text-lg text-gray-700 mb-8">
          Your ultimate platform for managing badminton games, tracking scores, and connecting with fellow players.
        </p>
        <div className="space-y-4">
          {!isAuthenticated && (
            <button
              onClick={() => navigate('login')}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 px-6 rounded-xl text-xl font-semibold shadow-lg hover:from-blue-600 hover:to-indigo-700 transform hover:-translate-y-1 transition duration-300 ease-in-out"
            >
              <LogIn className="inline-block mr-2" size={24} /> Get Started - Login
            </button>
          )}
          {isAuthenticated && (
            <button
              onClick={() => navigate('memberDashboard')}
              className="w-full bg-gradient-to-r from-green-500 to-teal-600 text-white py-3 px-6 rounded-xl text-xl font-semibold shadow-lg hover:from-green-600 hover:to-teal-700 transform hover:-translate-y-1 transition duration-300 ease-in-out"
            >
              <User className="inline-block mr-2" size={24} /> Go to Dashboard
            </button>
          )}
        </div>
      </div>
    );
  };
export default HomePage;