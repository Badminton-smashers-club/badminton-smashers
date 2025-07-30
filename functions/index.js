// functions/index.js

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const path = require('path');
const { format, isSameDay, startOfDay } = require('date-fns');

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

        if (newData.status === 'confirmed' && previousData.status !== 'confirmed') {
            const team1Uids = newData.team1;
            const team2Uids = newData.team2;
            const score1 = newData.scores?.team1;
            const score2 = newData.scores?.team2;

            if (score1 === null || score2 === null || typeof score1 === 'undefined' || typeof score2 === 'undefined') {
                console.warn(`Match ${matchId} confirmed but scores are null/undefined. Skipping Elo update.`);
                return null;
            }

            const batch = db.batch();
            const allPlayerUids = [...new Set([...team1Uids, ...team2Uids])];

            const playerProfiles = {};
            for (const uid of allPlayerUids) {
                const userProfileRef = db.doc(`artifacts/${appIdFromContext}/public/data/users/${uid}`);
                const docSnap = await userProfileRef.get();
                if (docSnap.exists) {
                    playerProfiles[uid] = { ...docSnap.data(), ref: userProfileRef };
                } else {
                    console.warn(`User profile not found for UID: ${uid} in public/data/users. Elo update skipped for this player.`);
                    return null;
                }
            }

            const getTeamElo = (uids) => {
                if (uids.length === 0) return 1000;
                return uids.reduce((sum, uid) => sum + (playerProfiles[uid]?.eloRating || 1000), 0) / uids.length;
            };

            const team1AvgElo = getTeamElo(team2Uids);
            const team2AvgElo = getTeamElo(team1Uids);

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

                if (team1Uids.includes(uid)) {
                    newEloChange = calculateEloChange(currentElo, team2AvgElo, outcomeTeam1, gamesPlayed);
                } else {
                    newEloChange = calculateEloChange(currentElo, team1AvgElo, 1 - outcomeTeam1, gamesPlayed);
                }

                const updatedElo = Math.max(100, Math.round(currentElo + newEloChange));
                const updatedGamesPlayed = gamesPlayed + 1;
                const wins = (playerProfiles[uid].wins || 0) + (outcomeTeam1 === 1 ? 1 : 0);
                const losses = (playerProfiles[uid].losses || 0) + (outcomeTeam1 === 0 ? 1 : 0);

                batch.update(playerProfiles[uid].ref, {
                    eloRating: updatedElo,
                    gamesPlayed: updatedGamesPlayed,
                    wins: wins,
                    losses: losses,
                    lastGameDate: FieldValue.serverTimestamp() // Using FieldValue directly
                });
            }

            await batch.commit();
            console.log(`Elo ratings and games played updated for match ${matchId}.`);

            for (const playerId of allPlayerUids) {
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
                            type: 'match_confirmed_scores_submitted'
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
                            type: 'match_confirmation'
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
        } else if (newData.status === 'pending_score' && previousData.status === 'pending_confirmation') {
            const adminUsersQuery = db.collection(`artifacts/${appIdFromContext}/public/data/users`).where('role', '==', 'admin');
            const adminSnaps = await adminUsersQuery.get();
            for (const adminDoc of adminSnaps.docs) {
                const adminProfileSnap = await db.doc(`artifacts/${appIdFromContext}/users/${adminDoc.id}/profile/data`).get();
                const fcmToken = adminProfileSnap.data()?.fcmToken;
                if (fcmToken) {
                    const matchDate = newData.slotTimestamp?.toDate();
                    const matchDateFormatted = matchDate ? format(matchDate, 'MMM dd, yyyy') : 'N/A';
                    const payload = {
                        notification: {
                            title: 'Match Ready for Score Submission',
                            body: `Match on ${matchDateFormatted} at ${newData.slotTime} is ready for scores.`,
                        },
                        data: {
                            matchId: change.after.id,
                            type: 'score_submission_ready'
                        }
                    };
                    try {
                        await admin.messaging().sendToDevice(fcmToken, payload);
                        console.log(`Notification sent to admin ${adminDoc.id} for score submission.`);
                    } catch (error) {
                        console.error(`Failed to send notification to admin ${adminDoc.id}:`, error);
                    }
                }
            }
        } else if (newData.status === 'rejected' && previousData.status !== 'rejected') {
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
                            title: 'Match Rejected',
                            body: `The match on ${matchDateFormatted} at ${newData.slotTime} was rejected by an admin.`,
                            icon: '/firebase-logo.png'
                        },
                        data: {
                            matchId: change.after.id,
                            status: 'rejected',
                            type: 'match_rejected'
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

// Callable Cloud Function: Create Match
exports.createMatch = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Only authenticated users can create matches.');
    }

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("createMatch: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const { slotTimestamp, slotTime, gameType, team1, team2 } = data;
    const userId = context.auth.uid;

    if (!slotTimestamp || !slotTime || !gameType || !Array.isArray(team1) || team1.length === 0 || !Array.isArray(team2) || team2.length === 0) {
        throw new functions.https.HttpsError('invalid-argument', 'Missing required match data or invalid format.');
    }

    const allPlayers = [...team1, ...team2];
    if (!allPlayers.includes(userId)) {
        throw new functions.https.HttpsError('permission-denied', 'You must be one of the players in the match you are creating.');
    }

    for (const playerUid of allPlayers) {
        const playerSnap = await db.doc(`artifacts/${effectiveAppId}/public/data/users/${playerUid}`).get();
        if (!playerSnap.exists) {
            throw new functions.https.HttpsError('not-found', `Player with UID ${playerUid} not found.`);
        }
    }

    const slotDateObj = new Date(slotTimestamp);
    const startOfSelectedDay = Timestamp.fromMillis(startOfDay(slotDateObj).getTime()); // Using Timestamp directly

    const slotQueryRef = db.collection(`artifacts/${effectiveAppId}/public/data/slots`)
        .where('timestamp', '==', startOfSelectedDay)
        .where('time', '==', slotTime)
        .where('bookedBy', '==', userId);

    const slotSnapshot = await slotQueryRef.get();

    let slotDocId = null;
    let existingSlotData = null;
    if (!slotSnapshot.empty) {
        slotSnapshot.forEach(doc => {
            slotDocId = doc.id;
            existingSlotData = doc.data();
        });
    }

    if (!slotDocId || !existingSlotData || !existingSlotData.isBooked || existingSlotData.bookedBy !== userId) {
        throw new functions.https.HttpsError('failed-precondition', 'Selected slot is not booked by you or does not exist. Please book the slot first.');
    }

    try {
        const newMatchRef = await db.collection(`artifacts/${effectiveAppId}/public/data/matches`).add({
            slotTimestamp: existingSlotData.timestamp,
            slotTime: existingSlotData.time,
            gameType: gameType,
            team1: team1,
            team2: team2,
            status: 'pending_confirmation',
            confirmedBy: [userId],
            scores: { team1: null, team2: null },
            createdAt: FieldValue.serverTimestamp(), // Using FieldValue directly
            createdBy: userId,
        });

        return { success: true, message: 'Match created successfully!' };
    } catch (error) {
        console.error("Error in createMatch callable:", error);
        throw new functions.https.HttpsError('internal', 'Failed to create match.', error.message);
    }
});

// Callable Cloud Function: Confirm Match
exports.confirmMatch = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Only authenticated users can confirm matches.');
    }

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("confirmMatch: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const userId = context.auth.uid;
    const { matchId } = data;

    if (!matchId) {
        throw new functions.https.HttpsError('invalid-argument', 'Match ID is required.');
    }

    const matchRef = db.doc(`artifacts/${effectiveAppId}/public/data/matches/${matchId}`);

    try {
        return await db.runTransaction(async (transaction) => {
            const matchSnap = await transaction.get(matchRef);

            if (!matchSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Match not found.');
            }

            const matchData = matchSnap.data();

            if (matchData.status !== 'pending_confirmation') {
                throw new functions.https.HttpsError('failed-precondition', 'Match is not in pending confirmation status.');
            }

            const allPlayersInMatch = [...matchData.team1, ...matchData.team2];
            if (!allPlayersInMatch.includes(userId)) {
                throw new functions.https.HttpsError('permission-denied', 'You are not a player in this match.');
            }

            let confirmedBy = new Set(matchData.confirmedBy || []);
            if (confirmedBy.has(userId)) {
                return { success: true, message: 'You have already confirmed this match.' };
            }

            confirmedBy.add(userId);
            const newConfirmedByArray = Array.from(confirmedBy);

            let newStatus = 'pending_confirmation';

            const adminUserSnap = await db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`).get();
            const isAdmin = adminUserSnap.exists && adminUserSnap.data().role === 'admin';

            const creatorId = matchData.createdBy;
            const creatorIsTeam1 = matchData.team1.includes(creatorId);
            const creatorIsTeam2 = matchData.team2.includes(creatorId);

            let opposingTeamConfirmed = false;
            if (creatorIsTeam1) {
                for (const playerUid of matchData.team2) {
                    if (newConfirmedByArray.includes(playerUid)) {
                        opposingTeamConfirmed = true;
                        break;
                    }
                }
            } else if (creatorIsTeam2) {
                for (const playerUid of matchData.team1) {
                    if (newConfirmedByArray.includes(playerUid)) {
                        opposingTeamConfirmed = true;
                        break;
                    }
                }
            }

            if (isAdmin || opposingTeamConfirmed) {
                newStatus = 'pending_score';
            }

            transaction.update(matchRef, {
                confirmedBy: newConfirmedByArray,
                status: newStatus,
            });

            return { success: true, message: 'Match confirmation updated.' };
        });
    } catch (error) {
        console.error("Error in confirmMatch callable:", error);
        throw new functions.https.HttpsError('internal', 'Failed to confirm match.', error.message);
    }
});

// Callable Cloud Function: Reject Match (Admin only)
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

    const userProfileSnap = await db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`).get();
    if (!userProfileSnap.exists || userProfileSnap.data().role !== 'admin') {
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

// Callable Cloud Function: Submit Match Score (Admin only)
exports.submitMatchScore = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Only authenticated users can submit scores.');
    }

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("submitMatchScore: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const userId = context.auth.uid;
    const { matchId, score1, score2 } = data;

    if (!matchId || typeof score1 !== 'number' || typeof score2 !== 'number' || score1 < 0 || score2 < 0 || score1 === score2) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid score data or match ID. Scores must be non-negative and not equal.');
    }

    const userProfileSnap = await db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`).get();
    if (!userProfileSnap.exists || userProfileSnap.data().role !== 'admin') {
        throw new functions.https.HttpsError('permission-denied', 'Only administrators can submit scores.');
    }

    const matchRef = db.doc(`artifacts/${effectiveAppId}/public/data/matches/${matchId}`);

    try {
        return await db.runTransaction(async (transaction) => {
            const matchSnap = await transaction.get(matchRef);

            if (!matchSnap.exists) {
                throw new functions.https.HttpsError('not-found', 'Match not found.');
            }

            const matchData = matchSnap.data();

            if (matchData.status !== 'pending_score') {
                throw new functions.https.HttpsError('failed-precondition', 'Scores can only be submitted for matches awaiting score submission.');
            }

            transaction.update(matchRef, {
                scores: { team1: score1, team2: score2 },
                status: 'confirmed',
                submittedBy: userId,
                submittedAt: FieldValue.serverTimestamp() // Using FieldValue directly
            });

            return { success: true, message: 'Scores submitted successfully!' };
        });
    } catch (error) {
        console.error("Error in submitMatchScore callable:", error);
        throw new functions.https.HttpsError('internal', 'Failed to submit scores.', error.message);
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
    const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`); // Define ref here

    return db.runTransaction(async (transaction) => {
        // --- ALL READS FIRST ---
        const slotDoc = await transaction.get(slotRef);
        const privateProfileDoc = await transaction.get(privateProfileRef);
        const publicUserDoc = await transaction.get(publicUserRef); // Read publicUserDoc here

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

        if (!slotData.available && !slotData.isBooked) {
            // Slot is full or not available for direct booking, add to waitlist
            const waitlistRef = db.collection(`artifacts/${effectiveAppId}/public/data/slots/${slotId}/waitlist`);
            const waitlistSnapshot = await transaction.get(waitlistRef.orderBy('timestampAdded', 'asc')); // Read existing waitlist
            const waitlistSize = waitlistSnapshot.size;
        
            // Check if user is already on waitlist
            const userOnWaitlist = waitlistSnapshot.docs.find(doc => doc.id === userId);
            if (userOnWaitlist) {
                functions.logger.warn(`bookSlot: User ${userId} is already on waitlist for slot ${slotId}.`);
                throw new functions.https.HttpsError('already-exists', 'You are already on the waitlist for this slot.');
            }
        
            transaction.set(db.doc(`artifacts/${effectiveAppId}/public/data/slots/${slotId}/waitlist/${userId}`), {
                userId: userId,
                timestampAdded: FieldValue.serverTimestamp(),
                // You can optionally store an explicit waitlistOrder, but it's often derived from timestampAdded
            });
        
            functions.logger.info(`bookSlot: User ${userId} added to waitlist for slot ${slotId}. Waitlist position: ${waitlistSize + 1}.`);
            return { success: true, message: 'Slot is full. You have been added to the waiting list.', waitlistPosition: waitlistSize + 1 };
        }
        
        // If slot IS available, proceed with booking and balance deduction as before
        const slotBookingCost = appSettings.slotBookingCost || 4; // Ensure appSettingsDoc is read earlier
        if (userProfileData.balance < slotBookingCost) {
            functions.logger.warn(`bookSlot: User ${userId} has insufficient balance. Current: ${userProfileData.balance}, Required: ${slotBookingCost}`);
            throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance to book this slot.');
        }

        // --- ALL WRITES AFTER ALL READS ---
        transaction.update(slotRef, {
            isBooked: true,
            bookedBy: userId,
            available: false
        });
        functions.logger.info(`bookSlot: Slot ${slotId} booked by ${userId}.`);

        transaction.update(privateProfileRef, {
            balance: FieldValue.increment(-slotBookingCost),
            hasMadeFirstBooking: true
        });
        functions.logger.info(`bookSlot: Balance deducted for ${userId}. New balance: ${userProfileData.balance - slotBookingCost}`);

        if (publicUserDoc.exists) { // Only update if public user doc exists
             transaction.update(publicUserRef, {
                balance: FieldValue.increment(-slotBookingCost)
            });
            functions.logger.info(`bookSlot: Public balance updated for ${userId}.`);
        }

        return { success: true, message: 'Slot booked successfully!' };

    }).catch(error => {
        functions.logger.error(`bookSlot: Transaction failed for slot ${slotId}, user ${userId}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to book slot.', error.message);
    });
});

// --- Cancel Slot Function ---
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
    const slotId = data.slotId;

    if (!slotId) {
        functions.logger.warn(`cancelSlot: Missing slotId for user ${userId}.`);
        throw new functions.https.HttpsError('invalid-argument', 'Slot ID is required.');
    }

    const slotRef = db.doc(`artifacts/${effectiveAppId}/public/data/slots/${slotId}`);
    const privateProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${userId}/profile/data`);
    // Define publicUserRef here as well, so it can be read at the start of the transaction
    const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`);


    return db.runTransaction(async (transaction) => {
        // --- ALL READS FIRST ---
        const slotDoc = await transaction.get(slotRef);
        const privateProfileDoc = await transaction.get(privateProfileRef);
        const appSettingsDoc = await transaction.get(db.doc(`artifacts/${effectiveAppId}/public/data/appSettings/settings`)); // Moved this read to the top
        const publicUserDoc = await transaction.get(publicUserRef); // Read publicUserDoc here as well

        if (!slotDoc.exists) {
            functions.logger.warn(`cancelSlot: Slot ${slotId} does not exist.`);
            throw new functions.https.HttpsError('not-found', 'Slot not found.');
        }

        const slotData = slotDoc.data();

        if (!privateProfileDoc.exists) {
            functions.logger.warn(`cancelSlot: User private profile not found for ${userId}.`);
            throw new functions.https.HttpsError('not-found', 'User profile not found.');
        }
        const userProfileData = privateProfileDoc.data();

        if (!slotData.isBooked || slotData.bookedBy !== userId) {
            functions.logger.warn(`cancelSlot: Slot ${slotId} not booked by ${userId} or not booked at all.`);
            throw new functions.https.HttpsError('failed-precondition', 'Slot is not booked by you or is not currently booked.');
        }

        const now = Timestamp.now().toDate();
        const slotTime = slotData.timestamp.toDate();

        const cancellationDeadlineHours = appSettings.cancellationDeadlineHours || 2;
        const cancellationFee = appSettings.cancellationFee || 0;
        // const slotBookingCost = appSettings.slotBookingCost || 5;
        const appSettings = appSettingsDoc.data(); // appSettingsDoc needs to be read inside transaction
        const slotBookingCost = appSettings.slotBookingCost || 4; // Ensure this is fetched and set to 4

        const deadline = new Date(slotTime.getTime() - (cancellationDeadlineHours * 60 * 60 * 1000));

        let refundAmount = slotBookingCost;
        if (now > deadline) {
            refundAmount -= cancellationFee;
            functions.logger.info(`cancelSlot: Cancellation after deadline. Fee applied: ${cancellationFee}. Refund: ${refundAmount}`);
        } else {
            functions.logger.info(`cancelSlot: Cancellation before deadline. Full refund: ${refundAmount}`);
        }

        // --- ALL WRITES AFTER ALL READS ---
        transaction.update(slotRef, {
            isBooked: false,
            bookedBy: null,
            available: true
        });
        functions.logger.info(`cancelSlot: Slot ${slotId} cancelled by ${userId}.`);

        // transaction.update(privateProfileRef, {
        //     balance: FieldValue.increment(refundAmount)
        // });
        // functions.logger.info(`cancelSlot: Balance updated for ${userId}. Refund/Fee: ${refundAmount}.`);

        // // Update public user balance if the document exists
        // if (publicUserDoc.exists) {
        //      transaction.update(publicUserRef, {
        //         balance: FieldValue.increment(refundAmount)
        //     });
        //     functions.logger.info(`cancelSlot: Public balance updated for ${userId}.`);
        // }


        return { success: true, message: 'Slot cancellation requested successfully!' };

    }).catch(error => {
        functions.logger.error(`cancelSlot: Transaction failed for slot ${slotId}, user ${userId}:`, error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to cancel slot.', error.message);
    });
});
exports.initializeUserProfile = functions.auth.user().onCreate(async (user) => {
    const userId = user.uid;
    const effectiveAppId = appId; // Or retrieve from user metadata if applicable

    if (!effectiveAppId) {
        functions.logger.error("initializeUserProfile: APP_ID not configured.");
        return null; // Or throw an error depending on desired behavior
    }

    const privateProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${userId}/profile/data`);
    const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`);

    const initialRegistrationCost = 4; // Define this constant

    try {
        // Initialize private profile with starting balance (e.g., 0)
        await privateProfileRef.set({
            balance: 0, // Or whatever your starting balance logic is *before* cost deduction
            hasPaidInitialRegistration: true, // Flag to track this payment
            // ... other initial user data
        }, { merge: true }); // Use merge if profile might already exist from other processes

        // Immediately deduct the initial cost (or handle payment gateway integration here)
        // For simplicity, let's assume direct deduction for now
        await privateProfileRef.update({
            balance: FieldValue.increment(-initialRegistrationCost)
        });

        // Update public user profile as well if it mirrors balance
        await publicUserRef.set({
            balance: FieldValue.increment(-initialRegistrationCost),
            // ... other initial public user data
        }, { merge: true });

        functions.logger.info(`Initial registration cost of ${initialRegistrationCost} EUR deducted for new user ${userId}.`);

        // Potentially integrate with a payment gateway here to process the actual charge.
        // This is a complex topic beyond this explanation but would be the next step.

    } catch (error) {
        functions.logger.error(`Error initializing user profile or deducting initial cost for ${userId}:`, error);
        // Handle errors, e.g., send an alert to an admin
    }
    return null;
});

// Example: A scheduled function to run once a day, or on cancellation events
exports.processReplacements = functions.pubsub.schedule('every 1 hour').onRun(async (context) => {
    // Or use functions.https.onCall if you want to trigger manually for testing
    // exports.processReplacements = functions.https.onCall(async (data, context) => {
        functions.logger.info("Starting processReplacements function.");
        const effectiveAppId = appId; // Or retrieve from data if callable
    
        if (!effectiveAppId) {
            functions.logger.error("processReplacements: APP_ID not configured.");
            return null;
        }
    
        const now = Timestamp.now().toDate();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
        // 1. Find slots that are cancelled and need replacements
        // This assumes `cancelSlot` marks the slot as available again, but without a refund yet.
        // You might need a more robust status, e.g., 'pendingReplacement'
        const cancelledSlotsSnapshot = await db.collection(`artifacts/${effectiveAppId}/public/data/slots`)
            .where('isBooked', '==', false) // It's available
            .where('bookedBy', '==', null) // No one has booked it yet
            .where('cancellationRequestedBy', '!=', null) // You'd need to add this field in cancelSlot
            .get();
    
        if (cancelledSlotsSnapshot.empty) {
            functions.logger.info("No cancelled slots requiring replacement found.");
            return null;
        }
    
        for (const slotDoc of cancelledSlotsSnapshot.docs) {
            const slotId = slotDoc.id;
            const slotData = slotDoc.data();
            const originalCancellerId = slotData.cancellationRequestedBy;
            const slotTime = slotData.timestamp.toDate();
            const gameDay = new Date(slotTime.getFullYear(), slotTime.getMonth(), slotTime.getDate());
    
            // Determine if it's "day before game day" or "game day"
            const oneDayBefore = new Date(gameDay.getTime());
            oneDayBefore.setDate(gameDay.getDate() - 1);
    
            let waitlistUser = null;
    
            // 2. Check the waitlist for the slot
            const waitlistRef = db.collection(`artifacts/${effectiveAppId}/public/data/slots/${slotId}/waitlist`);
            const waitlistSnapshot = await waitlistRef.orderBy('timestampAdded', 'asc').get();
    
            if (waitlistSnapshot.empty) {
                functions.logger.info(`No waitlisted users for slot ${slotId}.`);
                // Optionally, mark this slot as no replacement found, so it's not processed again soon
                // Or leave it available for manual booking.
                continue;
            }
    
            // Rule: Replacement can only happen after all slots are full (already handled by waitlist logic)
    
            // 3. On day before game day: Waitlist sequence
            if (now >= oneDayBefore && now < gameDay) {
                // Find the first user on the waitlist who hasn't been offered this slot yet
                // For true sequence, you'd need a more complex state for each waitlist entry
                // For simplicity, take the very first person in the waitlist
                waitlistUser = waitlistSnapshot.docs[0];
                functions.logger.info(`Replacement logic: Day Before Game Day for slot ${slotId}. Using WL 1: ${waitlistUser.id}`);
    
            } else if (now >= gameDay) {
                // 4. On game day: No waiting list sequence needed (first available on waitlist)
                waitlistUser = waitlistSnapshot.docs[0]; // Still pick first, but conceptually less strict
                functions.logger.info(`Replacement logic: Game Day for slot ${slotId}. Using first available on waitlist: ${waitlistUser.id}`);
            }
    
            if (waitlistUser) {
                const replacementUserId = waitlistUser.id;
                // Now, run a transaction to perform the replacement
                try {
                    await db.runTransaction(async (transaction) => {
                        const slotRef = db.doc(`artifacts/${effectiveAppId}/public/data/slots/${slotId}`);
                        const privateProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${replacementUserId}/profile/data`);
                        const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${replacementUserId}`);
                        const originalCancellerPrivateProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${originalCancellerId}/profile/data`);
                        const originalCancellerPublicProfileRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${originalCancellerId}`);
    
    
                        // --- ALL READS FIRST ---
                        const currentSlotDoc = await transaction.get(slotRef);
                        const replacementUserPrivateProfileDoc = await transaction.get(privateProfileRef);
                        const replacementUserPublicProfileDoc = await transaction.get(publicUserRef);
                        const originalCancellerPrivateProfileDoc = await transaction.get(originalCancellerPrivateProfileRef);
                        const originalCancellerPublicProfileDoc = await transaction.get(originalCancellerPublicProfileRef);
    
                        if (!currentSlotDoc.exists || currentSlotDoc.data().isBooked) {
                            functions.logger.warn(`processReplacements: Slot ${slotId} is no longer available or doesn't exist for replacement.`);
                            return; // Skip this slot
                        }
                        if (!replacementUserPrivateProfileDoc.exists) {
                            functions.logger.warn(`processReplacements: Replacement user private profile ${replacementUserId} not found.`);
                            return;
                        }
                        if (!originalCancellerPrivateProfileDoc.exists) {
                             functions.logger.warn(`processReplacements: Original canceller private profile ${originalCancellerId} not found.`);
                             // Proceed, but won't refund original canceller if profile doesn't exist
                        }
    
    
                        const appSettingsDoc = await transaction.get(db.doc(`artifacts/${effectiveAppId}/public/data/appSettings/settings`));
                        const appSettings = appSettingsDoc.data();
                        const slotBookingCost = appSettings.slotBookingCost || 4;
    
    
                        // Check if replacement user has enough balance
                        if (replacementUserPrivateProfileDoc.data().balance < slotBookingCost) {
                            functions.logger.warn(`processReplacements: Replacement user ${replacementUserId} has insufficient balance. Skipping.`);
                            // Remove from waitlist so they don't block
                            transaction.delete(waitlistRef.doc(replacementUserId));
                            return;
                        }
    
                        // --- ALL WRITES AFTER ALL READS ---
    
                        // Book the slot for the replacement user
                        transaction.update(slotRef, {
                            isBooked: true,
                            bookedBy: replacementUserId,
                            available: false,
                            // Clear the cancellation status
                            cancellationRequestedBy: FieldValue.delete()
                        });
                        functions.logger.info(`processReplacements: Slot ${slotId} booked by replacement ${replacementUserId}.`);
    
                        // Deduct balance from replacement user
                        transaction.update(privateProfileRef, {
                            balance: FieldValue.increment(-slotBookingCost)
                        });
                        if (replacementUserPublicProfileDoc.exists) {
                             transaction.update(publicUserRef, {
                                balance: FieldValue.increment(-slotBookingCost)
                            });
                        }
                        functions.logger.info(`processReplacements: Balance deducted for replacement ${replacementUserId}.`);
    
                        // Refund the original canceller
                        if (originalCancellerPrivateProfileDoc.exists) {
                            const refundAmount = slotBookingCost; // Assuming full refund for replacement
                            transaction.update(originalCancellerPrivateProfileRef, {
                                balance: FieldValue.increment(refundAmount)
                            });
                            if (originalCancellerPublicProfileDoc.exists) {
                                 transaction.update(originalCancellerPublicProfileRef, {
                                    balance: FieldValue.increment(refundAmount)
                                });
                            }
                            functions.logger.info(`processReplacements: Refund of ${refundAmount} EUR to original canceller ${originalCancellerId}.`);
                        }
    
    
                        // Remove replacement user from waitlist
                        transaction.delete(waitlistRef.doc(replacementUserId));
    
                        functions.logger.info(`processReplacements: Successfully replaced ${originalCancellerId} with ${replacementUserId} for slot ${slotId}.`);
    
                    }); // End of transaction
    
                } catch (error) {
                    functions.logger.error(`processReplacements: Transaction failed for slot ${slotId} with replacement ${replacementUserId}:`, error);
                }
            }
        }
    
        functions.logger.info("Finished processReplacements function.");
        return null; // For scheduled functions, return null or a success message
    });

// Cloud Function to process refund when a cancelled slot is re-booked.
exports.processRefundOnRebooking = functions.firestore
    .document('artifacts/{appIdFromContext}/public/data/slots/{slotId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();
        const appIdFromContext = context.params.appIdFromContext;
        const slotId = context.params.slotId;

        const wasCancelledAndAvailable = previousData.bookedBy === null && previousData.available === true && previousData.cancelledBy;
        const isNowBooked = newData.bookedBy !== null && newData.available === false;

        if (wasCancelledAndAvailable && isNowBooked) {
            const originalBookerId = previousData.cancelledBy;
            console.log(`Slot ${slotId} was re-booked by ${newData.bookedBy}. Processing refund for original booker ${originalBookerId}.`);

            const refundAmount = 4;
            console.log(`Refund amount for ${originalBookerId}: ${refundAmount}€ (fixed as per rule)`);

            const originalBookerProfileRef = db.doc(`artifacts/${appIdFromContext}/users/${originalBookerId}/profile/data`);
            const publicUserRef = db.doc(`artifacts/${appIdFromContext}/public/data/users/${originalBookerId}`);

            try {
                await db.runTransaction(async (transaction) => {
                    const originalBookerProfileSnap = await transaction.get(originalBookerProfileRef);
                    if (!originalBookerProfileSnap.exists) {
                        console.warn(`Original booker profile for ${originalBookerId} not found, skipping refund.`);
                        return;
                    }
                    const originalBookerData = originalBookerProfileSnap.data();
                    const newBalance = (originalBookerData.balance || 0) + refundAmount;

                    transaction.update(originalBookerProfileRef, { balance: newBalance });
                    transaction.update(publicUserRef, { balance: newBalance });

                    transaction.update(change.after.ref, {
                        cancelledBy: FieldValue.delete() // Using FieldValue directly
                    });
                });

                const originalBookerDataAfterTransaction = (await originalBookerProfileRef.get()).data();
                if (originalBookerDataAfterTransaction.fcmToken) {
                    const payload = {
                        notification: {
                            title: 'Slot Refund Processed!',
                            body: `Your slot on ${format(previousData.timestamp.toDate(), 'MMM dd, yyyy')} at ${previousData.time} was re-booked, and you have been refunded ${refundAmount}€!`,
                            icon: '/firebase-logo.png'
                        },
                        data: {
                            slotId: slotId,
                            date: previousData.date,
                            time: previousData.time,
                            amount: refundAmount.toString(),
                            type: 'slot_refund'
                        }
                    };
                    try {
                        await admin.messaging().sendToDevice(originalBookerDataAfterTransaction.fcmToken, payload); // Use token from re-fetched data
                        console.log(`Refund notification sent to ${originalBookerId}.`);
                    } catch (error) {
                        console.error(`Failed to send refund notification to ${originalBookerId}:`, error);
                    }
                }
            } catch (error) {
                console.error(`Error processing refund for slot ${slotId}:`, error);
            }
        }
        return null;
    });


// Cloud Function to handle cancellation fees for slots that are not re-booked by game day.
exports.handleNoRebookingCancellationFee = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    console.log("Running daily check for un-rebooked cancelled slots to finalize cancellation fees.");

    const now = new Date();
    const todayStart = startOfDay(now);

    const effectiveAppId = appId;
    if (!effectiveAppId) {
        console.error("handleNoRebookingCancellationFee: APP_ID environment variable is not configured.");
        return null;
    }
    const slotsRef = db.collection(`artifacts/${effectiveAppId}/public/data/slots`);

    const querySnapshot = await slotsRef
        .where('available', '==', true)
        .where('cancelledBy', '!=', null)
        .get();

    const updates = [];
    const notifications = [];

    for (const docSnap of querySnapshot.docs) {
        const slotData = docSnap.data();
        const slotId = docSnap.id;
        const slotTimestamp = slotData.timestamp?.toDate();

        if (slotTimestamp && slotTimestamp.getTime() <= todayStart.getTime() && slotData.cancelledBy) {
            console.log(`Slot ${slotId} on ${format(slotTimestamp, 'yyyy-MM-dd')} was not re-booked. Finalizing cancellation fee for ${slotData.cancelledBy}.`);

            updates.push({
                ref: docSnap.ref,
                update: {
                    cancelledBy: FieldValue.delete() // Using FieldValue directly
                }
            });

            notifications.push({
                userId: slotData.cancelledBy,
                appId: effectiveAppId,
                slotId: docSnap.id,
                slotDate: format(slotTimestamp, 'MMM dd, yyyy'),
                slotTime: slotData.time
            });
        }
    }

    if (updates.length > 0) {
        const batch = db.batch();
        updates.forEach(update => {
            batch.update(update.ref, update.update);
        });
        await batch.commit();
        console.log(`Cleared 'cancelledBy' for ${updates.length} slots. Cancellation fees finalized.`);

        for (const notif of notifications) {
            const userProfileRef = db.doc(`artifacts/${notif.appId}/users/${notif.userId}/profile/data`);
            const userProfileSnap = await userProfileRef.get();
            if (userProfileSnap.exists && userProfileSnap.data().fcmToken) {
                const token = userProfileSnap.data().fcmToken;
                const payload = {
                    notification: {
                        title: 'Slot Cancellation Finalized',
                        body: `Your cancelled slot on ${notif.slotDate} at ${notif.slotTime} was not re-booked. No refund issued.`,
                        icon: '/firebase-logo.png'
                    },
                    data: {
                        slotId: notif.slotId,
                        date: notif.slotDate,
                        time: notif.slotTime,
                        type: 'cancellation_fee_charged'
                    }
                };
                try {
                    await admin.messaging().sendToDevice(token, payload);
                    console.log(`Cancellation fee notification sent to ${notif.userId}.`);
                } catch (error) {
                    console.error(`Failed to send cancellation fee notification to ${notif.userId}:`, error);
                }
            }
        }
    } else {
        console.log("No un-rebooked cancelled slots found for today or past dates.");
    }
    return null;
});

exports.processTopUp = functions.https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');

    const effectiveAppId = data.appId || appId;
    if (!effectiveAppId) {
        functions.logger.error("processTopUp: APP_ID environment variable is not configured globally or passed from client.");
        throw new functions.https.HttpsError('internal', 'Server configuration error: App ID not set.');
    }

    const { userId, amount } = data;
    const userProfileRef = db.doc(`artifacts/${effectiveAppId}/users/${userId}/profile/data`);
    const publicUserRef = db.doc(`artifacts/${effectiveAppId}/public/data/users/${userId}`);

    try {
        let newBalance;
        await db.runTransaction(async (transaction) => {
            const userProfileSnap = await transaction.get(userProfileRef);
            if (!userProfileSnap.exists) throw new Error('User profile not found');
            const userData = userProfileSnap.data();
            newBalance = (userData.balance || 0) + amount;

            if (userData.registrationFeePending && userData.registrationFeePending > 0) {
                newBalance -= userData.registrationFeePending;
                transaction.update(userProfileRef, { balance: newBalance, registrationFeePending: 0 });
                transaction.update(publicUserRef, { balance: newBalance, registrationFeePending: 0 });
            } else {
                transaction.update(userProfileRef, { balance: newBalance });
                transaction.update(publicUserRef, { balance: newBalance });
            }
        });

        const userProfileSnap = await userProfileRef.get();
        const fcmToken = userProfileSnap.data().fcmToken;
        const userDataAfterTransaction = userProfileSnap.data();
        if (fcmToken) {
            const payload = {
                notification: {
                    title: 'Top-Up Processed!',
                    body: `Your top-up of ${amount} EUR was successful. ${userDataAfterTransaction.registrationFeePending && userDataAfterTransaction.registrationFeePending > 0 ? 'A registration fee was deducted. ' : ''}New balance: ${newBalance} EUR.`,
                    icon: '/firebase-logo.png'
                }
            };
            await admin.messaging().sendToDevice(fcmToken, payload);
        }

        return { success: true, newBalance };
    } catch (error) {
        console.error("Error in processTopUp callable:", error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});