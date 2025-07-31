// functions/index.js
// functions/index.js

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const path = require('path');
const { format, subHours} = require('date-fns'); // Ensure subHours is imported here


// 1. >>> DOTENV CONFIGURATION (MUST BE THE FIRST EXECUTING LOGIC AFTER REQUIRES) <<<
if (process.env.NODE_ENV !== 'production') {
  // eslint-disable-next-line global-require
  require('dotenv').config({ path: path.resolve(__dirname, '.env') });
}

// 2. >>> INITIALIZE FIREBASE ADMIN SDK <<<
admin.initializeApp();

// 3. >>> DECLARE FIRESTORE SERVICES & CONSTANTS USING MODULAR IMPORTS <<<
// Import getFirestore, FieldValue, and Timestamp directly from the firestore module
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const db = getFirestore(); // Initialize db using getFirestore()

// 4. >>> GET APP_ID FROM PROCESS.ENV <<<
const appId = process.env.APP_ID;
functions.logger.info(`Cloud Function APP_ID: ${appId}`);

// Elo calculation logic (assuming this is correct)
const calculateEloChange = (playerElo, opponentElo, outcome, gamesPlayed = 0) => {
    let kFactor;
    if (gamesPlayed < 10) { // New players have higher volatility
      kFactor = 40;
    } else if (playerElo < 1500) { // Mid-range players
      kFactor = 32;
    } else { // High-rated players
      kFactor = 24;
    }
    const expectedScore = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
    const eloChange = kFactor * (outcome - expectedScore);
    return eloChange;
};


// Add this helper function in index.js
async function recordTransaction(userId, appId, amount, type, description, db, batch, relatedId = null) {
    const transactionsRef = db.collection(`artifacts/${appId}/users/${userId}/transactions`);
    const transactionData = {
        amount: amount,
        type: type,
        description: description,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        // currentBalance is handled client-side in MemberDashboard for display,
        // and implicitly by the balance updates in the user profile.
        // It's not strictly necessary to store it here unless you want
        // a historical balance snapshot per transaction.
    };
    if (relatedId) {
        transactionData.relatedId = relatedId;
    }

    if (batch) {
        // If part of a batch, add to batch
        batch.set(transactionsRef.doc(), transactionData); // Use doc() to generate a new ID
    } else {
        // Otherwise, commit immediately
        await transactionsRef.add(transactionData);
    }
}
// Cloud Function to update Elo ratings and scores for players after a match is confirmed.
// Triggered on update of a match document in 'artifacts/{appId}/public/data/matches/{matchId}'.
// It only runs if the 'status' field transitions to 'confirmed'.
exports.updateEloOnMatchConfirmation = functions.firestore
    .document('artifacts/{appIdFromContext}/public/data/matches/{matchId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();
        const appIdFromContext = context.params.appIdFromContext;
        const matchId = context.params.matchId;

        // --- MATCH CONFIRMED AND SCORES AVAILABLE (TRIGGER ELO UPDATE) ---
        if (newData.status === 'confirmed' && previousData.status !== 'confirmed') {
            const team1Uids = newData.team1;
            const team2Uids = newData.team2;
            const score1 = newData.scores?.team1;
            const score2 = newData.scores?.team2;
            const gameType = newData.gameType; // Ensure gameType is available in match data

            if (score1 === null || score2 === null || typeof score1 === 'undefined' || typeof score2 === 'undefined') {
                console.warn(`Match ${matchId} confirmed but scores are null/undefined. Skipping Elo update.`);
                return null;
            }

            const batch = db.batch();
            const allPlayerUids = [...new Set([...team1Uids, ...team2Uids])];

            const playerProfiles = {};
            for (const uid of allPlayerUids) {
                const userProfileRef = db.doc(`artifacts/${appIdFromContext}/public/data/users/${uid}`); // Public profile for Elo
                const docSnap = await userProfileRef.get();
                if (docSnap.exists) {
                    playerProfiles[uid] = { ...docSnap.data(), ref: userProfileRef };
                } else {
                    console.warn(`User public profile not found for UID: ${uid}. Elo update skipped for this player.`);
                    return null;
                }
            }

            const getTeamElo = (uids, excludeUid = null) => {
                if (uids.length === 0) return 1000;
                const relevantUids = excludeUid ? uids.filter(uid => uid !== excludeUid) : uids;
                if (relevantUids.length === 0) return 1000;
                return relevantUids.reduce((sum, uid) => sum + (playerProfiles[uid]?.eloRating || 1000), 0) / relevantUids.length;
            };

            const team1AvgEloAll = getTeamElo(team1Uids);
            const team2AvgEloAll = getTeamElo(team2Uids);

            let outcomeTeam1;
            if (score1 > score2) {
                outcomeTeam1 = 1;
            } else if (score2 > score1) {
                outcomeTeam1 = 0;
            } else {
                outcomeTeam1 = 0.5;
            }

            for (const uid of allPlayerUids) {
                const currentElo = playerProfiles[uid].eloRating || 1000;
                const gamesPlayed = playerProfiles[uid].gamesPlayed || 0;
                let newEloChange;
                let playerOutcome;

                if (team1Uids.includes(uid)) {
                    newEloChange = calculateEloChange(currentElo, team2AvgEloAll, outcomeTeam1, gamesPlayed);
                    playerOutcome = outcomeTeam1;
                } else {
                    newEloChange = calculateEloChange(currentElo, team1AvgEloAll, 1 - outcomeTeam1, gamesPlayed);
                    playerOutcome = 1 - outcomeTeam1;
                }

                const updatedElo = Math.max(100, Math.round(currentElo + newEloChange));
                const updatedGamesPlayed = gamesPlayed + 1;
                const wins = (playerProfiles[uid].wins || 0) + (playerOutcome === 1 ? 1 : 0);
                const losses = (playerProfiles[uid].losses || 0) + (playerOutcome === 0 ? 1 : 0);
                const draws = (playerProfiles[uid].draws || 0) + (playerOutcome === 0.5 ? 1 : 0);

                batch.update(playerProfiles[uid].ref, {
                    eloRating: updatedElo,
                    gamesPlayed: updatedGamesPlayed,
                    wins: wins,
                    losses: losses,
                    draws: draws,
                    lastGameDate: FieldValue.serverTimestamp()
                });

                const matchHistoryRef = db.doc(`artifacts/${appIdFromContext}/users/${uid}/matches_played/${matchId}`);
                batch.set(matchHistoryRef, {
                    matchId: matchId,
                    date: newData.date,
                    time: newData.time,
                    gameType: gameType,
                    team1: team1Uids,
                    team2: team2Uids,
                    scoreTeam1: score1,
                    scoreTeam2: score2,
                    playerTeam: team1Uids.includes(uid) ? 'team1' : 'team2',
                    eloChange: newEloChange,
                    oldElo: currentElo,
                    newElo: updatedElo,
                    outcome: playerOutcome,
                    timestamp: FieldValue.serverTimestamp()
                }, { merge: true });
            }

            await batch.commit();
            console.log(`Elo ratings, stats, and match history updated for match ${matchId}.`);

            // Send notifications to all players about confirmed match with scores
            for (const playerId of allPlayerUids) {
                // Corrected: Use db.doc() for a document reference
                const userPrivateProfileRef = db.doc(`artifacts/${appIdFromContext}/users/${playerId}/profile/data`);
                const userPrivateProfileSnap = await userPrivateProfileRef.get();

                if (userPrivateProfileSnap.exists && userPrivateProfileSnap.data().fcmToken) {
                    const token = userPrivateProfileSnap.data().fcmToken;
                    const matchDate = newData.slotTimestamp?.toDate();
                    const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
                    const payload = {
                        notification: {
                            title: 'Match Confirmed!',
                            body: `The match on ${matchDateFormatted} at ${newData.slotTime} has been confirmed and scores submitted!`,
                            icon: '/firebase-logo.png'
                        },
                        data: {
                            matchId: change.after.id,
                            status: 'confirmed',
                            type: 'match_confirmed_scores_submitted',
                            click_action: 'FLUTTER_NOTIFICATION_CLICK'
                        }
                    };
                    try {
                        await admin.messaging().sendToDevice(token, payload);
                        console.log(`Notification sent to ${playerId} for confirmed match with scores.`);
                    } catch (error) {
                        console.error(`Failed to send notification to ${playerId}:`, error);
                    }
                }
            }
            return null;

        } else if (newData.status === 'pending_confirmation' && previousData.status !== 'pending_confirmation') {
            const allPlayersInMatch = [...newData.team1, ...newData.team2];
            const playersStillToConfirm = allPlayersInMatch.filter(playerId =>
                playerId !== newData.createdBy && (!newData.confirmedBy || !newData.confirmedBy.includes(playerId))
            );

            for (const playerId of playersStillToConfirm) {
                // Corrected: Use db.doc() for a document reference
                const userProfileRef = db.doc(`artifacts/${appIdFromContext}/users/${playerId}/profile/data`);
                const userProfileSnap = await userProfileRef.get();

                if (userProfileSnap.exists && userProfileSnap.data().fcmToken) {
                    const token = userProfileSnap.data().fcmToken;
                    const matchDate = newData.slotTimestamp?.toDate();
                    const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
                    const payload = {
                        notification: {
                            title: 'Match Pending Confirmation!',
                            body: `A match on ${matchDateFormatted} at ${newData.slotTime} involving you needs your confirmation!`,
                            icon: '/firebase-logo.png'
                        },
                        data: {
                            matchId: change.after.id,
                            status: 'pending_confirmation',
                            type: 'match_confirmation',
                            click_action: 'FLUTTER_NOTIFICATION_CLICK'
                        }
                    };
                    try {
                        await admin.messaging().sendToDevice(token, payload);
                        console.log(`Notification sent to ${playerId} for pending confirmation.`);
                    } catch (error) {
                        console.error(`Failed to send notification to ${playerId}:`, error);
                    }
                } else {
                    console.log(`No FCM token found or profile missing for ${playerId}. Skipping notification.`);
                }
            }
        } else if (newData.status === 'awaiting_scores' && previousData.status !== 'awaiting_scores') { // New status for player score submission
            const allPlayersInMatch = [...newData.team1, ...newData.team2];
            for (const playerId of allPlayersInMatch) {
                const userPrivateProfileRef = db.doc(`artifacts/${appIdFromContext}/users/${playerId}/profile/data`);
                const userPrivateProfileSnap = await userPrivateProfileRef.get();

                if (userPrivateProfileSnap.exists && userPrivateProfileSnap.data().fcmToken) {
                    const token = userPrivateProfileSnap.data().fcmToken;
                    const matchDate = newData.slotTimestamp?.toDate();
                    const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
                    const payload = {
                        notification: {
                            title: 'Match Ready for Score Submission!',
                            body: `The match on ${matchDateFormatted} at ${newData.slotTime} needs scores submitted!`,
                            icon: '/firebase-logo.png'
                        },
                        data: {
                            matchId: change.after.id,
                            status: 'awaiting_scores',
                            type: 'score_submission_required',
                            click_action: 'FLUTTER_NOTIFICATION_CLICK'
                        }
                    };
                    try {
                        await admin.messaging().sendToDevice(token, payload);
                        console.log(`Notification sent to ${playerId} for awaiting scores.`);
                    } catch (error) {
                        console.error(`Failed to send notification to ${playerId}:`, error);
                    }
                }
            }
        } else if (newData.status === 'rejected' && previousData.status !== 'rejected') {
            const allPlayersInMatch = [...newData.team1, ...newData.team2];
            for (const playerId of allPlayersInMatch) {
                // Corrected: Use db.doc() for a document reference
                const userPrivateProfileRef = db.doc(`artifacts/${appIdFromContext}/users/${playerId}/profile/data`);
                const userPrivateProfileSnap = await userPrivateProfileRef.get();

                if (userPrivateProfileSnap.exists && userPrivateProfileSnap.data().fcmToken) {
                    const token = userPrivateProfileSnap.data().fcmToken;
                    const matchDate = newData.slotTimestamp?.toDate();
                    const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
                    const payload = {
                        notification: {
                            title: 'Match Rejected',
                            body: `The match on ${matchDateFormatted} at ${newData.slotTime} was rejected by an admin.`,
                            icon: '/firebase-logo.png'
                        },
                        data: {
                            matchId: change.after.id,
                            status: 'rejected',
                            type: 'match_rejected',
                            click_action: 'FLUTTER_NOTIFICATION_CLICK'
                        }
                    };
                    try {
                        await admin.messaging().sendToDevice(token, payload);
                        console.log(`Notification sent to ${playerId} for rejected match.`);
                    } catch (error) {
                        console.error(`Failed to send notification to ${playerId}:`, error);
                    }
                }
            }
        }
        return null;
    });
/**
 * Helper function to check if a user has an 'admin' role in their public profile.
 * @param {string} userId The UID of the user to check.
 * @param {string} appId The application ID.
 * @returns {Promise<boolean>} True if the user is an admin, false otherwise.
 */
async function checkIfAdmin(userId, appId) {
    const userPublicProfileRef = db.doc(`artifacts/${appId}/public/data/users/${userId}`);
    const docSnap = await userPublicProfileRef.get();
    return docSnap.exists && docSnap.data().role === 'admin';
}

// Callable Cloud Function: Create Match
exports.createMatch = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to create a match.');
    }

    const userId = context.auth.uid; // The creator of the match
    const { appId, slotDate, slotTime, gameType, team1Players, team2Players, scoreTeam1, scoreTeam2 } = data;

    if (!appId || !slotDate || !slotTime || !gameType || !Array.isArray(team1Players) || !Array.isArray(team2Players) || team1Players.length === 0 || team2Players.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required match details (appId, slotDate, slotTime, gameType, teams).');
    }

    if (!team1Players.every(p => p) || !team2Players.every(p => p)) { // Changed to check for truthiness of player UIDs directly
        throw new functions.https.HttpsError('invalid-argument', 'Player UIDs must be valid.');
    }

    // Ensure no duplicate players across teams or within a team
    const allPlayersUids = [...team1Players, ...team2Players];
    const uniquePlayers = new Set(allPlayersUids);
    if (uniquePlayers.size !== allPlayersUids.length) {
        throw new functions.https.HttpsError('invalid-argument', 'Duplicate players detected in match.');
    }

    const newMatch = {
        appId: appId,
        slotTimestamp: admin.firestore.Timestamp.fromDate(new Date(`${slotDate}T${slotTime}:00`)),
        date: slotDate,
        time: slotTime,
        gameType: gameType,
        team1: team1Players, // Now directly passing UIDs
        team2: team2Players, // Now directly passing UIDs
        createdBy: userId,
        status: 'pending_confirmation',
        confirmedBy: [userId], // Creator automatically confirms their participation
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        scores: (scoreTeam1 !== null && typeof scoreTeam1 !== 'undefined' && scoreTeam2 !== null && typeof scoreTeam2 !== 'undefined')
            ? { team1: scoreTeam1, team2: scoreTeam2 }
            : null,
    };

    const matchRef = await db.collection(`artifacts/${appId}/public/data/matches`).add(newMatch);

    const allInvolvedPlayerIds = [...new Set([...team1Players, ...team2Players])]; // UIDs are directly passed
    const recipients = allInvolvedPlayerIds.filter(id => id !== userId);

    for (const playerId of recipients) {
        // Corrected: Use db.doc() for a document reference
        const userPrivateProfileRef = db.doc(`artifacts/${appId}/users/${playerId}/profile/data`);
        const userPrivateProfileSnap = await userPrivateProfileRef.get();

        if (userPrivateProfileSnap.exists && userPrivateProfileSnap.data().fcmToken) {
            const token = userPrivateProfileSnap.data().fcmToken;
            const matchDateFormatted = format(newMatch.slotTimestamp.toDate(), 'MMM dd, yyyy');
            const payload = {
                notification: {
                    title: 'New Match Created!',
                    body: `A match on ${matchDateFormatted} at ${newMatch.time} involving you needs your confirmation!`,
                    icon: '/firebase-logo.png'
                },
                data: {
                    matchId: matchRef.id,
                    status: 'pending_confirmation',
                    type: 'new_match_confirmation_request',
                    click_action: 'FLUTTER_NOTIFICATION_CLICK'
                }
            };
            try {
                await admin.messaging().sendToDevice(token, payload);
                console.log(`Notification sent to ${playerId} for new match pending confirmation.`);
            } catch (error) {
                console.error(`Failed to send notification to ${playerId}:`, error);
            }
        } else {
            console.log(`No FCM token found or profile missing for ${playerId}. Skipping notification for new match.`);
        }
    }

    return { success: true, message: 'Match created successfully!', matchId: matchRef.id };
});

// Callable Cloud Function: Confirm Match (by a player, potentially submitting scores)
exports.confirmMatch = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to confirm a match.');
    }
    const { appId, matchId, scoreTeam1, scoreTeam2 } = data; // scoreTeam1, scoreTeam2 are now optional
    const userId = context.auth.uid;

    if (!matchId || !appId) {
        throw new functions.https.HttpsError('invalid-argument', 'Match ID and App ID are required.');
    }

    const matchRef = db.collection(`artifacts/${appId}/public/data/matches`).doc(matchId);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found.');
    }

    const matchData = matchDoc.data();

    if (matchData.status !== 'pending_confirmation' && matchData.status !== 'awaiting_scores') {
        throw new functions.https.HttpsError('failed-precondition', 'Match is not in pending confirmation or awaiting scores status.');
    }

    // Check if the user is one of the involved players and NOT the creator
    const isPlayer = matchData.team1.includes(userId) || matchData.team2.includes(userId);
    const isCreator = matchData.createdBy === userId;

    if (!isPlayer) {
        throw new functions.https.HttpsError('permission-denied', 'You are not a participant in this match.');
    }
    // Creator cannot confirm their own match beyond the initial creation confirmation.
    // Opponent team member confirms.
    if (isCreator && !matchData.confirmedBy.includes(userId)) {
        // This case should ideally not happen if creator is already in confirmedBy
        // but adding it for robustness if logic changes elsewhere.
        // It means creator is confirming for the first time
        // This won't directly confirm the match to 'confirmed' unless it's a 1-player match (which it isn't)
        // or a special rule. Stick to opponent confirmation for full transition.
        console.log(`Creator ${userId} is confirming own match ${matchId}.`);
    } else if (isCreator && matchData.confirmedBy.includes(userId)) {
        // Creator already confirmed at creation. Cannot confirm again.
        throw new functions.https.HttpsError('failed-precondition', 'You are the creator and have already confirmed this match.');
    }

    // Prevent duplicate confirmations by the *same* user (e.g., if an opponent tries to confirm twice)
    if (matchData.confirmedBy && matchData.confirmedBy.includes(userId)) {
        throw new functions.https.HttpsError('already-exists', 'You have already confirmed this match.');
    }


    const updatedFields = {};
    let newStatus = matchData.status;

    // Logic for score submission by player if scores are missing and valid scores are provided in the call
    const scoresProvidedInCall = (scoreTeam1 !== null && typeof scoreTeam1 !== 'undefined' && scoreTeam2 !== null && typeof scoreTeam2 !== 'undefined');
    const matchHasExistingScores = (matchData.scores?.team1 !== null && typeof matchData.scores?.team1 !== 'undefined' &&
                                    matchData.scores?.team2 !== null && typeof matchData.scores?.team2 !== 'undefined');

    if (scoresProvidedInCall) {
        if (typeof scoreTeam1 !== 'number' || typeof scoreTeam2 !== 'number' || scoreTeam1 < 0 || scoreTeam2 < 0 || scoreTeam1 === scoreTeam2) {
            throw new functions.https.HttpsError('invalid-argument', 'Invalid scores provided. Scores must be non-negative numbers and not equal.');
        }
        updatedFields.scores = { team1: scoreTeam1, team2: scoreTeam2 };
        updatedFields.submittedBy = userId; // Mark who submitted scores
        updatedFields.submittedAt = FieldValue.serverTimestamp();
        // If scores are submitted, regardless of previous status, it should move to confirmed
        newStatus = 'confirmed';
    } else if (!matchHasExistingScores && !scoresProvidedInCall) {
        // If no scores are in the match doc and no scores are provided in this call, require scores.
        throw new functions.https.HttpsError('failed-precondition', 'Scores must be provided to confirm this match if not already present.');
    }


    // Add the current user to confirmedBy array
    updatedFields.confirmedBy = FieldValue.arrayUnion(userId);
    updatedFields.lastUpdated = FieldValue.serverTimestamp();

    // Determine if all required confirmations (including at least one opponent) are met
    // The match is confirmed if scores are present (either pre-existing or just submitted)
    // AND at least one player from the *opposing* team has confirmed.
    const allPlayerIds = [...matchData.team1, ...matchData.team2];
    const opponentOfCreator = allPlayerIds.filter(uid => uid !== matchData.createdBy);

    // Filter confirmedBy to only include actual players in the match
    const currentConfirmedPlayers = [...(matchData.confirmedBy || []), userId].filter(id => allPlayerIds.includes(id));
    const uniqueCurrentConfirmedPlayers = [...new Set(currentConfirmedPlayers)];

    const opponentConfirmationsCount = uniqueCurrentConfirmedPlayers.filter(id => opponentOfCreator.includes(id)).length;


    // Rule: Match is confirmed if scores are present AND at least one opponent player has confirmed.
    if ((matchHasExistingScores || scoresProvidedInCall) && opponentConfirmationsCount >= 1) {
        newStatus = 'confirmed';
    } else if (!(matchHasExistingScores || scoresProvidedInCall) && opponentConfirmationsCount >= 1) {
        // If scores are *not* yet present, but an opponent confirmed, the status remains 'awaiting_scores'
        // until a player submits them. This is the explicit 'awaiting_scores' state.
        newStatus = 'awaiting_scores';
    }


    updatedFields.status = newStatus;


    await matchRef.update(updatedFields);

    console.log(`Match ${matchId} confirmed by ${userId}. New status: ${newStatus}`);
    return { success: true, message: 'Match confirmed successfully!', newStatus: newStatus };
});


// Callable Cloud Function: Reject Match (Admin only, existing logic remains largely same)
exports.rejectMatch = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Only authenticated users can reject matches.');
    }

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("rejectMatch: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const userId = context.auth.uid;
    const { matchId } = data;

    if (!matchId) {
        throw new functions.https.HttpsError('invalid-argument', 'Match ID is required.');
    }

    // Ensure only admins can reject
    const isAdmin = await checkIfAdmin(userId, effectiveAppId);
    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can reject matches.');
    }

    const matchRef = db.doc(`artifacts/${effectiveAppId}/public/data/matches/${matchId}`);
    try {
        await matchRef.update({
            status: 'rejected',
            rejectedBy: userId,
            rejectedAt: FieldValue.serverTimestamp() // Using FieldValue directly
        });
        return { success: true, message: 'Match rejected successfully.' };
    } catch (error) {
        console.error("Error in rejectMatch callable:", error);
        throw new functions.https.HttpsError('internal', 'Failed to reject match.', error.message);
    }
});

// NEW Callable Cloud Function: Admin Update Match (replaces submitMatchScore)
// Allows admin to update any match details, including scores and status, at any time.
exports.adminUpdateMatch = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Only authenticated users can update matches via admin function.');
    }

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("adminUpdateMatch: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const userId = context.auth.uid;
    const { matchId, updates } = data; // 'updates' object can contain any fields to be updated

    if (!matchId || !updates || typeof updates !== 'object') {
        throw new functions.https.HttpsError('invalid-argument', 'Match ID and updates object are required.');
    }

    // Ensure only admins can use this function
    const isAdmin = await checkIfAdmin(userId, effectiveAppId);
    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can update matches.');
    }

    const matchRef = db.doc(`artifacts/${effectiveAppId}/public/data/matches/${matchId}`);
    try {
        await matchRef.update({
            ...updates,
            lastUpdatedByAdmin: userId,
            lastAdminUpdateAt: FieldValue.serverTimestamp()
        });
        return { success: true, message: 'Match updated successfully by admin.' };
    } catch (error) {
        console.error("Error in adminUpdateMatch callable:", error);
        throw new functions.https.HttpsError('internal', 'Failed to update match by admin.', error.message);
    }
});

// Callable Cloud Function: Book Slot
exports.bookSlot = functions.https.onCall(async (data, context) => {
    functions.logger.info("bookSlot function called.", data, context.auth);
    if (!context.auth) {
        functions.logger.warn("bookSlot: User not authenticated.");
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to book a slot.');
    }
    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("bookSlot: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }
    const userId = context.auth.uid;
    const slotId = data.slotId;
    if (!slotId) {
        functions.logger.warn(`bookSlot: Missing slotId for user ${userId}.`);
        throw new functions.https.HttpsError('invalid-argument', 'Slot ID is required.');
    }
    const slotRef = db.doc(`artifacts/${effectiveAppId}/public/data/slots/${slotId}`);
    const privateProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${userId}/profile/data`);
    const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`);
    const appSettingsRef = db.doc(`artifacts/${effectiveAppId}/public/data/appSettings/settings`); // Ensure appSettingsRef is defined
    return db.runTransaction(async (transaction) => {
        // --- ALL READS FIRST ---
        const slotDoc = await transaction.get(slotRef);
        const privateProfileDoc = await transaction.get(privateProfileRef);
        const publicUserDoc = await transaction.get(publicUserRef);
        const appSettingsDoc = await transaction.get(appSettingsRef); // Read app settings here
        if (!slotDoc.exists) {
            functions.logger.warn(`bookSlot: Slot ${slotId} does not exist.`);
            throw new functions.https.HttpsError('not-found', 'Slot not found.');
        }
        const slotData = slotDoc.data();
        if (!privateProfileDoc.exists) {
            functions.logger.warn(`bookSlot: User private profile not found for ${userId}.`);
            throw new functions.https.HttpsError('not-found', 'User profile not found.');
        }
        const userProfileData = privateProfileDoc.data();
        if (!appSettingsDoc.exists) {
            functions.logger.error("bookSlot: App settings document not found.");
            throw new functions.https.HttpsError('internal', 'App settings not configured, cannot determine booking cost.');
        }
        const appSettings = appSettingsDoc.data();
        const slotBookingCost = appSettings.slotBookingCost || 4; // Use 4 EUR as per previous discussions
        const minBalanceForBooking = appSettings.minBalanceForBooking || 3; // Default to 3 if not set
        if (!slotData.available && !slotData.isBooked) { // Slot is full or not available for direct booking, add to waitlist
            const waitlistRef = db.collection(`artifacts/${effectiveAppId}/public/data/slots/${slotId}/waitlist`);
            const waitlistSnapshot = await transaction.get(waitlistRef.orderBy('timestampAdded', 'asc'));
            const waitlistSize = waitlistSnapshot.size;
            const userOnWaitlist = waitlistSnapshot.docs.find(doc => doc.id === userId);
            if (userOnWaitlist) {
                functions.logger.warn(`bookSlot: User ${userId} is already on waitlist for slot ${slotId}.`);
                throw new functions.https.HttpsError('already-exists', 'You are already on the waitlist for this slot.');
            }
            transaction.set(db.doc(`artifacts/${effectiveAppId}/public/data/slots/${slotId}/waitlist/${userId}`), { userId: userId, timestampAdded: FieldValue.serverTimestamp(), });
            functions.logger.info(`bookSlot: User ${userId} added to waitlist for slot ${slotId}. Waitlist position: ${waitlistSize + 1}.`);
            return { success: true, message: 'Slot is full. You have been added to the waiting list.', waitlistPosition: waitlistSize + 1 };
        }
        if (userProfileData.balance < minBalanceForBooking) { // Use minBalanceForBooking from settings
            functions.logger.warn(`bookSlot: User ${userId} has insufficient balance. Current: ${userProfileData.balance}, Required: ${minBalanceForBooking}.`);
            throw new functions.https.HttpsError('failed-precondition', `Insufficient balance. Required: ${minBalanceForBooking} EUR.`);
        }
        if (slotData.isBooked) { // Check if already booked
            functions.logger.warn(`bookSlot: Slot ${slotId} is already booked by ${slotData.bookedBy}.`);
            throw new functions.https.HttpsError('failed-precondition', 'This slot is already booked.');
        }
        if (!slotData.available) { // Check if available flag is false
            functions.logger.warn(`bookSlot: Slot ${slotId} is not marked as available.`);
            throw new functions.https.HttpsError('failed-precondition', 'This slot is not available for booking.');
        }

        // Check for double booking (user already has a slot at this time)
        const userBookedSlotsQuery = db.collection(`artifacts/${effectiveAppId}/public/data/slots`).where('bookedBy', '==', userId).where('timestamp', '==', slotData.timestamp);
        const userBookedSlotsSnapshot = await transaction.get(userBookedSlotsQuery);
        if (!userBookedSlotsSnapshot.empty) {
            functions.logger.warn(`bookSlot: User ${userId} already has a slot booked at this time.`);
            throw new functions.https.HttpsError('failed-precondition', 'You already have a slot booked at this time.');
        }

        // Deduct slot cost from user's balance
        transaction.update(privateProfileRef, {
            balance: FieldValue.increment(-slotBookingCost),
            hasMadeFirstBooking: true // Mark that user has made their first booking
        });
        transaction.update(publicUserRef, {
            balance: FieldValue.increment(-slotBookingCost)
        });

        // Book the slot
        transaction.update(slotRef, {
            isBooked: true,
            bookedBy: userId,
            available: false, // Mark as unavailable once booked
            bookedAt: FieldValue.serverTimestamp()
        });

        // Record the booking transaction
        recordTransaction(userId, effectiveAppId, -slotBookingCost, 'booking', `Booked slot for ${format(slotData.timestamp.toDate(), 'MMM dd, yyyy')} at ${slotData.time}`, db, transaction, slotId);

        // Check waiting list after booking to see if someone needs to be notified
        const waitingListRef = db.collection(`artifacts/${effectiveAppId}/public/data/slots/${slotId}/waitlist`);
        const waitlistSnapshot = await transaction.get(waitingListRef.orderBy('timestampAdded', 'asc').limit(1));
        if (!waitlistSnapshot.empty) {
            const nextInLine = waitlistSnapshot.docs[0].data().userId;
            functions.logger.info(`bookSlot: Slot ${slotId} booked. Next in line on waitlist: ${nextInLine}`);
            return { success: true, message: 'Slot booked successfully!', nextInLine: nextInLine, slotBooked: true };
        }

        functions.logger.info(`bookSlot: Slot ${slotId} booked by user ${userId}. Balance updated.`);
        return { success: true, message: 'Slot booked successfully!', slotBooked: true };
    }).catch(error => {
        functions.logger.error("bookSlot transaction failed:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to book slot.', error.message);
    });
});

// Callable Cloud Function: Cancel Slot
exports.cancelSlot = functions.https.onCall(async (data, context) => {
    functions.logger.info("cancelSlot function called.", data, context.auth);
    if (!context.auth) {
        functions.logger.warn("cancelSlot: User not authenticated.");
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to cancel a slot.');
    }

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("cancelSlot: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const userId = context.auth.uid;
    const { slotId, slotTimestamp } = data; // Receive slotTimestamp from client

    if (!slotId || !slotTimestamp) {
        functions.logger.warn(`cancelSlot: Missing slotId or slotTimestamp for user ${userId}.`);
        throw new functions.https.HttpsError('invalid-argument', 'Slot ID and timestamp are required.');
    }

    const slotRef = db.doc(`artifacts/${effectiveAppId}/public/data/slots/${slotId}`);
    const privateProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${userId}/profile/data`);
    const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`);
    const appSettingsRef = db.doc(`artifacts/${effectiveAppId}/public/data/appSettings/settings`);

    return db.runTransaction(async (transaction) => {
        // --- ALL READS FIRST ---
        const slotDoc = await transaction.get(slotRef);
        const privateProfileDoc = await transaction.get(privateProfileRef);
        const appSettingsDoc = await transaction.get(appSettingsRef);

        if (!slotDoc.exists) {
            functions.logger.warn(`cancelSlot: Slot ${slotId} does not exist.`);
            throw new functions.https.HttpsError('not-found', 'Slot not found.');
        }
        const slotData = slotDoc.data();

        if (slotData.bookedBy !== userId) {
            functions.logger.warn(`cancelSlot: User ${userId} is not the one who booked slot ${slotId}. Booked by: ${slotData.bookedBy}.`);
            throw new functions.https.HttpsError('permission-denied', 'You can only cancel slots you have booked.');
        }

        if (!slotData.isBooked) {
            functions.logger.warn(`cancelSlot: Slot ${slotId} is not currently marked as booked.`);
            throw new functions.https.HttpsError('failed-precondition', 'This slot is not currently booked.');
        }

        if (!privateProfileDoc.exists) {
            functions.logger.warn(`cancelSlot: User private profile not found for ${userId}.`);
            throw new functions.https.HttpsError('not-found', 'User profile not found.');
        }
        const userProfileData = privateProfileDoc.data();

        if (!appSettingsDoc.exists) {
            functions.logger.error("cancelSlot: App settings document not found.");
            throw new functions.https.HttpsError('internal', 'App settings not configured, cannot determine cancellation policy.');
        }
        const appSettings = appSettingsDoc.data();
        const slotBookingCost = appSettings.slotBookingCost || 4; // Default cost
        const cancellationDeadlineHours = appSettings.cancellationDeadlineHours || 24; // Default to 24 hours

        const now = new Date();
        const slotStart = slotData.timestamp.toDate(); // Use slotData.timestamp from Firestore
        const timeUntilSlotStartMs = slotStart.getTime() - now.getTime();
        const timeUntilSlotStartHours = timeUntilSlotStartMs / (1000 * 60 * 60);

        let refundAmount = 0;
        let transactionType = 'cancellation_no_refund';
        let transactionDescription = `Cancelled slot on ${format(slotStart, 'MMM dd, yyyy')} at ${slotData.time} (no refund)`;

        if (timeUntilSlotStartHours >= cancellationDeadlineHours) {
            // Full refund
            refundAmount = slotBookingCost;
            transactionType = 'cancellation_refund';
            transactionDescription = `Refund for cancelled slot on ${format(slotStart, 'MMM dd, yyyy')} at ${slotData.time}`;

            transaction.update(privateProfileRef, {
                balance: FieldValue.increment(refundAmount)
            });
            transaction.update(publicUserRef, {
                balance: FieldValue.increment(refundAmount)
            });
        }
        // If cancellation is within deadline, no explicit balance change is needed
        // as the user already paid and we are not refunding.

        // Record the cancellation transaction
        recordTransaction(userId, effectiveAppId, refundAmount, transactionType, transactionDescription, db, transaction, slotId);


        // Clear bookedBy and set isBooked to false
        transaction.update(slotRef, {
            isBooked: false,
            bookedBy: FieldValue.delete(), // Remove the bookedBy field
            available: true, // Make the slot available again
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: userId
        });

        // Check if there's a waiting list and notify the next person
        const waitingListRef = db.collection(`artifacts/${effectiveAppId}/public/data/slots/${slotId}/waitlist`);
        const waitlistSnapshot = await transaction.get(waitingListRef.orderBy('timestampAdded', 'asc').limit(1));

        if (!waitlistSnapshot.empty) {
            const nextInLineDoc = waitlistSnapshot.docs[0];
            const nextInLineUserId = nextInLineDoc.data().userId;

            // Remove the user from the waiting list
            transaction.delete(nextInLineDoc.ref);

            // Fetch the FcmToken of the next person in line
            const nextInLinePrivateProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${nextInLineUserId}/profile/data`);
            const nextInLinePrivateProfileSnap = await transaction.get(nextInLinePrivateProfileRef);

            if (nextInLinePrivateProfileSnap.exists && nextInLinePrivateProfileSnap.data().fcmToken) {
                const fcmToken = nextInLinePrivateProfileSnap.data().fcmToken;
                const slotDateFormatted = format(slotStart, 'MMM dd, yyyy');
                const payload = {
                    notification: {
                        title: 'Slot Available!',
                        body: `A slot on ${slotDateFormatted} at ${slotData.time} is now available for you!`,
                        icon: '/firebase-logo.png'
                    },
                    data: {
                        slotId: slotId,
                        type: 'slot_available_from_waitlist',
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                };
                try {
                    await admin.messaging().sendToDevice(fcmToken, payload);
                    functions.logger.info(`Notification sent to ${nextInLineUserId} for available slot ${slotId}.`);
                } catch (error) {
                    functions.logger.error(`Failed to send notification to ${nextInLineUserId}:`, error);
                }
            } else {
                functions.logger.info(`No FCM token found for ${nextInLineUserId}. Skipping notification.`);
            }

            functions.logger.info(`cancelSlot: Slot ${slotId} cancelled by ${userId}. Refunded ${refundAmount} EUR. Next in line ${nextInLineUserId} removed from waitlist.`);
            return { success: true, message: 'Slot cancelled successfully. Next person on waitlist notified.', refundAmount: refundAmount, nextInLineNotified: true };
        }

        functions.logger.info(`cancelSlot: Slot ${slotId} cancelled by ${userId}. Refunded ${refundAmount} EUR. No one on waitlist.`);
        return { success: true, message: 'Slot cancelled successfully. No one on waitlist.', refundAmount: refundAmount, nextInLineNotified: false };

    }).catch(error => {
        functions.logger.error("cancelSlot transaction failed:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to cancel slot.', error.message);
    });
});


// Cloud Function to initialize user profile on creation
// This function creates a corresponding document in the private 'users' subcollection.
exports.initializeUserProfile = functions.firestore
    .document('artifacts/{appId}/public/data/users/{userId}')
    .onCreate(async (snap, context) => {
        const { appId, userId } = context.params;
        const userData = snap.data();
        const initialRegistrationCost = 4; // This cost is now consistently applied here

        const userPublicProfileRef = snap.ref;
        const userPrivateProfileRef = db.doc(`artifacts/${appId}/users/${userId}/profile/data`);

        const batch = db.batch();

        // Check if a balance already exists (e.g., from sample_data.js)
        const currentBalance = userData.balance || 0;
        const newBalance = currentBalance - initialRegistrationCost;

        // Update both public and private profiles with the new balance
        batch.update(userPublicProfileRef, {
            balance: newBalance,
            registrationFeePending: 0 // Clear any pending fee
        });
        batch.set(userPrivateProfileRef, {
            balance: newBalance,
            email: userData.email, // Copy email to private profile
            name: userData.name, // Copy name to private profile
            fcmToken: null, // Initialize FCM token as null
            registrationFeePending: 0, // Ensure this is set to 0 as it's handled here
            hasMadeFirstBooking: false, // New field
            // Add other initial private fields as needed
        }, { merge: true }); // Use merge true to avoid overwriting existing fields if document exists

        // Record the transaction for initial registration fee
        recordTransaction(userId, appId, -initialRegistrationCost, 'registration_fee', 'Initial registration fee upon profile creation', db, batch);

        try {
            await batch.commit();
            console.log(`Initial balance of ${newBalance} EUR set for user ${userId} and registration fee recorded.`);
            return null;
        } catch (error) {
            console.error(`Error initializing user profile for ${userId}:`, error);
            return null;
        }
    });

// Callable Cloud Function: Process Top-Up
exports.processTopUp = functions.https.onCall(async (data, context) => {
    functions.logger.info("processTopUp function called.", data, context.auth);
    if (!context.auth) {
        functions.logger.warn("processTopUp: User not authenticated.");
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to top up balance.');
    }

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("processTopUp: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const userId = context.auth.uid;
    const { amount } = data; // amount to top up

    if (typeof amount !== 'number' || amount <= 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid top-up amount.');
    }

    const userProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${userId}/profile/data`);
    const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`);

    return db.runTransaction(async (transaction) => {
        const userProfileDoc = await transaction.get(userProfileRef);
        const publicUserDoc = await transaction.get(publicUserRef);

        if (!userProfileDoc.exists || !publicUserDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User profile not found.');
        }

        let currentBalance = userProfileDoc.data().balance || 0;
        let registrationFeePending = userProfileDoc.data().registrationFeePending || 0;

        let newBalance = currentBalance + amount;
        let registrationFeeDeducted = 0;

        // If a registration fee is pending, deduct it from the top-up
        if (registrationFeePending > 0) {
            if (newBalance >= 0) { // If the balance becomes non-negative after top-up
                registrationFeeDeducted = registrationFeePending; // Deduct the full pending fee
                newBalance -= registrationFeePending;
                transaction.update(userProfileRef, { registrationFeePending: 0 }); // Clear pending fee
            } else { // Top-up is not enough to cover full fee, reduce pending fee by top-up amount
                registrationFeeDeducted = amount;
                transaction.update(userProfileRef, { registrationFeePending: FieldValue.increment(-amount) });
                newBalance = 0; // Balance becomes 0 as all top-up went to fee (or remains negative if fee was larger)
            }
        }
        
        // Update balance on both private and public profiles
        transaction.update(userProfileRef, { balance: newBalance });
        transaction.update(publicUserRef, { balance: newBalance }); // Ensure public profile is also updated

        // Record the top-up transaction
        recordTransaction(userId, effectiveAppId, amount, 'top_up', `Top-up of ${amount} EUR`, db, transaction);

        // If a registration fee was deducted from this top-up, record that as a separate transaction
        if (registrationFeeDeducted > 0) {
            recordTransaction(userId, effectiveAppId, -registrationFeeDeducted, 'registration_fee_deducted', `Registration fee of ${registrationFeeDeducted} EUR deducted from top-up`, db, transaction);
        }

        functions.logger.info(`processTopUp: User ${userId} topped up ${amount} EUR. New balance: ${newBalance}. Registration fee deducted: ${registrationFeeDeducted}.`);
        return { success: true, newBalance: newBalance };
    }).catch(error => {
        functions.logger.error("processTopUp transaction failed:", error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to process top-up.', error.message);
    });
});

// Callable Cloud Function: Register FCM Token
exports.registerFcmToken = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to register FCM token.');
    }
    const userId = context.auth.uid;
    const { token, appId } = data;

    if (!token || !appId) {
        throw new functions.https.HttpsError('invalid-argument', 'FCM token and App ID are required.');
    }

    const userPrivateProfileRef = db.doc(`artifacts/${appId}/users/${userId}/profile/data`);

    try {
        await userPrivateProfileRef.update({ fcmToken: token });
        console.log(`FCM token registered for user ${userId}.`);
        return { success: true };
    } catch (error) {
        console.error(`Error registering FCM token for user ${userId}:`, error);
        throw new functions.https.HttpsError('internal', 'Failed to register FCM token.', error.message);
    }
});

// Callable Cloud Function: Unregister FCM Token
exports.unregisterFcmToken = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to unregister FCM token.');
    }
    const userId = context.auth.uid;
    const { appId } = data; // App ID is needed to locate the correct private profile

    if (!appId) {
        throw new functions.https.HttpsError('invalid-argument', 'App ID is required.');
    }

    const userPrivateProfileRef = db.doc(`artifacts/${appId}/users/${userId}/profile/data`);

    try {
        await userPrivateProfileRef.update({ fcmToken: null }); // Set to null instead of deleting to keep the field
        console.log(`FCM token unregistered for user ${userId}.`);
        return { success: true };
    } catch (error) {
        console.error(`Error unregistering FCM token for user ${userId}:`, error);
        throw new functions.https.HttpsError('internal', 'Failed to unregister FCM token.', error.message);
    }
});

// Callable Cloud Function: Request Cancellation of Match (Player)
// Players can request match cancellation. This sets a 'requested_cancellation' status
// and notifies admins or other players for approval.
exports.requestMatchCancellation = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to request a match cancellation.');
    }

    const { appId, matchId } = data;
    const userId = context.auth.uid;

    if (!matchId || !appId) {
        throw new functions.https.HttpsError('invalid-argument', 'Match ID and App ID are required.');
    }

    const matchRef = db.doc(`artifacts/${appId}/public/data/matches/${matchId}`);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found.');
    }

    const matchData = matchDoc.data();

    // Ensure the match is in a cancellable status (e.g., 'confirmed', 'pending_score')
    // and not already 'cancelled', 'rejected', or 'requested_cancellation'
    const nonCancellableStatuses = ['cancelled', 'rejected', 'requested_cancellation'];
    if (nonCancellableStatuses.includes(matchData.status)) {
        throw new functions.https.HttpsError('failed-precondition', `Match is in status '${matchData.status}' and cannot be cancelled.`);
    }

    // Ensure the user is part of the match
    const isPlayerInMatch = [...matchData.team1, ...matchData.team2].includes(userId);
    if (!isPlayerInMatch) {
        throw new functions.https.HttpsError('permission-denied', 'You are not a player in this match.');
    }

    // Update match status to 'requested_cancellation' and store who requested it
    await matchRef.update({
        status: 'requested_cancellation',
        cancellationRequestedBy: userId,
        cancellationRequestedAt: FieldValue.serverTimestamp(),
        // Potentially add a reason for cancellation if passed from client
    });

    // Notify admins or other players for approval (similar to 'pending_score' notification)
    const adminUsersQuery = db.collection(`artifacts/${appId}/public/data/users`).where('role', '==', 'admin');
    const adminSnaps = await adminUsersQuery.get();
    const requestingPlayerProfile = await db.doc(`artifacts/${appId}/public/data/users/${userId}`).get();
    const requestingPlayerName = requestingPlayerProfile.data()?.name || 'A player';

    for (const adminDoc of adminSnaps.docs) {
        const adminProfileSnap = await db.doc(`artifacts/${appId}/users/${adminDoc.id}/profile/data`).get();
        const fcmToken = adminProfileSnap.data()?.fcmToken;
        if (fcmToken) {
            const matchDate = matchData.slotTimestamp?.toDate();
            const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
            const payload = {
                notification: {
                    title: 'Match Cancellation Request',
                    body: `${requestingPlayerName} has requested to cancel the match on ${matchDateFormatted} at ${matchData.slotTime}.`,
                    icon: '/firebase-logo.png'
                },
                data: {
                    matchId: matchId,
                    type: 'match_cancellation_request',
                    click_action: 'FLUTTER_NOTIFICATION_CLICK'
                }
            };
            try {
                await admin.messaging().sendToDevice(fcmToken, payload);
                console.log(`Notification sent to admin ${adminDoc.id} for match cancellation request.`);
            } catch (error) {
                console.error(`Failed to send notification to admin ${adminDoc.id}:`, error);
            }
        }
    }

    return { success: true, message: 'Match cancellation request sent to admins for review.' };
});

// Callable Cloud Function: Admin Approve/Reject Match Cancellation
// Admin can approve or reject a match cancellation request.
exports.adminProcessMatchCancellation = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Admin must be logged in to process cancellation requests.');
    }

    const { appId, matchId, action } = data; // 'approve' or 'reject'
    const adminId = context.auth.uid;

    if (!matchId || !appId || !['approve', 'reject'].includes(action)) {
        throw new functions.https.HttpsError('invalid-argument', 'Match ID, App ID, and a valid action (approve/reject) are required.');
    }

    // Check if user is an admin
    const isAdmin = await checkIfAdmin(adminId, appId);
    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can process match cancellation requests.');
    }

    const matchRef = db.doc(`artifacts/${appId}/public/data/matches/${matchId}`);
    const matchDoc = await matchRef.get();

    if (!matchDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Match not found.');
    }

    const matchData = matchDoc.data();

    if (matchData.status !== 'requested_cancellation') {
        throw new functions.https.HttpsError('failed-precondition', `Match is in status '${matchData.status}' and not awaiting cancellation processing.`);
    }

    const batch = db.batch();
    const allPlayersInMatch = [...matchData.team1, ...matchData.team2];

    if (action === 'approve') {
        // Mark match as cancelled
        batch.update(matchRef, {
            status: 'cancelled',
            cancelledByAdmin: adminId,
            cancelledAt: FieldValue.serverTimestamp(),
            cancellationApprovedAt: FieldValue.serverTimestamp(),
            cancellationProcessedBy: adminId,
            // Optionally, refund players. This depends on your policy (e.g., full refund for admin-approved cancellations)
            // For now, let's assume no automatic refund via this path. If a refund is desired,
            // the `cancelSlot` callable function should be adapted or a new refund mechanism created.
        });

        // Notify all players that the match has been cancelled
        for (const playerId of allPlayersInMatch) {
            const userPrivateProfileRef = db.doc(`artifacts/${appId}/users/${playerId}/profile/data`);
            const userPrivateProfileSnap = await userPrivateProfileRef.get();

            if (userPrivateProfileSnap.exists && userPrivateProfileSnap.data().fcmToken) {
                const token = userPrivateProfileSnap.data().fcmToken;
                const matchDate = matchData.slotTimestamp?.toDate();
                const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
                const payload = {
                    notification: {
                        title: 'Match Cancelled!',
                        body: `The match on ${matchDateFormatted} at ${matchData.slotTime} has been cancelled by an admin.`,
                        icon: '/firebase-logo.png'
                    },
                    data: {
                        matchId: matchId,
                        status: 'cancelled',
                        type: 'match_cancelled_admin',
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                };
                try {
                    await admin.messaging().sendToDevice(token, payload);
                    console.log(`Notification sent to ${playerId} for admin-approved match cancellation.`);
                } catch (error) {
                    console.error(`Failed to send notification to ${playerId}:`, error);
                }
            }
        }
        console.log(`Match ${matchId} cancellation approved by admin ${adminId}.`);

    } else if (action === 'reject') {
        // Revert status to its previous state, or a 'cancellation_rejected' state
        // Here, we'll revert it to 'confirmed' if it was, or 'pending_score'
        let previousStatus = 'confirmed'; // Default assumption
        if (matchData.scores === null || typeof matchData.scores === 'undefined') {
            previousStatus = 'pending_score';
        }

        batch.update(matchRef, {
            status: previousStatus, // Revert to a playable state
            cancellationRejectedBy: adminId,
            cancellationRejectedAt: FieldValue.serverTimestamp(),
            cancellationProcessedBy: adminId,
            cancellationRequestedBy: FieldValue.delete(), // Clear requestor
            cancellationRequestedAt: FieldValue.delete(), // Clear request timestamp
        });

        // Notify all players that the cancellation request was rejected
        for (const playerId of allPlayersInMatch) {
            const userPrivateProfileRef = db.doc(`artifacts/${appId}/users/${playerId}/profile/data`);
            const userPrivateProfileSnap = await userPrivateProfileRef.get();

            if (userPrivateProfileSnap.exists && userPrivateProfileSnap.data().fcmToken) {
                const token = userPrivateProfileSnap.data().fcmToken;
                const matchDate = matchData.slotTimestamp?.toDate();
                const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
                const payload = {
                    notification: {
                        title: 'Cancellation Request Rejected',
                        body: `The cancellation request for the match on ${matchDateFormatted} at ${matchData.slotTime} was rejected by an admin.`,
                        icon: '/firebase-logo.png'
                    },
                    data: {
                        matchId: matchId,
                        status: previousStatus,
                        type: 'match_cancellation_rejected_admin',
                        click_action: 'FLUTTER_NOTIFICATION_CLICK'
                    }
                };
                try {
                    await admin.messaging().sendToDevice(token, payload);
                    console.log(`Notification sent to ${playerId} for admin-rejected match cancellation.`);
                } catch (error) {
                    console.error(`Failed to send notification to ${playerId}:`, error);
                }
            }
        }
        console.log(`Match ${matchId} cancellation rejected by admin ${adminId}. Status reverted to ${previousStatus}.`);
    }

    try {
        await batch.commit();
        return { success: true, message: `Match cancellation ${action}ed successfully.` };
    } catch (error) {
        console.error("Error in adminProcessMatchCancellation callable:", error);
        throw new functions.https.HttpsError('internal', `Failed to ${action} match cancellation.`, error.message);
    }
});