import React, { useState, useEffect, useCallback, useContext } from 'react';
import { AppContext } from '../App'; // Assuming AppContext is in App.js
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions'; // Ensure httpsCallable is imported
import { PlusCircle, Users, Trophy, Bell, CheckCircle, Info, XCircle } from 'lucide-react';
import CustomAlertDialog from '../components/CustomAlertDialog';
import MatchDetailsModal from '../components/MatchDetailsModal';
import { formatSlotDateTime } from '../utils/datehelpers'; // NEW IMPORT
import { getMemberName, getMemberUid } from '../utils/memberhelpers'; // NEW IMPORT
import { isSameDay, startOfDay } from 'date-fns'; // Keep these for local date logic

const MatchManagementPage = () => {
    // Consume from AppContext
    const { db, functions, appId, userId, userRole } = useContext(AppContext);

    // --- State Variables ---
    const [members, setMembers] = useState([]);
    const [matches, setMatches] = useState([]);
    const [slots, setSlots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState('');
    const [error, setError] = useState(''); // General error for data fetching
    const [showAlert, setShowAlert] = useState(false); // For CustomAlertDialog
    const [alertMessage, setAlertMessage] = useState(''); // Message for CustomAlertDialog

    // State for new match form inputs
    const [selectedMatchDate, setSelectedMatchDate] = useState(null); // Changed to null for DatePicker
    const [selectedSlotTime, setSelectedSlotTime] = useState(''); // New state for specific slot time
    const [team1Player1Name, setTeam1Player1Name] = useState('');
    const [team1Player2Name, setTeam1Player2Name] = useState('');
    const [team2Player1Name, setTeam2Player1Name] = useState('');
    const [team2Player2Name, setTeam2Player2Name] = useState('');
    const [gameType, setGameType] = useState('singles'); // 'singles' or 'doubles'

    // States for confirmation modal (for players to confirm match details)
    const [showConfirmMatchDialog, setShowConfirmMatchDialog] = useState(false); // Renamed from showConfirmModal
    const [currentMatchToConfirm, setCurrentMatchToConfirm] = useState(null); // Renamed from matchToConfirm

    // States for score submission modal (for admins to input scores)
    const [showSubmitScoreDialog, setShowSubmitScoreDialog] = useState(false); // NEW STATE
    const [currentMatchToScore, setCurrentMatchToScore] = useState(null); // NEW STATE
    const [scoreTeam1, setScoreTeam1] = useState(''); // NEW STATE
    const [scoreTeam2, setScoreTeam2] = useState(''); // NEW STATE

    // States for match details modal
    const [showMatchDetailsModal, setShowMatchDetailsModal] = useState(false);
    const [selectedMatchForDetails, setSelectedMatchForDetails] = useState(null);

    // NEW: State for players available on the selected match date (from slots)
    const [availablePlayersOnDate, setAvailablePlayersOnDate] = useState([]);
    // NEW: State for available slot times for the selected date (booked by current user)
    const [availableSlotTimes, setAvailableSlotTimes] = useState([]);

    // --- useEffects for Data Fetching ---

    useEffect(() => {
        if (!db || !appId || !userId || !functions) return; // Ensure functions is ready

        setLoading(true);

        // Fetch members (public profiles)
        const membersRef = collection(db, `artifacts/${appId}/public/data/users`);
        const unsubscribeMembers = onSnapshot(membersRef, (snapshot) => {
            const fetchedMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMembers(fetchedMembers);
        }, (err) => {
            console.error("Error fetching members for match management:", err);
            setError("Failed to load members.");
        });

        // Fetch matches
        const matchesRef = collection(db, `artifacts/${appId}/public/data/matches`);
        const unsubscribeMatches = onSnapshot(matchesRef, (snapshot) => {
            const fetchedMatches = snapshot.docs.map(doc => {
                const data = doc.data();
                return {
                    id: doc.id,
                    ...data,
                    // Ensure gameType is always a string, defaulting if necessary
                    gameType: typeof data.gameType === 'string' ? data.gameType : 'singles',
                };
            });
            // Sort matches by date (newest first) and then by status (pending for current user first)
            fetchedMatches.sort((a, b) => {
                const dateA = a.slotTimestamp?.toDate() || new Date(0); // Use slotTimestamp
                const dateB = b.slotTimestamp?.toDate() || new Date(0); // Use slotTimestamp
                if (dateA.getTime() !== dateB.getTime()) {
                    return dateB.getTime() - dateA.getTime(); // Newest first
                }
                // Prioritize pending for current user
                const isAPendingForUser = a.status === 'pending_confirmation' && (a.team1.includes(userId) || a.team2.includes(userId)) && !a.confirmedBy.includes(userId);
                const isBPendingForUser = b.status === 'pending_confirmation' && (b.team1.includes(userId) || b.team2.includes(userId)) && !b.confirmedBy.includes(userId);
                if (isAPendingForUser && !isBPendingForUser) return -1;
                if (!isAPendingForUser && isBPendingForUser) return 1;
                return 0;
            });
            setMatches(fetchedMatches);
            setLoading(false);
        }, (err) => {
            console.error("Error fetching matches:", err);
            setError("Failed to load matches.");
            setLoading(false);
        });

        // Fetch all slots to filter available players by date
        const slotsRef = collection(db, `artifacts/${appId}/public/data/slots`);
        const unsubscribeSlots = onSnapshot(slotsRef, (snapshot) => {
            const fetchedSlots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSlots(fetchedSlots);
        }, (err) => {
            console.error("Error fetching slots for match management:", err);
        });

        return () => {
            unsubscribeMembers();
            unsubscribeMatches();
            unsubscribeSlots();
        };
    }, [db, appId, userId, functions]); // Add functions to dependencies

    // Effect to determine available players and slot times based on selected date and booked slots
    useEffect(() => {
        if (!selectedMatchDate || !members.length || !slots.length) {
            setAvailablePlayersOnDate([]);
            setAvailableSlotTimes([]);
            return;
        }

        const selectedDateObj = new Date(selectedMatchDate);
        if (isNaN(selectedDateObj.getTime())) {
            setAvailablePlayersOnDate([]);
            setAvailableSlotTimes([]);
            return;
        }

        const bookedUserIdsOnDate = new Set();
        const userBookedTimesOnDate = new Set();

        slots.forEach(slot => {
            const slotDateTime = slot.timestamp?.toDate ? slot.timestamp.toDate() : new Date(slot.dateTime);
            if (isSameDay(slotDateTime, selectedDateObj) && slot.isBooked) {
                // For available players: collect all UIDs booked on this date
                if (slot.bookedBy) {
                    bookedUserIdsOnDate.add(slot.bookedBy);
                }
                // For available slot times: collect times booked by the current user
                if (slot.bookedBy === userId) {
                    userBookedTimesOnDate.add(slot.time);
                }
            }
        });

        // Filter members based on who has booked a slot on the selected date
        const players = members.filter(member => bookedUserIdsOnDate.has(member.id)); // Assuming member.id is firebaseAuthUid
        setAvailablePlayersOnDate(players);

        // Convert set to array and sort times
        setAvailableSlotTimes(Array.from(userBookedTimesOnDate).sort());

    }, [selectedMatchDate, members, slots, userId]); // Dependencies

    // --- Event Handlers ---

    const handleAddMatch = async (e) => {
        e.preventDefault();
        setMessage('');
        setAlertMessage('');

        if (!selectedMatchDate || !selectedSlotTime || !team1Player1Name || !team2Player1Name || (gameType === 'doubles' && (!team1Player2Name || !team2Player2Name))) {
            setAlertMessage('Please fill in all required fields for match creation.');
            setShowAlert(true);
            return;
        }

        // Use imported helper functions
        const p1T1Uid = getMemberUid(team1Player1Name, members);
        const p2T1Uid = team1Player2Name ? getMemberUid(team1Player2Name, members) : null;
        const p1T2Uid = getMemberUid(team2Player1Name, members);
        const p2T2Uid = team2Player2Name ? getMemberUid(team2Player2Name, members) : null;

        const team1Uids = [p1T1Uid].filter(Boolean);
        if (p2T1Uid) team1Uids.push(p2T1Uid);

        const team2Uids = [p1T2Uid].filter(Boolean);
        if (p2T2Uid) team2Uids.push(p2T2Uid);

        const allSelectedUids = [...team1Uids, ...team2Uids].filter(Boolean);
        const uniqueUids = new Set(allSelectedUids);

        if (allSelectedUids.length === 0 || allSelectedUids.length !== uniqueUids.size) {
            setAlertMessage('Please select unique and valid players for both teams.');
            setShowAlert(true);
            return;
        }

        if (!allSelectedUids.includes(userId)) {
            setAlertMessage('You must be one of the players in the match you are creating.');
            setShowAlert(true);
            return;
        }

        try {
            // Find the specific slot document booked by the current user for the selected date and time
            const startOfSelectedDay = startOfDay(selectedMatchDate);
            const slotQueryRef = query(
                collection(db, `artifacts/${appId}/public/data/slots`),
                where('timestamp', '==', startOfSelectedDay),
                where('time', '==', selectedSlotTime),
                where('bookedBy', '==', userId)
            );
            const slotSnapshot = await getDocs(slotQueryRef);

            let slotDocId = null;
            let existingSlotData = null;
            if (!slotSnapshot.empty) {
                slotSnapshot.forEach(doc => {
                    slotDocId = doc.id;
                    existingSlotData = doc.data();
                });
            }

            if (!slotDocId || !existingSlotData || !existingSlotData.isBooked || existingSlotData.bookedBy !== userId) {
                setAlertMessage('Selected slot is not booked by you or does not exist. Please book the slot first.');
                setShowAlert(true);
                return;
            }

            const createMatchCallable = httpsCallable(functions, 'createMatch');
            const result = await createMatchCallable({
                appId: appId, // Pass appId to callable function
                slotTimestamp: existingSlotData.timestamp, // Use the timestamp from the slot document
                slotTime: existingSlotData.time, // Use the time from the slot document
                gameType: gameType,
                team1: team1Uids,
                team2: team2Uids,
            });

            if (result.data.success) {
                setMessage('Match added successfully! Awaiting confirmation from the other team.');
                setSelectedMatchDate(null);
                setSelectedSlotTime('');
                setTeam1Player1Name('');
                setTeam1Player2Name('');
                setTeam2Player1Name('');
                setTeam2Player2Name('');
                setGameType('singles');
            } else {
                setAlertMessage(`Failed to add match: ${result.data.message || 'Unknown error.'}`);
                setShowAlert(true);
            }
        } catch (error) {
            console.error("Error adding match:", error);
            setAlertMessage(`Failed to add match: ${error.message}`);
            setShowAlert(true);
        }
    };

    const handleConfirmMatch = useCallback(async () => {
        setMessage('');
        setAlertMessage('');

        if (!currentMatchToConfirm || !userId) return;

        try {
            const confirmMatchCallable = httpsCallable(functions, 'confirmMatch');
            const result = await confirmMatchCallable({ matchId: currentMatchToConfirm.id, appId: appId });

            if (result.data.success) {
                setMessage(result.data.message || 'Match confirmation submitted!');
            } else {
                setAlertMessage(`Failed to confirm match: ${result.data.message || 'Unknown error.'}`);
                setShowAlert(true);
            }

        } catch (error) {
            console.error("Error confirming match:", error);
            setAlertMessage(`Error confirming match: ${error.message}`);
            setShowAlert(true);
        } finally {
            setShowConfirmMatchDialog(false);
            setCurrentMatchToConfirm(null);
        }
    }, [appId, userId, functions, currentMatchToConfirm]); // Added currentMatchToConfirm to dependencies

    const handleRejectMatch = useCallback(async () => {
        setMessage('');
        setAlertMessage('');

        if (!currentMatchToConfirm || !userId || userRole !== 'admin') return; // Only admin can reject

        try {
            const rejectMatchCallable = httpsCallable(functions, 'rejectMatch');
            const result = await rejectMatchCallable({ matchId: currentMatchToConfirm.id, appId: appId });

            if (result.data.success) {
                setMessage(result.data.message || 'Match rejected successfully.');
            } else {
                setAlertMessage(`Failed to reject match: ${result.data.message || 'Unknown error.'}`);
                setShowAlert(true);
            }
        } catch (error) {
            console.error("Error rejecting match:", error);
            setAlertMessage(`Error rejecting match: ${error.message}`);
            setShowAlert(true);
        } finally {
            setShowConfirmMatchDialog(false); // Close the dialog after reject
            setCurrentMatchToConfirm(null);
        }
    }, [appId, userId, userRole, functions, currentMatchToConfirm]); // Added currentMatchToConfirm to dependencies


    const handleSubmitScore = useCallback(async () => {
        setMessage('');
        setAlertMessage('');

        if (!currentMatchToScore || scoreTeam1 === '' || scoreTeam2 === '') {
            setAlertMessage('Please enter scores for both teams.');
            setShowAlert(true);
            return;
        }

        const s1 = parseInt(scoreTeam1, 10);
        const s2 = parseInt(scoreTeam2, 10);

        if (isNaN(s1) || isNaN(s2) || s1 < 0 || s2 < 0) {
            setAlertMessage('Scores must be non-negative numbers.');
            setShowAlert(true);
            return;
        }

        if (s1 === s2) {
            setAlertMessage('Draws are not allowed. Please enter distinct scores.');
            setShowAlert(true);
            return;
        }

        try {
            const submitMatchScoreCallable = httpsCallable(functions, 'submitMatchScore');
            const result = await submitMatchScoreCallable({
                matchId: currentMatchToScore.id,
                score1: s1,
                score2: s2,
                appId: appId // Pass appId
            });

            if (result.data.success) {
                setMessage(result.data.message || 'Scores submitted successfully! Elo ratings will update shortly.');
            } else {
                setAlertMessage(`Failed to submit scores: ${result.data.message || 'Unknown error.'}`);
                setShowAlert(true);
            }
        } catch (error) {
            console.error("Error submitting score:", error);
            setAlertMessage(`Error submitting score: ${error.message}`);
            setShowAlert(true);
        } finally {
            setShowSubmitScoreDialog(false);
            setCurrentMatchToScore(null);
            setScoreTeam1('');
            setScoreTeam2('');
        }
    }, [appId, functions, currentMatchToScore, scoreTeam1, scoreTeam2]); // Added all relevant dependencies


    if (loading) {
        return <div className="text-center text-gray-600">Loading match data...</div>;
    }

    if (error) {
        return <div className="text-center text-red-600">Error: {error}</div>;
    }

    return (
        <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
            <h2 className="text-3xl font-extrabold text-gray-900 text-center mb-8">
                Match Management
            </h2>

            {message && (
                <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg relative mb-4" role="alert">
                    <span className="block sm:inline">{message}</span>
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3">
                        <XCircle className="h-6 w-6 text-green-500 cursor-pointer" onClick={() => setMessage('')} />
                    </span>
                </div>
            )}
            {alertMessage && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mb-4" role="alert">
                    <span className="block sm:inline">{alertMessage}</span>
                    <span className="absolute top-0 bottom-0 right-0 px-4 py-3">
                        <XCircle className="h-6 w-6 text-red-500 cursor-pointer" onClick={() => setAlertMessage('')} />
                    </span>
                </div>
            )}

            <div className="max-w-4xl mx-auto space-y-8">
                {/* Add New Match Section */}
                <div className="bg-white p-6 rounded-2xl shadow-xl space-y-4 rounded-xl">
                    <h3 className="text-2xl font-bold text-gray-800 text-center">Add New Match</h3>
                    <form onSubmit={handleAddMatch} className="space-y-4">
                        <div>
                            <label htmlFor="matchDate" className="block text-gray-700 text-sm font-bold mb-2">Match Date:</label>
                            <input
                                type="date"
                                id="matchDate"
                                value={selectedMatchDate ? selectedMatchDate.toISOString().split('T')[0] : ''} // Format for input type="date"
                                onChange={(e) => setSelectedMatchDate(e.target.value ? new Date(e.target.value) : null)}
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                required
                            />
                        </div>
                        <div>
                            <label htmlFor="slotTime" className="block text-gray-700 text-sm font-bold mb-2">My Booked Slot Time:</label>
                            <select
                                id="slotTime"
                                value={selectedSlotTime}
                                onChange={(e) => setSelectedSlotTime(e.target.value)}
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                required
                                disabled={!selectedMatchDate || availableSlotTimes.length === 0}
                            >
                                <option value="">Select a time</option>
                                {availableSlotTimes.map(time => (
                                    <option key={time} value={time}>{time}</option>
                                ))}
                            </select>
                            {!selectedMatchDate && <p className="text-xs text-gray-500 mt-1">Select a date first.</p>}
                            {selectedMatchDate && availableSlotTimes.length === 0 && <p className="text-xs text-gray-500 mt-1">No slots booked by you for this date.</p>}
                        </div>
                        <div>
                            <label htmlFor="gameType" className="block text-gray-700 text-sm font-bold mb-2">Game Type:</label>
                            <select
                                id="gameType"
                                value={gameType}
                                onChange={(e) => setGameType(e.target.value)}
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                required
                            >
                                <option value="singles">Singles</option>
                                <option value="doubles">Doubles</option>
                            </select>
                        </div>

                        {selectedMatchDate && availablePlayersOnDate.length > 0 ? (
                            <>
                                <div className="grid grid-cols-2 gap-4">
                                    {/* Team 1 Player 1 */}
                                    <div>
                                        <label htmlFor="team1Player1" className="block text-gray-700 text-sm font-bold mb-2">Team 1 Player 1:</label>
                                        <input
                                            list="availableMembersList" // Use datalist for suggestions
                                            id="team1Player1"
                                            value={team1Player1Name}
                                            onChange={(e) => setTeam1Player1Name(e.target.value)}
                                            placeholder="Select player"
                                            className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                            required
                                        />
                                    </div>
                                    {/* Team 1 Player 2 (Optional for doubles) */}
                                    {gameType === 'doubles' && (
                                        <div>
                                            <label htmlFor="team1Player2" className="block text-gray-700 text-sm font-bold mb-2">Team 1 Player 2 (Optional):</label>
                                            <input
                                                list="availableMembersList"
                                                id="team1Player2"
                                                value={team1Player2Name}
                                                onChange={(e) => setTeam1Player2Name(e.target.value)}
                                                placeholder="Select player"
                                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                            />
                                        </div>
                                    )}
                                    {/* Team 2 Player 1 */}
                                    <div>
                                        <label htmlFor="team2Player1" className="block text-gray-700 text-sm font-bold mb-2">Team 2 Player 1:</label>
                                        <input
                                            list="availableMembersList"
                                            id="team2Player1"
                                            value={team2Player1Name}
                                            onChange={(e) => setTeam2Player1Name(e.target.value)}
                                            placeholder="Select player"
                                            className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                            required
                                        />
                                    </div>
                                    {/* Team 2 Player 2 (Optional for doubles) */}
                                    {gameType === 'doubles' && (
                                        <div>
                                            <label htmlFor="team2Player2" className="block text-gray-700 text-sm font-bold mb-2">Team 2 Player 2 (Optional):</label>
                                            <input
                                                list="availableMembersList"
                                                id="team2Player2"
                                                value={team2Player2Name}
                                                onChange={(e) => setTeam2Player2Name(e.target.value)}
                                                placeholder="Select player"
                                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                            />
                                        </div>
                                    )}
                                </div>

                                {/* Removed score inputs from here, they are submitted separately */}

                                <button
                                    type="submit"
                                    className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
                                >
                                    <PlusCircle className="inline-block mr-2" size={20} /> Create Match
                                </button>
                            </>
                        ) : (
                            <p className="text-center text-gray-500">Select a date to see available players.</p>
                        )}
                    </form>
                </div>

                {/* All Matches Section */}
                <div className="bg-white p-6 rounded-2xl shadow-xl space-y-4 rounded-xl">
                    <h3 className="text-2xl font-bold text-gray-800 text-center">All Matches</h3>
                    {loading ? (
                        <p className="text-center text-gray-500">Loading matches...</p>
                    ) : matches.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="min-w-full bg-white rounded-lg shadow overflow-hidden">
                                <thead className="bg-gray-100 text-gray-600 uppercase text-sm leading-normal">
                                    <tr>
                                        <th className="py-3 px-6 text-left">Date</th>
                                        <th className="py-3 px-6 text-left">Type</th> {/* Added Type column */}
                                        <th className="py-3 px-6 text-left">Teams</th>
                                        <th className="py-3 px-6 text-center">Score</th>
                                        <th className="py-3 px-6 text-center">Added By</th>
                                        <th className="py-3 px-6 text-center">Status</th>
                                        <th className="py-3 px-6 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="text-gray-600 text-sm font-light">
                                    {matches.map(match => {
                                        // Check if current user is involved in the match
                                        const isCurrentUserInvolved = match.team1.includes(userId) || match.team2.includes(userId);
                                        // Check if the current user has already confirmed
                                        const currentUserConfirmed = match.confirmedBy && match.confirmedBy.includes(userId);

                                        return (
                                            <tr key={match.id} className="border-b border-gray-200 hover:bg-gray-50">
                                                <td className="py-3 px-6 text-left whitespace-nowrap">
                                                    {formatSlotDateTime(match.slotTimestamp, 'date', match.slotTime)}
                                                </td>
                                                <td className="py-3 px-6 text-left whitespace-nowrap">
                                                    {match.gameType ? (match.gameType.charAt(0).toUpperCase() + match.gameType.slice(1)) : 'N/A'}
                                                </td>
                                                <td className="py-3 px-6 text-left">
                                                    {match.team1.map(uid => getMemberName(uid, members)).join(' & ')} vs {match.team2.map(uid => getMemberName(uid, members)).join(' & ')}
                                                </td>
                                                {/* <td className="py-3 px-6 text-center">
                                                    {match.scores?.team1 !== null && match.scores?.team2 !== null
                                                        ? `${match.scores.team1} - ${match.scores.team2}`
                                                        : 'N/A'}
                                                </td> */}
                                                <td className="py-3 px-6 text-center">{getMemberName(match.createdBy, members)}</td>
                                                <td className="py-3 px-6 text-center">
                                                    <span className={`py-1 px-3 rounded-full text-xs font-medium ${
                                                        match.status === 'confirmed' ? 'bg-green-200 text-green-800' :
                                                        match.status === 'pending_score' ? 'bg-blue-200 text-blue-800' : // New status for scores pending
                                                        match.status === 'rejected' ? 'bg-red-200 text-red-800' : // New status for rejected
                                                        'bg-yellow-200 text-yellow-800' // pending_confirmation
                                                    }`}>
                                                        {match.status.replace(/_/g, ' ')}
                                                    </span>
                                                    {match.status === 'pending_confirmation' && (
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            Confirmed by: {match.confirmedBy.map(uid => getMemberName(uid, members)).join(', ')}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="py-3 px-6 text-center flex items-center justify-center space-x-2">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedMatchForDetails(match);
                                                            setShowMatchDetailsModal(true);
                                                        }}
                                                        className="text-blue-600 hover:text-blue-800"
                                                        title="View Details"
                                                    >
                                                        <Info size={18} />
                                                    </button>
                                                    {/* Confirm Match button */}
                                                    {match.status === 'pending_confirmation' && isCurrentUserInvolved && !currentUserConfirmed && (
                                                        <button
                                                            onClick={() => {
                                                                setCurrentMatchToConfirm(match);
                                                                setShowConfirmMatchDialog(true);
                                                            }}
                                                            className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600 transition duration-200 ease-in-out"
                                                            title="Confirm Match"
                                                        >
                                                            <CheckCircle size={18} />
                                                        </button>
                                                    )}
                                                    {/* Submit Score button (Admin only, for matches pending score) */}
                                                    {userRole === 'admin' && match.status === 'pending_score' && (
                                                        <button
                                                            onClick={() => {
                                                                setCurrentMatchToScore(match);
                                                                setScoreTeam1(match.scores?.team1 || '');
                                                                setScoreTeam2(match.scores?.team2 || '');
                                                                setShowSubmitScoreDialog(true);
                                                            }}
                                                            className="bg-blue-500 text-white p-2 rounded-full hover:bg-blue-600 transition duration-200 ease-in-out"
                                                            title="Submit Score"
                                                        >
                                                            <Trophy size={18} />
                                                        </button>
                                                    )}
                                                    {/* Admin Reject button (Admin only, for matches pending confirmation) */}
                                                    {userRole === 'admin' && match.status === 'pending_confirmation' && (
                                                        <button
                                                            onClick={() => {
                                                                setCurrentMatchToConfirm(match); // Use this to pass match to dialog
                                                                setShowConfirmMatchDialog(true); // Reuse dialog for admin reject option
                                                            }}
                                                            className="bg-red-500 text-white p-2 rounded-full hover:bg-red-600 transition duration-200 ease-in-out"
                                                            title="Admin Reject"
                                                        >
                                                            <XCircle size={18} />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <p className="text-center text-gray-500">No matches recorded yet.</p>
                    )}
                </div>
            </div>

            {/* Datalist for available players based on selected date */}
            <datalist id="availableMembersList">
                {availablePlayersOnDate.map(member => (
                    <option key={member.id} value={member.name}></option>
                ))}
            </datalist>

            {/* Confirmation Dialog (for players to confirm/admin to reject) */}
            {showConfirmMatchDialog && currentMatchToConfirm && (
                <CustomAlertDialog
                    title="Confirm or Reject Match?"
                    message={`Match on ${formatSlotDateTime(currentMatchToConfirm.slotTimestamp, 'date', currentMatchToConfirm.slotTime)}: ${currentMatchToConfirm.team1.map(uid => getMemberName(uid, members)).join(' & ')} vs ${currentMatchToConfirm.team2.map(uid => getMemberName(uid, members)).join(' & ')}`}
                    onConfirm={userRole === 'admin' ? handleRejectMatch : handleConfirmMatch} // Admin can reject, player can confirm
                    onCancel={() => setShowConfirmMatchDialog(false)}
                    confirmText={userRole === 'admin' ? "Reject Match" : "Confirm Match"}
                    cancelText="Cancel"
                    showCancelButton={true} // Always show cancel for this dialog
                />
            )}

            {/* Score Submission Dialog (Admin only) */}
            {showSubmitScoreDialog && currentMatchToScore && (
                <CustomAlertDialog
                    title="Submit Match Score"
                    message={
                        <>
                            <p>Enter the final scores for Team 1 and Team 2.</p>
                            <p className="font-semibold mt-2">Match: {formatSlotDateTime(currentMatchToScore.slotTimestamp, 'date', currentMatchToScore.slotTime)}</p>
                            <p>Team 1: {currentMatchToScore.team1.map(uid => getMemberName(uid, members)).join(' & ')}</p>
                            <p>Team 2: {currentMatchToScore.team2.map(uid => getMemberName(uid, members)).join(' & ')}</p>
                            <div className="mt-4 flex space-x-4">
                                <input
                                    type="number"
                                    placeholder="Team 1 Score"
                                    value={scoreTeam1}
                                    onChange={(e) => setScoreTeam1(e.target.value)}
                                    className="shadow appearance-none border rounded-lg w-1/2 py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    min="0"
                                    required
                                />
                                <input
                                    type="number"
                                    placeholder="Team 2 Score"
                                    value={scoreTeam2}
                                    onChange={(e) => setScoreTeam2(e.target.value)}
                                    className="shadow appearance-none border rounded-lg w-1/2 py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                    min="0"
                                    required
                                />
                            </div>
                        </>
                    }
                    onConfirm={handleSubmitScore}
                    onCancel={() => setShowSubmitScoreDialog(false)}
                    confirmText="Submit Scores"
                    cancelText="Cancel"
                    showCancelButton={true}
                />
            )}

            {/* Match Details Modal */}
            {showMatchDetailsModal && selectedMatchForDetails && (
                <MatchDetailsModal
                    match={selectedMatchForDetails}
                    members={members}
                    onClose={() => setShowMatchDetailsModal(false)}
                />
            )}
            {/* Generic Alert Dialog */}
            {showAlert && (
                <CustomAlertDialog
                    message={alertMessage}
                    onConfirm={() => setShowAlert(false)}
                    onCancel={() => setShowAlert(false)} // Allow cancelling generic alerts
                    confirmText="Ok"
                    cancelText="Close"
                    showCancelButton={true}
                />
            )}
        </div>
    );
};
export default MatchManagementPage;
