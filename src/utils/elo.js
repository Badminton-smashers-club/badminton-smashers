import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';

const calculateEloChange = (playerElo, opponentElo, outcome, gamesPlayed = 0) => {
    // K-factor: Higher for newer players, lower for established players
    // This is a simplified variable K-factor. More advanced systems might use different thresholds.
    let kFactor;
    if (gamesPlayed < 10) { // New players have higher volatility
      kFactor = 40;
    } else if (playerElo < 1500) { // Mid-range players
      kFactor = 32;
    } else { // High-rated players
      kFactor = 24;
    }
  
    // Expected score for player A against player B
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
    // Elo change
    const eloChange = kFactor * (outcome - expectedScore);
    return eloChange;
  };
export default calculateEloChange;
  