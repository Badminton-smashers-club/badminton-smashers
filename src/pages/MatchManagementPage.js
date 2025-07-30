import React, { useState, useEffect, useCallback } from 'react';
import { collection, addDoc, doc, updateDoc, onSnapshot, getDoc } from 'firebase/firestore'; // getDoc added
import { PlusCircle, Users, Trophy, Bell, CheckCircle, Info, XCircle } from 'lucide-react'; // XCircle added
import CustomAlertDialog from '../components/CustomAlertDialog';
import MatchDetailsModal from '../components/MatchDetailsModal';

const MatchManagementPage = ({ userId, db, appId, userRole }) => { // userRole prop added
    const [members, setMembers] = useState([]);
    const [matches, setMatches] = useState([]);
    // State for new match form inputs
    const [team1Player1Name, setTeam1Player1Name] = useState('');
    const [team1Player2Name, setTeam1Player2Name] = useState('');
    const [team2Player1Name, setTeam2Player1Name] = useState('');
    const [team2Player2Name, setTeam2Player2Name] = useState('');
    const [scoreTeam1, setScoreTeam1] = useState('');
    const [scoreTeam2, setScoreTeam2] = useState('');
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');

    // New states for match setup by members
    const [slots, setSlots] = useState([]); // To fetch all slots
    const [selectedMatchDate, setSelectedMatchDate] = useState(''); // New state for match date
    const [availablePlayersOnDate, setAvailablePlayersOnDate] = useState([]); // Players available on selected date

    // States for confirmation modal
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [matchToConfirm, setMatchToConfirm] = useState(null);

    // States for match details modal
    const [showMatchDetailsModal, setShowMatchDetailsModal] = useState(false);
    const [selectedMatchForDetails, setSelectedMatchForDetails] = useState(null);

    // Helper function to format date/time consistently
    const formatSlotDateTime = (dateTimeString, type = 'date') => {
        if (!dateTimeString) {
            return 'N/A';
        }
        const dateObj = new Date(dateTimeString);
        if (isNaN(dateObj.getTime())) {
            console.error("Invalid dateTime string encountered:", dateTimeString);
            return 'Invalid Date';
        }

        if (type === 'date') {
            return dateObj.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        } else if (type === 'time') {
            return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } else if (type === 'full') {
            return dateObj.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' });
        }
        return 'N/A';
    };

    // Memoized getters for member name and UID
    const getMemberName = useCallback((uid) => {
        const member = members.find(m => m.firebaseAuthUid === uid);
        return member ? member.name : 'Unknown Player';
    }, [members]);

    const getMemberUid = useCallback((name) => {
        const member = members.find(m => m.name === name);
        return member ? member.firebaseAuthUid : null;
    }, [members]);

    // Fetch members, matches, and slots
    useEffect(() => {
        if (!db) return;

        const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
        const unsubscribeUsers = onSnapshot(usersRef, (snapshot) => {
            const fetchedMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setMembers(fetchedMembers);
        }, (err) => {
            console.error("Error fetching members for match management:", err);
            setError("Failed to load members.");
        });

        const matchesRef = collection(db, `artifacts/${appId}/public/data/matches`);
        const unsubscribeMatches = onSnapshot(matchesRef, (snapshot) => {
            const fetchedMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Sort matches by date (newest first) and then by status (pending for current user first)
            fetchedMatches.sort((a, b) => {
                const dateA = new Date(a.date);
                const dateB = new Date(b.date);
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

        // NEW: Fetch all slots to filter available players by date
        const slotsRef = collection(db, `artifacts/${appId}/public/data/slots`);
        const unsubscribeSlots = onSnapshot(slotsRef, (snapshot) => {
            const fetchedSlots = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setSlots(fetchedSlots);
        }, (err) => {
            console.error("Error fetching slots for match management:", err);
        });

        return () => {
            unsubscribeUsers();
            unsubscribeMatches();
            unsubscribeSlots(); // Unsubscribe from slots
        };
    }, [db, appId, userId]); // Add userId to dependencies

    // Effect to determine available players based on selected date and booked slots
    useEffect(() => {
        if (!selectedMatchDate || !members.length || !slots.length) {
            setAvailablePlayersOnDate([]);
            return;
        }

        const bookedUserIdsOnDate = new Set();
        // Filter slots for the selected date and get unique bookedBy UIDs
        slots.forEach(slot => {
            // Compare the date part of the slot's dateTime with the selectedMatchDate
            const slotDate = new Date(slot.dateTime).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
            const inputDate = new Date(selectedMatchDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

            if (slotDate === inputDate && slot.bookedBy) {
                bookedUserIdsOnDate.add(slot.bookedBy);
            }
        });

        // Filter members based on who has booked a slot on the selected date
        const players = members.filter(member => bookedUserIdsOnDate.has(member.firebaseAuthUid));
        setAvailablePlayersOnDate(players);

    }, [selectedMatchDate, members, slots]); // Dependencies

    const handleAddMatch = async (e) => {
        e.preventDefault();
        setMessage('');
        setAlertMessage('');

        if (!selectedMatchDate) {
            setAlertMessage('Please select a match date.');
            setShowAlert(true);
            return;
        }

        const p1T1Uid = getMemberUid(team1Player1Name);
        const p2T1Uid = team1Player2Name ? getMemberUid(team1Player2Name) : null;
        const p1T2Uid = getMemberUid(team2Player1Name);
        const p2T2Uid = team2Player2Name ? getMemberUid(team2Player2Name) : null;

        const team1Uids = [p1T1Uid].filter(Boolean); // Filter out null if player not found
        if (p2T1Uid) team1Uids.push(p2T1Uid);

        const team2Uids = [p1T2Uid].filter(Boolean);
        if (p2T2Uid) team2Uids.push(p2T2Uid);

        // Validation: Ensure all selected players are valid and unique UIDs
        const allSelectedUids = [...team1Uids, ...team2Uids].filter(Boolean);
        const uniqueUids = new Set(allSelectedUids);

        if (allSelectedUids.length === 0 || allSelectedUids.length !== uniqueUids.size) {
            setAlertMessage('Please select unique and valid players for both teams.');
            setShowAlert(true);
            return;
        }
        
        // Ensure the current user (adder) is part of the match
        if (!allSelectedUids.includes(userId)) {
             setAlertMessage('You must be one of the players in the match you are adding.');
             setShowAlert(true);
             return;
        }

        // Basic score validation
        if (scoreTeam1 === '' || scoreTeam2 === '') {
            setAlertMessage('Please enter scores for both teams.');
            setShowAlert(true);
            return;
        }
        
        const score1Int = parseInt(scoreTeam1);
        const score2Int = parseInt(scoreTeam2);

        if (isNaN(score1Int) || isNaN(score2Int) || score1Int < 0 || score2Int < 0) {
            setAlertMessage('Scores must be non-negative numbers.');
            setShowAlert(true);
            return;
        }
        
        // Prevent equal scores (draws) as per Elo system for win/loss
        if (score1Int === score2Int) {
            setAlertMessage('Draws are not currently supported. Please enter a winning score for one team.');
            setShowAlert(true);
            return;
        }


        try {
            await addDoc(collection(db, `artifacts/${appId}/public/data/matches`), {
                date: selectedMatchDate, // Use the selected date (YYYY-MM-DD format from input)
                team1: team1Uids,
                team2: team2Uids,
                score1: score1Int,
                score2: score2Int,
                addedBy: userId, // Member who added the match
                status: 'pending_confirmation', // New status for confirmation
                confirmedBy: [userId], // Member who added automatically confirms their side
                createdAt: new Date()
            });
            setMessage('Match added successfully! Awaiting confirmation from the other team.');
            setSelectedMatchDate(''); // Clear date
            setTeam1Player1Name('');
            setTeam1Player2Name('');
            setTeam2Player1Name('');
            setTeam2Player2Name('');
            setScoreTeam1('');
            setScoreTeam2('');
        } catch (error) {
            console.error("Error adding match:", error);
            setAlertMessage('Failed to add match. Please try again.');
            setShowAlert(true);
        }
    };

    // Function to handle score confirmation
    const handleConfirmMatch = useCallback(async (match) => {
        setMessage('');
        setAlertMessage('');

        if (!match || !userId) return;

        try {
            const matchRef = doc(db, `artifacts/${appId}/public/data/matches`, match.id);
            const currentMatchSnap = await getDoc(matchRef); // Get latest state
            if (!currentMatchSnap.exists()) {
                setAlertMessage('Match no longer exists.');
                setShowAlert(true);
                return;
            }
            const currentMatchData = currentMatchSnap.data();

            let updatedConfirmedBy = new Set(currentMatchData.confirmedBy || []);
            updatedConfirmedBy.add(userId);

            let newStatus = currentMatchData.status;

            // Determine if all required players have confirmed
            const allPlayersInMatch = [...currentMatchData.team1, ...currentMatchData.team2];
            // Ensure every player in the match is in the updatedConfirmedBy set
            const hasAllPlayersConfirmed = allPlayersInMatch.every(playerUid => updatedConfirmedBy.has(playerUid));

            // If an admin confirms, it overrides player confirmations
            if (userRole === 'admin') {
                newStatus = 'confirmed';
            } else if (hasAllPlayersConfirmed) {
                newStatus = 'confirmed';
            } else {
                newStatus = 'pending_confirmation';
            }

            await updateDoc(matchRef, {
                confirmedBy: Array.from(updatedConfirmedBy), // Convert Set back to Array
                status: newStatus
            });
            
            setMessage('Match score confirmation submitted!');
            if (newStatus === 'confirmed') {
                setMessage('Match confirmed! Elo ratings will update shortly.');
            } else {
                setMessage('Your confirmation has been recorded. Awaiting other player(s) confirmation.');
            }

        } catch (error) {
            console.error("Error confirming match:", error);
            setAlertMessage('Failed to confirm match. Please try again.');
            setShowAlert(true);
        } finally {
            setShowConfirmModal(false);
            setMatchToConfirm(null);
        }
    }, [db, appId, userId, userRole]); // Add userRole to dependencies


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
                                value={selectedMatchDate}
                                onChange={(e) => setSelectedMatchDate(e.target.value)}
                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                required
                            />
                        </div>
                        {selectedMatchDate ? ( // Only show player selection if a date is selected
                            availablePlayersOnDate.length > 0 ? (
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
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="scoreTeam1" className="block text-gray-700 text-sm font-bold mb-2">Team 1 Score:</label>
                                            <input
                                                type="number"
                                                id="scoreTeam1"
                                                value={scoreTeam1}
                                                onChange={(e) => setScoreTeam1(e.target.value)}
                                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                                required
                                                min="0"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="scoreTeam2" className="block text-gray-700 text-sm font-bold mb-2">Team 2 Score:</label>
                                            <input
                                                type="number"
                                                id="scoreTeam2"
                                                value={scoreTeam2}
                                                onChange={(e) => setScoreTeam2(e.target.value)}
                                                className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                                required
                                                min="0"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg shadow-md hover:bg-blue-700 transition duration-200 ease-in-out"
                                    >
                                        <PlusCircle className="inline-block mr-2" size={20} /> Add Match
                                    </button>
                                </>
                            ) : (
                                <p className="text-center text-gray-500">No players available for the selected date.</p>
                            )
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
                                        // Determine if "Confirm Score" button should be shown
                                        const showConfirmButton = match.status === 'pending_confirmation' && 
                                                                (isCurrentUserInvolved && !currentUserConfirmed) || userRole === 'admin';

                                        return (
                                            <tr key={match.id} className="border-b border-gray-200 hover:bg-gray-50">
                                                <td className="py-3 px-6 text-left whitespace-nowrap">
                                                    {formatSlotDateTime(match.date, 'date')}
                                                </td>
                                                <td className="py-3 px-6 text-left">
                                                    {match.team1.map(getMemberName).join(' & ')} vs {match.team2.map(getMemberName).join(' & ')}
                                                </td>
                                                <td className="py-3 px-6 text-center">{match.score1} - {match.score2}</td>
                                                <td className="py-3 px-6 text-center">{getMemberName(match.addedBy)}</td>
                                                <td className="py-3 px-6 text-center">
                                                    <span className={`py-1 px-3 rounded-full text-xs font-medium ${
                                                        match.status === 'confirmed' ? 'bg-green-200 text-green-800' :
                                                        'bg-yellow-200 text-yellow-800'
                                                    }`}>
                                                        {match.status.replace(/_/g, ' ')}
                                                    </span>
                                                    {match.status === 'pending_confirmation' && (
                                                        <div className="text-xs text-gray-500 mt-1">
                                                            Confirmed by: {match.confirmedBy.map(getMemberName).join(', ')}
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
                                                    {showConfirmButton && (
                                                        <button
                                                            onClick={() => {
                                                                setMatchToConfirm(match);
                                                                setShowConfirmModal(true);
                                                            }}
                                                            className="bg-green-500 text-white p-2 rounded-full hover:bg-green-600 transition duration-200 ease-in-out"
                                                            title={userRole === 'admin' ? "Admin Confirm" : "Confirm Score"}
                                                        >
                                                            <CheckCircle size={18} />
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
                    <option key={member.firebaseAuthUid} value={member.name}></option>
                ))}
            </datalist>

            {/* Confirmation Modal */}
            {showConfirmModal && matchToConfirm && (
                <CustomAlertDialog
                    title="Confirm Match Score"
                    message={`Do you want to confirm the score for the match on ${formatSlotDateTime(matchToConfirm.date, 'date')}: ${matchToConfirm.team1.map(getMemberName).join(' & ')} vs ${matchToConfirm.team2.map(getMemberName).join(' & ')}? Score: ${matchToConfirm.score1} - ${matchToConfirm.score2}`}
                    onConfirm={() => handleConfirmMatch(matchToConfirm)}
                    onCancel={() => setShowConfirmModal(false)}
                    confirmText="Confirm"
                    cancelText="Cancel"
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
export default MatchManagementPage;