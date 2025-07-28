import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, where, addDoc, getDocs, deleteDoc } from 'firebase/firestore';
import { Home, User, LogIn, Calendar, Trophy, DollarSign, Users, PlusCircle, CheckCircle, XCircle, Bell, Settings, LogOut, Edit, Clock, List, TrendingUp, Info } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog'; // Adjust the path if necessary


const LeaderboardPage = ({ db, appId }) => {
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!db) return;

        const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
        const unsubscribe = onSnapshot(usersRef, (snapshot) => {
            const fetchedMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Sort members by Elo rating in descending order
            const sortedMembers = fetchedMembers.sort((a, b) => (b.eloRating || 1000) - (a.eloRating || 1000));
            setMembers(sortedMembers);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching leaderboard data:", err);
            setError("Failed to load leaderboard. Please try again.");
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, appId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-xl text-gray-700">Loading Leaderboard...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-xl text-red-600">{error}</p>
            </div>
        );
    }

    return (
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-3xl w-full transform transition-all duration-300 ease-in-out hover:scale-105">
            <h2 className="text-3xl font-bold text-blue-700 mb-6 text-center flex items-center justify-center">
                <Trophy className="mr-2 text-yellow-500" size={32} /> Global Leaderboard
            </h2>
            {members.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white rounded-lg shadow-md">
                        <thead>
                            <tr className="bg-blue-100 text-blue-800 uppercase text-sm leading-normal">
                                <th className="py-3 px-6 text-left rounded-tl-lg">Rank</th>
                                <th className="py-3 px-6 text-left">Player Name</th>
                                <th className="py-3 px-6 text-center">Elo Rating</th>
                                <th className="py-3 px-6 text-center rounded-tr-lg">Games Played</th>
                            </tr>
                        </thead>
                        <tbody className="text-gray-700 text-sm font-light">
                            {members.map((member, index) => (
                                <tr key={member.id} className="border-b border-gray-200 hover:bg-gray-100">
                                    <td className="py-3 px-6 text-left whitespace-nowrap">
                                        <span className="font-medium">{index + 1}</span>
                                    </td>
                                    <td className="py-3 px-6 text-left">
                                        <div className="flex items-center">
                                            <div className="mr-2">
                                                <User className="text-gray-500" size={18} />
                                            </div>
                                            <span>{member.name}</span>
                                        </div>
                                    </td>
                                    <td className="py-3 px-6 text-center">
                                        <span className="font-bold text-blue-700">{Math.round(member.eloRating || 1000)}</span>
                                    </td>
                                    <td className="py-3 px-6 text-center">
                                        {member.gamesPlayed || 0}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <p className="text-center text-gray-500">No players to display on the leaderboard yet.</p>
            )}
        </div>
    );
};
export default LeaderboardPage;
