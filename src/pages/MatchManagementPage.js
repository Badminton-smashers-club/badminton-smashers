import React, { useState, useEffect, useCallback, useContext } from 'react';
import { AppContext } from '../App';
import { collection, query, where, getDocs, doc, onSnapshot, orderBy, startAfter, limit, endBefore, limitToLast, deleteDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { getAuth } from 'firebase/auth'; // Import getAuth
import { isSameDay, startOfDay, format } from 'date-fns';

const ITEMS_PER_PAGE = 10;

const MatchManagementPage = () => {
    const { firestore, functions, firebaseApp, appId, user } = useContext(AppContext);
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newMatchData, setNewMatchData] = useState({
        slotDate: '',
        slotTime: '',
        gameType: '',
        team1Players: [],
        team2Players: [],
        scoreTeam1: '', // Added score fields
        scoreTeam2: ''  // Added score fields
    });
    const [users, setUsers] = useState([]);
    const [selectedTeam1Players, setSelectedTeam1Players] = useState([]);
    const [selectedTeam2Players, setSelectedTeam2Players] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filteredUsers, setFilteredUsers] = useState([]);
    const [isCreateMatchModalOpen, setIsCreateMatchModalOpen] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [lastDoc, setLastDoc] = useState(null);
    const [firstDoc, setFirstDoc] = useState(null);
    const [canGoNext, setCanGoNext] = useState(true);
    const [canGoBack, setCanGoBack] = useState(false);
    const [currentMatchForScore, setCurrentMatchForScore] = useState(null); // For score submission modal
    const [adminUpdateScore1, setAdminUpdateScore1] = useState('');
    const [adminUpdateScore2, setAdminUpdateScore2] = useState('');
    const [isAdminUpdateModalOpen, setIsAdminUpdateModalOpen] = useState(false);
    const [selectedMatchForAdminUpdate, setSelectedMatchForAdminUpdate] = useState(null);

    const auth = getAuth(firebaseApp); // Initialize auth

    const fetchUsers = useCallback(async () => {
        if (!firestore || !appId) return;
        try {
            const usersCollectionRef = collection(firestore, `artifacts/${appId}/public/data/users`);
            const q = query(usersCollectionRef, orderBy('displayName'));
            const querySnapshot = await getDocs(q);
            const usersList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setUsers(usersList);
            setFilteredUsers(usersList); // Initially, all users are filtered users
        } catch (error) {
            console.error('Error fetching users:', error);
            setErrorMessage('Failed to load users.');
        }
    }, [firestore, appId]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    useEffect(() => {
        const lowercasedFilter = searchTerm.toLowerCase();
        const currentSelectedIds = new Set([...selectedTeam1Players.map(p => p.id), ...selectedTeam2Players.map(p => p.id)]);
        const filtered = users.filter(user =>
            user.displayName.toLowerCase().includes(lowercasedFilter) && !currentSelectedIds.has(user.id)
        );
        setFilteredUsers(filtered);
    }, [searchTerm, users, selectedTeam1Players, selectedTeam2Players]);


    const fetchMatches = useCallback(async (direction = 'next', docSnapshot = null) => {
        if (!firestore || !appId) {
            console.error('Firestore or appId not available.');
            setLoading(false);
            return;
        }

        setLoading(true);
        setErrorMessage('');
        setSuccessMessage('');

        try {
            let q;
            const matchesCollectionRef = collection(firestore, `artifacts/${appId}/public/data/matches`);

            if (direction === 'next') {
                q = query(matchesCollectionRef, orderBy('createdAt', 'desc'), startAfter(docSnapshot || 0), limit(ITEMS_PER_PAGE));
            } else if (direction === 'prev') {
                q = query(matchesCollectionRef, orderBy('createdAt', 'desc'), endBefore(docSnapshot), limitToLast(ITEMS_PER_PAGE));
            } else { // initial fetch
                q = query(matchesCollectionRef, orderBy('createdAt', 'desc'), limit(ITEMS_PER_PAGE));
            }

            const documentSnapshots = await getDocs(q);
            const fetchedMatches = documentSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            if (fetchedMatches.length > 0) {
                setMatches(fetchedMatches);
                setFirstDoc(documentSnapshots.docs[0]);
                setLastDoc(documentSnapshots.docs[documentSnapshots.docs.length - 1]);
                setCanGoNext(fetchedMatches.length === ITEMS_PER_PAGE); // Assumes if count is full, there might be more
                setCanGoBack(direction === 'prev' || currentPage > 1);
            } else {
                setMatches([]);
                setFirstDoc(null);
                setLastDoc(null);
                setCanGoNext(false);
                setCanGoBack(false);
            }
        } catch (error) {
            console.error('Error fetching matches:', error);
            setErrorMessage('Failed to load matches.');
        } finally {
            setLoading(false);
        }
    }, [firestore, appId, currentPage]);

    useEffect(() => {
        // Initial fetch and real-time listener for current page
        const q = query(
            collection(firestore, `artifacts/${appId}/public/data/matches`),
            orderBy('createdAt', 'desc'),
            limit(ITEMS_PER_PAGE)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const initialMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMatches(initialMatches);
            if (initialMatches.length > 0) {
                setFirstDoc(snapshot.docs[0]);
                setLastDoc(snapshot.docs[snapshot.docs.length - 1]);
                setCanGoNext(initialMatches.length === ITEMS_PER_PAGE);
            } else {
                setFirstDoc(null);
                setLastDoc(null);
                setCanGoNext(false);
            }
            setLoading(false);
        }, (error) => {
            console.error("Error fetching real-time matches:", error);
            setErrorMessage("Failed to load real-time matches.");
            setLoading(false);
        });

        return () => unsubscribe();
    }, [firestore, appId]);


    const handleNextPage = () => {
        if (canGoNext && lastDoc) {
            setCurrentPage(prev => prev + 1);
            fetchMatches('next', lastDoc);
        }
    };

    const handlePrevPage = () => {
        if (canGoBack && firstDoc) {
            setCurrentPage(prev => prev - 1);
            fetchMatches('prev', firstDoc);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setNewMatchData(prev => ({ ...prev, [name]: value }));
    };

    const handleDateChange = (date) => {
        if (date) {
            setNewMatchData(prev => ({ ...prev, slotDate: format(date, 'yyyy-MM-dd') }));
        } else {
            setNewMatchData(prev => ({ ...prev, slotDate: '' }));
        }
    };

    const handlePlayerSelect = (player, team) => {
        const newSelectedTeam1Players = [...selectedTeam1Players];
        const newSelectedTeam2Players = [...selectedTeam2Players];

        // Ensure a player is not in both teams
        if (team === 'team1' && newSelectedTeam2Players.some(p => p.id === player.id)) {
            setErrorMessage('Player cannot be in both teams.');
            return;
        }
        if (team === 'team2' && newSelectedTeam1Players.some(p => p.id === player.id)) {
            setErrorMessage('Player cannot be in both teams.');
            return;
        }

        // Add to selected team if not already there
        if (team === 'team1' && !newSelectedTeam1Players.some(p => p.id === player.id)) {
            newSelectedTeam1Players.push(player);
        } else if (team === 'team2' && !newSelectedTeam2Players.some(p => p.id === player.id)) {
            newSelectedTeam2Players.push(player);
        }
        setSelectedTeam1Players(newSelectedTeam1Players);
        setSelectedTeam2Players(newSelectedTeam2Players);
        setErrorMessage(''); // Clear error if selection is valid
    };

    const handleRemovePlayer = (player, team) => {
        if (team === 'team1') {
            setSelectedTeam1Players(prev => prev.filter(p => p.id !== player.id));
        } else {
            setSelectedTeam2Players(prev => prev.filter(p => p.id !== player.id));
        }
    };

    const handleAddMatch = async () => {
        setErrorMessage('');
        setSuccessMessage('');
        if (!appId || !functions) {
            setErrorMessage('App ID or Functions not initialized.');
            return;
        }

        if (!newMatchData.slotDate || !newMatchData.slotTime || !newMatchData.gameType || selectedTeam1Players.length === 0 || selectedTeam2Players.length === 0) {
            setErrorMessage('Please fill all required fields and select at least one player for each team.');
            return;
        }

        const createMatchCallable = httpsCallable(functions, 'createMatch');
        try {
            const team1Uids = selectedTeam1Players.map(p => p.id);
            const team2Uids = selectedTeam2Players.map(p => p.id);

            // Convert scores to numbers or null
            const score1 = newMatchData.scoreTeam1 === '' ? null : Number(newMatchData.scoreTeam1);
            const score2 = newMatchData.scoreTeam2 === '' ? null : Number(newMatchData.scoreTeam2);

            if ((score1 !== null && isNaN(score1)) || (score2 !== null && isNaN(score2)) || score1 < 0 || score2 < 0) {
                setErrorMessage('Scores must be valid non-negative numbers.');
                return;
            }
            if (score1 !== null && score2 !== null && score1 === score2) {
                setErrorMessage('Scores cannot be equal for a new match.');
                return;
            }


            const result = await createMatchCallable({
                appId,
                slotDate: newMatchData.slotDate,
                slotTime: newMatchData.slotTime,
                gameType: newMatchData.gameType,
                team1Players: team1Uids,
                team2Players: team2Uids,
                scoreTeam1: score1, // Pass scores here
                scoreTeam2: score2  // Pass scores here
            });
            console.log('Match created:', result.data);
            setSuccessMessage('Match created successfully!');
            setIsCreateMatchModalOpen(false);
            // Reset form
            setNewMatchData({ slotDate: '', slotTime: '', gameType: '', team1Players: [], team2Players: [], scoreTeam1: '', scoreTeam2: '' });
            setSelectedTeam1Players([]);
            setSelectedTeam2Players([]);
            setSearchTerm('');
            fetchMatches(); // Refresh match list
        } catch (error) {
            console.error('Error creating match:', error);
            setErrorMessage(error.message || 'Failed to create match.');
        }
    };

    const handleConfirmMatch = async (matchId, currentScores, matchCreatedBy) => {
        setErrorMessage('');
        setSuccessMessage('');
        if (!appId || !functions) {
            setErrorMessage('App ID or Functions not initialized.');
            return;
        }

        const confirmMatchCallable = httpsCallable(functions, 'confirmMatch');
        try {
            const scoresToSubmit = {
                scoreTeam1: currentMatchForScore ? Number(adminUpdateScore1) : undefined,
                scoreTeam2: currentMatchForScore ? Number(adminUpdateScore2) : undefined
            };

            // If match does not have scores, and user is trying to confirm without providing new scores.
            if (!currentScores && (scoresToSubmit.scoreTeam1 === undefined || scoresToSubmit.scoreTeam2 === undefined)) {
                setErrorMessage('Scores must be provided to confirm this match if not already present.');
                return;
            }

            // Validate scores if provided during confirmation
            if (scoresToSubmit.scoreTeam1 !== undefined && scoresToSubmit.scoreTeam2 !== undefined) {
                if (isNaN(scoresToSubmit.scoreTeam1) || isNaN(scoresToSubmit.scoreTeam2) || scoresToSubmit.scoreTeam1 < 0 || scoresToSubmit.scoreTeam2 < 0 || scoresToSubmit.scoreTeam1 === scoresToSubmit.scoreTeam2) {
                    setErrorMessage('Invalid scores provided. Scores must be non-negative numbers and not equal.');
                    return;
                }
            }


            const result = await confirmMatchCallable({
                appId,
                matchId,
                ...scoresToSubmit // Pass scores here if applicable
            });
            console.log('Match confirmed:', result.data);
            setSuccessMessage('Match confirmed successfully!');
            setCurrentMatchForScore(null); // Close score submission modal if open
            setAdminUpdateScore1('');
            setAdminUpdateScore2('');
            fetchMatches(); // Refresh match list
        } catch (error) {
            console.error('Error confirming match:', error);
            setErrorMessage(error.message || 'Failed to confirm match.');
        }
    };

    const handleRejectMatch = async (matchId) => {
        setErrorMessage('');
        setSuccessMessage('');
        if (!appId || !functions) {
            setErrorMessage('App ID or Functions not initialized.');
            return;
        }
        if (!window.confirm('Are you sure you want to reject this match? This action cannot be undone.')) {
            return;
        }

        const rejectMatchCallable = httpsCallable(functions, 'rejectMatch');
        try {
            const result = await rejectMatchCallable({ appId, matchId });
            console.log('Match rejected:', result.data);
            setSuccessMessage('Match rejected successfully!');
            fetchMatches(); // Refresh match list
        } catch (error) {
            console.error('Error rejecting match:', error);
            setErrorMessage(error.message || 'Failed to reject match.');
        }
    };

    const handleOpenAdminUpdateModal = (match) => {
        setSelectedMatchForAdminUpdate(match);
        setAdminUpdateScore1(match.scores?.team1 ?? '');
        setAdminUpdateScore2(match.scores?.team2 ?? '');
        setIsAdminUpdateModalOpen(true);
    };

    const handleAdminUpdateMatch = async () => {
        setErrorMessage('');
        setSuccessMessage('');
        if (!appId || !functions || !selectedMatchForAdminUpdate) {
            setErrorMessage('App ID, Functions, or selected match not initialized.');
            return;
        }

        const adminUpdateMatchCallable = httpsCallable(functions, 'adminUpdateMatch');
        try {
            const updates = {
                scores: {
                    team1: Number(adminUpdateScore1),
                    team2: Number(adminUpdateScore2)
                },
                // Add other fields here if admin can update them (e.g., status, players)
                // status: 'confirmed', // Example: admin can force status to confirmed
            };

            // Basic score validation for admin
            if (isNaN(updates.scores.team1) || isNaN(updates.scores.team2) || updates.scores.team1 < 0 || updates.scores.team2 < 0 || updates.scores.team1 === updates.scores.team2) {
                setErrorMessage('Invalid scores for admin update. Scores must be non-negative numbers and not equal.');
                return;
            }

            const result = await adminUpdateMatchCallable({
                appId,
                matchId: selectedMatchForAdminUpdate.id,
                updates: updates
            });
            console.log('Match updated by admin:', result.data);
            setSuccessMessage('Match updated by admin successfully!');
            setIsAdminUpdateModalOpen(false);
            setSelectedMatchForAdminUpdate(null);
            setAdminUpdateScore1('');
            setAdminUpdateScore2('');
            fetchMatches(); // Refresh match list
        } catch (error) {
            console.error('Error updating match by admin:', error);
            setErrorMessage(error.message || 'Failed to update match.');
        }
    };


    const getUserDisplayName = (uid) => {
        const userFound = users.find(u => u.id === uid);
        return userFound ? userFound.displayName : `Unknown User (${uid})`;
    };

    const getTeamNames = (uids) => {
        return uids.map(getUserDisplayName).join(', ');
    };

    const canConfirm = (match) => {
        if (!user || !user.uid) return false;
        // Check if current user is part of the match
        const isParticipant = match.team1.includes(user.uid) || match.team2.includes(user.uid);
        if (!isParticipant) return false;

        // Creator cannot confirm their own match for the 'opponent approval' flow
        if (match.createdBy === user.uid) return false;

        // Has the current user already confirmed?
        if (match.confirmedBy && match.confirmedBy.includes(user.uid)) return false;

        // Match must be pending confirmation or awaiting scores
        return match.status === 'pending_confirmation' || match.status === 'awaiting_scores';
    };

    const needsScoreSubmission = (match) => {
        return match.status === 'awaiting_scores' && (match.team1.includes(user.uid) || match.team2.includes(user.uid));
    };


    if (loading) {
        return <div className="p-4">Loading matches...</div>;
    }

    return (
        <div className="p-4 sm:p-6 bg-gray-100 min-h-screen">
            <h1 className="text-3xl font-bold text-gray-800 mb-6">Match Management</h1>

            {errorMessage && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                    <strong className="font-bold">Error!</strong>
                    <span className="block sm:inline"> {errorMessage}</span>
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setErrorMessage('')}>
                        <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.697l-2.651 3.152a1.2 1.2 0 1 1-1.697-1.697L8.303 10 5.152 7.348a1.2 1.2 0 1 1 1.697-1.697L10 8.303l2.651-3.152a1.2 1.2 0 1 1 1.697 1.697L11.697 10l3.152 2.651a1.2 1.2 0 0 1 0 1.698z"/></svg>
                    </span>
                </div>
            )}
            {successMessage && (
                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded relative mb-4" role="alert">
                    <strong className="font-bold">Success!</strong>
                    <span className="block sm:inline"> {successMessage}</span>
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setSuccessMessage('')}>
                        <svg className="fill-current h-6 w-6 text-green-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.697l-2.651 3.152a1.2 1.2 0 1 1-1.697-1.697L8.303 10 5.152 7.348a1.2 1.2 0 1 1 1.697-1.697L10 8.303l2.651-3.152a1.2 1.2 0 1 1 1.697 1.697L11.697 10l3.152 2.651a1.2 1.2 0 0 1 0 1.698z"/></svg>
                    </span>
                </div>
            )}

            <button
                onClick={() => setIsCreateMatchModalOpen(true)}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-6 shadow-md transition duration-300 ease-in-out"
            >
                Create New Match
            </button>

            {/* Create Match Modal */}
            {isCreateMatchModalOpen && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4 z-50">
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
                        <h2 className="text-2xl font-bold mb-4 text-gray-800">Create New Match</h2>
                        <button
                            onClick={() => setIsCreateMatchModalOpen(false)}
                            className="absolute top-4 right-4 text-gray-600 hover:text-gray-900 text-3xl"
                        >
                            &times;
                        </button>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div>
                                <label className="block text-gray-700 text-sm font-bold mb-2">Game Type:</label>
                                <input
                                    type="text"
                                    name="gameType"
                                    value={newMatchData.gameType}
                                    onChange={handleInputChange}
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    placeholder="e.g., Singles, Doubles"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-700 text-sm font-bold mb-2">Match Date:</label>
                                <DatePicker
                                    selected={newMatchData.slotDate ? new Date(newMatchData.slotDate) : null}
                                    onChange={handleDateChange}
                                    dateFormat="yyyy-MM-dd"
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    placeholderText="Select Date"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-700 text-sm font-bold mb-2">Match Time:</label>
                                <input
                                    type="time"
                                    name="slotTime"
                                    value={newMatchData.slotTime}
                                    onChange={handleInputChange}
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                />
                            </div>
                            <div className="flex space-x-2">
                                <div>
                                    <label className="block text-gray-700 text-sm font-bold mb-2">Team 1 Score (Optional):</label>
                                    <input
                                        type="number"
                                        name="scoreTeam1"
                                        value={newMatchData.scoreTeam1}
                                        onChange={handleInputChange}
                                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                        placeholder="Score Team 1"
                                    />
                                </div>
                                <div>
                                    <label className="block text-gray-700 text-sm font-bold mb-2">Team 2 Score (Optional):</label>
                                    <input
                                        type="number"
                                        name="scoreTeam2"
                                        value={newMatchData.scoreTeam2}
                                        onChange={handleInputChange}
                                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                        placeholder="Score Team 2"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Player Selection */}
                        <div className="mb-4">
                            <label className="block text-gray-700 text-sm font-bold mb-2">Add Players:</label>
                            <input
                                type="text"
                                placeholder="Search users to add"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline mb-2"
                            />
                            <div className="border rounded max-h-40 overflow-y-auto mb-4">
                                {filteredUsers.length > 0 ? (
                                    filteredUsers.map(user => (
                                        <div key={user.id} className="p-2 border-b last:border-b-0 flex justify-between items-center">
                                            <span>{user.displayName}</span>
                                            <div>
                                                <button
                                                    onClick={() => handlePlayerSelect(user, 'team1')}
                                                    className="bg-green-500 hover:bg-green-600 text-white text-xs py-1 px-2 rounded mr-2"
                                                >
                                                    Add to Team 1
                                                </button>
                                                <button
                                                    onClick={() => handlePlayerSelect(user, 'team2')}
                                                    className="bg-purple-500 hover:bg-purple-600 text-white text-xs py-1 px-2 rounded"
                                                >
                                                    Add to Team 2
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <p className="p-2 text-gray-500">No users found or all are selected.</p>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                            <div>
                                <h3 className="font-semibold mb-2">Team 1 Players:</h3>
                                <div className="border rounded p-2 min-h-[50px]">
                                    {selectedTeam1Players.length > 0 ? (
                                        selectedTeam1Players.map(player => (
                                            <div key={player.id} className="flex justify-between items-center bg-gray-100 p-1 mb-1 rounded">
                                                <span>{player.displayName}</span>
                                                <button
                                                    onClick={() => handleRemovePlayer(player, 'team1')}
                                                    className="text-red-500 hover:text-red-700 text-sm"
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-gray-500 text-sm">No players selected for Team 1.</p>
                                    )}
                                </div>
                            </div>
                            <div>
                                <h3 className="font-semibold mb-2">Team 2 Players:</h3>
                                <div className="border rounded p-2 min-h-[50px]">
                                    {selectedTeam2Players.length > 0 ? (
                                        selectedTeam2Players.map(player => (
                                            <div key={player.id} className="flex justify-between items-center bg-gray-100 p-1 mb-1 rounded">
                                                <span>{player.displayName}</span>
                                                <button
                                                    onClick={() => handleRemovePlayer(player, 'team2')}
                                                    className="text-red-500 hover:text-red-700 text-sm"
                                                >
                                                    &times;
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <p className="text-gray-500 text-sm">No players selected for Team 2.</p>
                                    )}
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={handleAddMatch}
                            className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded shadow-md transition duration-300 ease-in-out w-full"
                        >
                            Create Match
                        </button>
                    </div>
                </div>
            )}

            {/* Admin Update Match Modal */}
            {isAdminUpdateModalOpen && selectedMatchForAdminUpdate && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center p-4 z-50">
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md relative">
                        <h2 className="text-2xl font-bold mb-4 text-gray-800">Admin Update Match Scores</h2>
                        <button
                            onClick={() => setIsAdminUpdateModalOpen(false)}
                            className="absolute top-4 right-4 text-gray-600 hover:text-gray-900 text-3xl"
                        >
                            &times;
                        </button>

                        <div className="mb-4">
                            <p className="text-lg mb-2">Match: {getTeamNames(selectedMatchForAdminUpdate.team1)} vs {getTeamNames(selectedMatchForAdminUpdate.team2)}</p>
                            <p className="text-md text-gray-600 mb-4">Date: {selectedMatchForAdminUpdate.date} at {selectedMatchForAdminUpdate.time}</p>
                            <div>
                                <label className="block text-gray-700 text-sm font-bold mb-2">Team 1 Score:</label>
                                <input
                                    type="number"
                                    value={adminUpdateScore1}
                                    onChange={(e) => setAdminUpdateScore1(e.target.value)}
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline mb-3"
                                />
                            </div>
                            <div>
                                <label className="block text-gray-700 text-sm font-bold mb-2">Team 2 Score:</label>
                                <input
                                    type="number"
                                    value={adminUpdateScore2}
                                    onChange={(e) => setAdminUpdateScore2(e.target.value)}
                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline mb-4"
                                />
                            </div>
                        </div>

                        <button
                            onClick={handleAdminUpdateMatch}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded shadow-md transition duration-300 ease-in-out w-full"
                        >
                            Update Scores
                        </button>
                    </div>
                </div>
            )}


            <div className="bg-white shadow-md rounded-lg p-4">
                <h2 className="text-2xl font-semibold text-gray-700 mb-4">Current Matches</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full leading-normal">
                        <thead>
                            <tr>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Match Details
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Teams
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Scores
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Status
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Created By
                                </th>
                                <th className="px-5 py-3 border-b-2 border-gray-200 bg-gray-100 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {matches.length > 0 ? (
                                matches.map((match) => (
                                    <tr key={match.id} className="hover:bg-gray-50">
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                            <p className="text-gray-900 whitespace-no-wrap">{match.gameType}</p>
                                            <p className="text-gray-600 whitespace-no-wrap text-xs">{match.date} {match.time}</p>
                                        </td>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                            <p className="text-gray-900 whitespace-no-wrap">Team 1: {getTeamNames(match.team1)}</p>
                                            <p className="text-gray-900 whitespace-no-wrap">Team 2: {getTeamNames(match.team2)}</p>
                                        </td>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                            <p className="text-gray-900 whitespace-no-wrap">
                                                {match.scores ? `${match.scores.team1} - ${match.scores.team2}` : 'N/A'}
                                            </p>
                                        </td>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                            <span
                                                className={`relative inline-block px-3 py-1 font-semibold leading-tight ${
                                                    match.status === 'confirmed' ? 'text-green-900' :
                                                    match.status === 'rejected' ? 'text-red-900' :
                                                    'text-orange-900'
                                                }`}
                                            >
                                                <span
                                                    aria-hidden
                                                    className={`absolute inset-0 opacity-50 rounded-full ${
                                                        match.status === 'confirmed' ? 'bg-green-200' :
                                                        match.status === 'rejected' ? 'bg-red-200' :
                                                        'bg-orange-200'
                                                    }`}
                                                ></span>
                                                <span className="relative">{match.status.replace(/_/g, ' ')}</span>
                                            </span>
                                        </td>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                            <p className="text-gray-900 whitespace-no-wrap">{getUserDisplayName(match.createdBy)}</p>
                                        </td>
                                        <td className="px-5 py-5 border-b border-gray-200 bg-white text-sm">
                                            <div className="flex flex-col space-y-2">
                                                {canConfirm(match) && (
                                                    <button
                                                        onClick={() => {
                                                            setCurrentMatchForScore(match);
                                                            // If scores are missing, open modal to prompt for scores
                                                            if (!match.scores || match.status === 'awaiting_scores') {
                                                                setIsAdminUpdateModalOpen(true); // Re-using this modal for player score submission
                                                                setSelectedMatchForAdminUpdate(match);
                                                                setAdminUpdateScore1(''); // Clear previous scores
                                                                setAdminUpdateScore2('');
                                                            } else {
                                                                // If scores exist, confirm directly
                                                                handleConfirmMatch(match.id, match.scores, match.createdBy);
                                                            }
                                                        }}
                                                        className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold py-1 px-2 rounded"
                                                    >
                                                        {(!match.scores || match.status === 'awaiting_scores') ? 'Submit Scores & Confirm' : 'Confirm Match'}
                                                    </button>
                                                )}

                                                {user && user.isAdmin && (
                                                    <>
                                                        <button
                                                            onClick={() => handleOpenAdminUpdateModal(match)}
                                                            className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold py-1 px-2 rounded"
                                                        >
                                                            Admin Update
                                                        </button>
                                                        {match.status !== 'rejected' && (
                                                            <button
                                                                onClick={() => handleRejectMatch(match.id)}
                                                                className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold py-1 px-2 rounded"
                                                            >
                                                                Reject Match
                                                            </button>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan="6" className="px-5 py-5 border-b border-gray-200 bg-white text-sm text-center text-gray-500">
                                        No matches found.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 flex justify-between items-center">
                    <button
                        onClick={handlePrevPage}
                        disabled={!canGoBack}
                        className={`py-2 px-4 rounded ${!canGoBack ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
                    >
                        Previous
                    </button>
                    <span className="text-gray-700">Page {currentPage}</span>
                    <button
                        onClick={handleNextPage}
                        disabled={!canGoNext}
                        className={`py-2 px-4 rounded ${!canGoNext ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
                    >
                        Next
                    </button>
                </div>
            </div>
        </div>
    );
};

export default MatchManagementPage;