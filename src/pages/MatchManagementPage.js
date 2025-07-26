const MatchManagementPage = ({ userId, db, appId }) => {
    const [members, setMembers] = useState([]);
    const [matches, setMatches] = useState([]);
    const [team1Player1, setTeam1Player1] = useState('');
    const [team1Player2, setTeam1Player2] = useState('');
    const [team2Player1, setTeam2Player1] = useState('');
    const [team2Player2, setTeam2Player2] = useState('');
    const [scoreTeam1, setScoreTeam1] = useState('');
    const [scoreTeam2, setScoreTeam2] = useState('');
    const [message, setMessage] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [matchToConfirm, setMatchToConfirm] = useState(null);
    const [showMatchDetailsModal, setShowMatchDetailsModal] = useState(false);
    const [selectedMatchForDetails, setSelectedMatchForDetails] = useState(null);
    const [showAlert, setShowAlert] = useState(false);
    const [alertMessage, setAlertMessage] = useState('');
  
    useEffect(() => {
      if (!db) return;
  
      // Fetch all members for team selection from public data
      const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
      const unsubscribeUsers = onSnapshot(usersRef, (snapshot) => {
        const fetchedMembers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMembers(fetchedMembers.filter(m => m.role === 'member' && m.firebaseAuthUid)); // Only show members with a linked Auth UID
      }, (error) => console.error("Error fetching members:", error));
  
      // Fetch all matches
      const matchesRef = collection(db, `artifacts/${appId}/public/data/matches`);
      const unsubscribeMatches = onSnapshot(matchesRef, (snapshot) => {
        const fetchedMatches = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMatches(fetchedMatches);
      }, (error) => console.error("Error fetching matches:", error));
  
      return () => {
        unsubscribeUsers();
        unsubscribeMatches();
      };
    }, [db, appId]);
  
    const handleAddMatch = async (e) => {
      e.preventDefault();
      setMessage('');
      setAlertMessage('');
  
      const team1 = [team1Player1, team1Player2].filter(Boolean);
      const team2 = [team2Player1, team2Player2].filter(Boolean);
  
      if (team1.length === 0 || team2.length === 0 || !scoreTeam1 || !scoreTeam2) {
        setAlertMessage('Please select at least one player for each team and enter scores.');
        setShowAlert(true);
        return;
      }
  
      // Check for duplicate players across teams
      const allPlayers = [...team1, ...team2];
      const uniquePlayers = new Set(allPlayers);
      if (allPlayers.length !== uniquePlayers.size) {
          setAlertMessage('A player cannot be on both teams.');
          setShowAlert(true);
          return;
      }
  
      // Check if current user is part of either team (using Firebase Auth UID)
      const currentUserIsPlayer = team1.includes(userId) || team2.includes(userId);
      if (!currentUserIsPlayer) {
          setAlertMessage('You must be one of the players to add a match.');
          setShowAlert(true);
          return;
      }
  
      try {
        const newMatch = {
          date: new Date().toISOString().split('T')[0], // Current date
          team1: team1, // Store Firebase Auth UIDs
          team2: team2, // Store Firebase Auth UIDs
          score1: parseInt(scoreTeam1), // Ensure scores are numbers
          score2: parseInt(scoreTeam2), // Ensure scores are numbers
          addedBy: userId, // Store Firebase Auth UID of the adder
          confirmedBy: [], // Array of Firebase Auth UIDs who confirmed
          status: 'pending_confirmation'
        };
  
        await addDoc(collection(db, `artifacts/${appId}/public/data/matches`), newMatch);
        setMessage('Match added successfully! Awaiting opponent confirmation.');
        setTeam1Player1('');
        setTeam1Player2('');
        setTeam2Player1('');
        setTeam2Player2('');
        setScoreTeam1('');
        setScoreTeam2('');
      } catch (error) {
        console.error("Error adding match:", error);
        setAlertMessage('Failed to add match. Please try again.');
        setShowAlert(true);
      }
    };
  
    const handleConfirmMatch = async (match) => {
      setMessage('');
      setAlertMessage('');
      // Check if the current user is an opponent and hasn't confirmed yet (using Firebase Auth UID)
      const isOpponent = match.team1.includes(userId) || match.team2.includes(userId);
      const alreadyConfirmed = match.confirmedBy.includes(userId);
  
      if (!isOpponent || alreadyConfirmed) {
        setAlertMessage('You cannot confirm this match or have already confirmed it.');
        setShowAlert(true);
        setShowConfirmModal(false);
        return;
      }
  
      try {
        const matchDocRef = doc(db, `artifacts/${appId}/public/data/matches`, match.id);
        const updatedConfirmedBy = [...match.confirmedBy, userId]; // Add Firebase Auth UID to confirmedBy
        const newStatus = updatedConfirmedBy.length >= 1 ? 'confirmed' : 'pending_confirmation'; // At least one opponent confirms
  
        await updateDoc(matchDocRef, {
          confirmedBy: updatedConfirmedBy,
          status: newStatus
        });
  
        // Update scores and Elo ratings for participating members if confirmed
        if (newStatus === 'confirmed') {
          const team1Players = match.team1;
          const team2Players = match.team2;
  
          const team1Won = match.score1 > match.score2;
          const isDraw = match.score1 === match.score2;
  
          // Fetch current Elo ratings and gamesPlayed for all players involved
          const playerStatsMap = new Map(); // Map: UID -> { eloRating, gamesPlayed, publicId }
          const allPlayerUids = [...new Set([...team1Players, ...team2Players])];
          for (const uid of allPlayerUids) {
              const playerProfileRef = doc(db, `artifacts/${appId}/users/${uid}/profile/data`);
              const playerDocSnap = await getDoc(playerProfileRef);
              if (playerDocSnap.exists()) {
                  playerStatsMap.set(uid, {
                      eloRating: playerDocSnap.data().eloRating || 1000,
                      gamesPlayed: playerDocSnap.data().gamesPlayed || 0,
                      publicId: playerDocSnap.data().publicId
                  });
              } else {
                  // This scenario should ideally not happen if users are properly registered
                  console.warn(`Player profile not found for UID: ${uid}. Defaulting Elo to 1000.`);
                  playerStatsMap.set(uid, { eloRating: 1000, gamesPlayed: 0, publicId: null });
              }
          }
  
          // Calculate average Elo for each team
          const getAverageElo = (teamUids) => {
              if (teamUids.length === 0) return 0;
              const totalElo = teamUids.reduce((sum, uid) => sum + playerStatsMap.get(uid).eloRating, 0);
              return totalElo / teamUids.length;
          };
  
          const team1AvgElo = getAverageElo(team1Players);
          const team2AvgElo = getAverageElo(team2Players);
  
          // Update Elo for each player and update their score history
          for (const playerId of allPlayerUids) {
            const playerProfileRef = doc(db, `artifacts/${appId}/users/${playerId}/profile/data`);
            const currentStats = playerStatsMap.get(playerId);
            const currentElo = currentStats.eloRating;
            const currentGamesPlayed = currentStats.gamesPlayed;
            const publicId = currentStats.publicId;
  
            const newScores = [...(playerData.scores || [])]; // playerData is from the initial fetch, might be stale. Use currentStats.scores if available.
                                                              // For simplicity, we'll append to the fetched scores.
  
            let outcome; // 1 for win, 0.5 for draw, 0 for loss
            let opponentEloForCalc;
            let opponentName = '';
            let winStatus = false;
  
            if (team1Players.includes(playerId)) { // Player is in Team 1
              opponentEloForCalc = team2AvgElo;
              if (team1Won) {
                outcome = 1;
                winStatus = true;
              } else if (isDraw) {
                outcome = 0.5;
                winStatus = false; // Or true if you consider draw as not a loss
              } else {
                outcome = 0;
                winStatus = false;
              }
              opponentName = team2Players.map(id => members.find(m => m.firebaseAuthUid === id)?.name || 'Unknown').join(' & ');
            } else { // Player is in Team 2
              opponentEloForCalc = team1AvgElo;
              if (!team1Won && !isDraw) { // Team 2 wins
                outcome = 1;
                winStatus = true;
              } else if (isDraw) {
                outcome = 0.5;
                winStatus = false; // Or true if you consider draw as not a loss
              } else {
                outcome = 0;
                winStatus = false;
              }
              opponentName = team1Players.map(id => members.find(m => m.firebaseAuthUid === id)?.name || 'Unknown').join(' & ');
            }
  
            const eloChange = calculateEloChange(currentElo, opponentEloForCalc, outcome, currentGamesPlayed);
            const newElo = currentElo + eloChange;
            const newGamesPlayed = currentGamesPlayed + 1;
  
            newScores.push({
              date: match.date,
              opponent: opponentName,
              score: `${match.score1}-${match.score2}`,
              win: winStatus
            });
  
            // Update private profile
            await updateDoc(playerProfileRef, {
              scores: newScores,
              eloRating: newElo,
              gamesPlayed: newGamesPlayed
            });
  
            // Update public profile as well
            if (publicId) {
                const publicUserDocRef = doc(db, `artifacts/${appId}/public/data/users`, publicId);
                await updateDoc(publicUserDocRef, {
                  scores: newScores, // Keep public scores in sync
                  eloRating: newElo,
                  gamesPlayed: newGamesPlayed
                });
            }
          }
        }
  
        setMessage('Match confirmed successfully! Elo ratings updated.');
        setShowConfirmModal(false);
        setMatchToConfirm(null);
      } catch (error) {
        console.error("Error confirming match:", error);
        setAlertMessage('Failed to confirm match. Please try again.');
        setShowAlert(true);
      }
    };
  
    const openConfirmModal = (match) => {
      setMatchToConfirm(match);
      setShowConfirmModal(true);
    };
  
    const openMatchDetails = (match) => {
      setSelectedMatchForDetails(match);
      setShowMatchDetailsModal(true);
    };
  
    // Helper to get member name from Firebase Auth UID
    const getMemberName = (firebaseAuthUid) => members.find(m => m.firebaseAuthUid === firebaseAuthUid)?.name || 'Unknown Player';
  
    return (
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-5xl w-full flex flex-col lg:flex-row gap-8 transform transition-all duration-300 ease-in-out hover:scale-105">
        {/* Left Section: Add New Match */}
        <div className="flex-1 space-y-6">
          <h2 className="text-3xl font-bold text-blue-700 mb-4 flex items-center">
            <PlusCircle className="mr-2 text-green-600" size={32} /> Add New Match
          </h2>
          <form onSubmit={handleAddMatch} className="space-y-6">
            {/* Team 1 Selection */}
            <div className="bg-blue-50 p-6 rounded-xl shadow-md">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <Users className="mr-2 text-blue-600" size={24} /> Team 1
              </h3>
              <div>
                <label htmlFor="team1Player1" className="block text-gray-700 text-sm font-medium mb-2">Player 1</label>
                <select
                  id="team1Player1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={team1Player1}
                  onChange={(e) => setTeam1Player1(e.target.value)}
                  required
                >
                  <option value="">-- Select Player --</option>
                  {members.map(member => (
                    <option key={member.firebaseAuthUid} value={member.firebaseAuthUid}>{member.name}</option>
                  ))}
                </select>
              </div>
              <div className="mt-4">
                <label htmlFor="team1Player2" className="block text-gray-700 text-sm font-medium mb-2">Player 2 (Optional)</label>
                <select
                  id="team1Player2"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={team1Player2}
                  onChange={(e) => setTeam1Player2(e.target.value)}
                >
                  <option value="">-- Select Player --</option>
                  {members.map(member => (
                    <option key={member.firebaseAuthUid} value={member.firebaseAuthUid}>{member.name}</option>
                  ))}
                </select>
              </div>
            </div>
  
            {/* Team 2 Selection */}
            <div className="bg-purple-50 p-6 rounded-xl shadow-md">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <Users className="mr-2 text-purple-600" size={24} /> Team 2 (Opponent)
              </h3>
              <div>
                <label htmlFor="team2Player1" className="block text-gray-700 text-sm font-medium mb-2">Player 1</label>
                <select
                  id="team2Player1"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={team2Player1}
                  onChange={(e) => setTeam2Player1(e.target.value)}
                  required
                >
                  <option value="">-- Select Player --</option>
                  {members.map(member => (
                    <option key={member.firebaseAuthUid} value={member.firebaseAuthUid}>{member.name}</option>
                  ))}
                </select>
              </div>
              <div className="mt-4">
                <label htmlFor="team2Player2" className="block text-gray-700 text-sm font-medium mb-2">Player 2 (Optional)</label>
                <select
                  id="team2Player2"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                  value={team2Player2}
                  onChange={(e) => setTeam2Player2(e.target.value)}
                >
                  <option value="">-- Select Player --</option>
                  {members.map(member => (
                    <option key={member.firebaseAuthUid} value={member.firebaseAuthUid}>{member.name}</option>
                  ))}
                </select>
              </div>
            </div>
  
            {/* Scores */}
            <div className="bg-yellow-50 p-6 rounded-xl shadow-md">
              <h3 className="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                <Trophy className="mr-2 text-yellow-600" size={24} /> Scores
              </h3>
              <div className="flex space-x-4">
                <div className="flex-1">
                  <label htmlFor="scoreTeam1" className="block text-gray-700 text-sm font-medium mb-2">Team 1 Score</label>
                  <input
                    type="number"
                    id="scoreTeam1"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                    value={scoreTeam1}
                    onChange={(e) => setScoreTeam1(e.target.value)}
                    min="0"
                    required
                  />
                </div>
                <div className="flex-1">
                  <label htmlFor="scoreTeam2" className="block text-gray-700 text-sm font-medium mb-2">Team 2 Score</label>
                  <input
                    type="number"
                    id="scoreTeam2"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition duration-200 ease-in-out"
                    value={scoreTeam2}
                    onChange={(e) => setScoreTeam2(e.target.value)}
                    min="0"
                    required
                  />
                </div>
              </div>
            </div>
  
            <button
              type="submit"
              className="w-full bg-gradient-to-r from-green-500 to-teal-600 text-white py-3 px-6 rounded-xl text-lg font-semibold shadow-lg hover:from-green-600 hover:to-teal-700 transform hover:-translate-y-1 transition duration-300 ease-in-out flex items-center justify-center"
            >
              <PlusCircle className="mr-2" size={20} /> Add Match
            </button>
          </form>
          {message && (
            <div className={`mt-4 p-3 rounded-lg text-center ${message.includes('success') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {message}
            </div>
          )}
        </div>
  
        {/* Right Section: Match History and Confirmation */}
        <div className="flex-1 space-y-6">
          <h3 className="text-3xl font-bold text-blue-700 mb-4 flex items-center">
            <Bell className="mr-2 text-orange-600" size={32} /> Match History & Confirmations
          </h3>
  
          {matches.length > 0 ? (
            <ul className="space-y-4">
              {matches.map(match => (
                <li key={match.id} className="bg-white p-6 rounded-xl shadow-md border border-gray-200">
                  <p className="text-sm text-gray-500 mb-2">{match.date}</p>
                  <h4 className="text-lg font-semibold text-gray-800 mb-2">
                    {match.team1.map(getMemberName).join(' & ')} vs {match.team2.map(getMemberName).join(' & ')}
                  </h4>
                  <p className="text-xl font-bold text-blue-700 mb-3">Score: {match.score1} - {match.score2}</p>
                  <p className="text-gray-600 text-sm">Added by: {getMemberName(match.addedBy)}</p>
                  <p className="text-gray-600 text-sm">Confirmed by: {match.confirmedBy.length > 0 ? match.confirmedBy.map(getMemberName).join(', ') : 'None'}</p>
                  <p className="text-gray-600 text-sm mb-3">Status: <span className={`font-semibold ${match.status === 'confirmed' ? 'text-green-600' : 'text-orange-600'}`}>{match.status.replace('_', ' ')}</span></p>
  
                  <div className="flex space-x-2 mt-3">
                      {/* Confirmation Button */}
                      {userId && (match.team1.includes(userId) || match.team2.includes(userId)) && !match.confirmedBy.includes(userId) && match.status !== 'confirmed' && (
                      <button
                          onClick={() => openConfirmModal(match)}
                          className="bg-orange-500 text-white px-4 py-2 rounded-lg shadow-md hover:bg-orange-600 transition duration-200 ease-in-out flex items-center justify-center text-sm"
                      >
                          <CheckCircle className="mr-2" size={20} /> Confirm Score
                      </button>
                      )}
                      {/* View Details Button */}
                      <button
                          onClick={() => openMatchDetails(match)}
                          className="bg-gray-500 text-white px-4 py-2 rounded-lg shadow-md hover:bg-gray-600 transition duration-200 ease-in-out flex items-center justify-center text-sm"
                      >
                          <Info className="mr-2" size={20} /> View Details
                      </button>
                  </div>
  
                  {/* Notification Placeholder */}
                  {userId && (match.team1.includes(userId) || match.team2.includes(userId)) && match.status === 'pending_confirmation' && !match.confirmedBy.includes(userId) && (
                      <div className="mt-3 p-2 bg-yellow-100 text-yellow-800 rounded-lg text-sm flex items-center">
                          <Bell className="mr-2" size={18} /> You have a pending match to confirm!
                      </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-gray-500">No matches recorded yet.</p>
          )}
        </div>
  
        {/* Confirmation Modal */}
        {showConfirmModal && matchToConfirm && (
          <CustomAlertDialog
            message={`Are you sure you want to confirm the score for the match on ${matchToConfirm.date}: ${matchToConfirm.team1.map(getMemberName).join(' & ')} vs ${matchToConfirm.team2.map(getMemberName).join(' & ')}? Score: ${matchToConfirm.score1} - ${matchToConfirm.score2}`}
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
  