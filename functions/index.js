// functions/index.js

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();

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
    .document('artifacts/{appId}/public/data/matches/{matchId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();
        const appId = context.params.appId;
        const matchId = context.params.matchId;

        // Check for status change to 'confirmed'
        if (newData.status === 'confirmed' && previousData.status !== 'confirmed') {
            const team1Uids = newData.team1;
            const team2Uids = newData.team2;
            const score1 = newData.score1;
            const score2 = newData.score2;

            const batch = db.batch();
            const allPlayerUids = [...new Set([...team1Uids, ...team2Uids])]; // Get unique UIDs

            const playerProfiles = {};
            for (const uid of allPlayerUids) {
                const userProfileRef = db.doc(`artifacts/${appId}/public/data/users/${uid}`); // Public user data for Elo
                const docSnap = await userProfileRef.get();
                if (docSnap.exists) {
                    playerProfiles[uid] = { ...docSnap.data(), ref: userProfileRef };
                } else {
                    console.warn(`User profile not found for UID: ${uid} in public/data/users.`);
                    // It's crucial to handle this case, perhaps by logging an error and returning,
                    // or ensuring such a state doesn't occur. For now, we'll return null.
                    return null;
                }
            }

            // Calculate average Elo for teams
            const getTeamElo = (uids) => {
                if (uids.length === 0) return 1000; // Default Elo for an empty team, should not happen if validation is strict
                return uids.reduce((sum, uid) => sum + (playerProfiles[uid]?.eloRating || 1000), 0) / uids.length;
            };

            const team1AvgElo = getTeamElo(team1Uids);
            const team2AvgElo = getTeamElo(team2Uids);

            // Determine outcome (1 for team1 win, 0 for team2 win, 0.5 for draw)
            // Note: Frontend validation currently prevents draws (score1 === score2)
            let outcomeTeam1;
            if (score1 > score2) {
                outcomeTeam1 = 1;
            } else if (score2 > score1) {
                outcomeTeam1 = 0;
            } else {
                outcomeTeam1 = 0.5; // Should ideally not be reached if draws are prevented
            }

            // Calculate Elo changes for each player based on team average
            for (const uid of allPlayerUids) {
                const currentElo = playerProfiles[uid].eloRating || 1000;
                const gamesPlayed = playerProfiles[uid].gamesPlayed || 0;
                let newEloChange;

                if (team1Uids.includes(uid)) {
                    // Player is in Team 1
                    newEloChange = calculateEloChange(currentElo, team2AvgElo, outcomeTeam1, gamesPlayed);
                } else {
                    // Player is in Team 2
                    newEloChange = calculateEloChange(currentElo, team1AvgElo, 1 - outcomeTeam1, gamesPlayed); // 1-outcome because it's from Team 2's perspective
                }

                const updatedElo = Math.max(100, Math.round(currentElo + newEloChange)); // Elo doesn't go below 100
                const updatedGamesPlayed = gamesPlayed + 1;

                batch.update(playerProfiles[uid].ref, {
                    eloRating: updatedElo,
                    gamesPlayed: updatedGamesPlayed,
                    lastGameDate: admin.firestore.FieldValue.serverTimestamp()
                });
            }

            await batch.commit();
            console.log(`Elo ratings and games played updated for match ${matchId}.`);
            return null; // Indicate successful execution

        } else if (newData.status === 'pending_confirmation') {
            // Logic for sending notifications for pending confirmation
            const allPlayersInMatch = [...newData.team1, ...newData.team2];
            // Filter players who are in the match but have NOT yet confirmed
            const playersStillToConfirm = allPlayersInMatch.filter(playerId =>
                !newData.confirmedBy || !newData.confirmedBy.includes(playerId)
            );

            for (const playerId of playersStillToConfirm) {
                // Fetch the private user profile data for the FCM token
                const userProfileRef = db.doc(`artifacts/${appId}/users/${playerId}/profile/data`);
                const userProfileSnap = await userProfileRef.get();

                if (userProfileSnap.exists && userProfileSnap.data().fcmToken) {
                    const token = userProfileSnap.data().fcmToken;
                    // Format date for the notification message
                    const matchDateFormatted = new Date(newData.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
                    const payload = {
                        notification: {
                            title: 'Match Pending Confirmation!',
                            body: `A match on ${matchDateFormatted} involving you needs your confirmation!`,
                            icon: '/firebase-logo.png' // Make sure this path is accessible
                        },
                        data: {
                            matchId: change.after.id,
                            status: 'pending_confirmation',
                            click_action: 'FLUTTER_NOTIFICATION_CLICK' // For Flutter, customize if web-only
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
        }
        return null;
    });
// Cloud Function to send notifications on match confirmation updates
exports.sendMatchConfirmationNotification = functions.firestore
    .document('artifacts/{appId}/public/data/matches/{matchId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();
        const appId = context.params.appId;

        const newConfirmedBy = newData.confirmedBy || [];
        const oldConfirmedBy = previousData.confirmedBy || [];

        // Only proceed if a new confirmation was added (array length increased)
        if (newConfirmedBy.length > oldConfirmedBy.length) {
            const confirmerId = newConfirmedBy.find(id => !oldConfirmedBy.includes(id));
            if (!confirmerId) {
                console.log("No new confirmer found or confirmer already present.");
                return null;
            }

            // Ensure the person who confirmed is an opponent and not the match adder
            if (confirmerId === newData.addedBy) {
                console.log("Confirmer is the match adder. No notification sent for this confirmation.");
                return null;
            }

            // Get all players involved in the match for more descriptive notifications
            const allPlayers = [...newData.team1, ...newData.team2];

            // Case 1: Match just became fully confirmed (status changed to 'confirmed')
            if (newData.status === 'confirmed' && previousData.status !== 'confirmed') {
                // Notify all involved players (except the original adder and the last confirmer)
                const playersToNotifyConfirmedStatus = allPlayers.filter(
                    playerId => playerId !== newData.addedBy && playerId !== confirmerId
                );

                for (const playerId of playersToNotifyConfirmedStatus) {
                    const userProfileRef = db.doc(`artifacts/${appId}/users/${playerId}/profile/data`);
                    const userProfileSnap = await userProfileRef.get();

                    if (userProfileSnap.exists && userProfileSnap.data().fcmToken) {
                        const token = userProfileSnap.data().fcmToken;
                        const payload = {
                            notification: {
                                title: 'Match Confirmed!',
                                body: `The match on ${newData.date} has been fully confirmed! Elo ratings updated.`,
                                icon: '/firebase-logo.png' // Path to an icon in your PWA's public folder
                            },
                            data: {
                                matchId: change.after.id,
                                status: 'confirmed'
                            }
                        };
                        try {
                            await admin.messaging().sendToDevice(token, payload);
                            console.log(`Notification sent to ${playerId} for confirmed match.`);
                        } catch (error) {
                            console.error(`Failed to send notification to ${playerId}:`, error);
                        }
                    }
                }
            }
            // Case 2: Match is still pending confirmation, and an opponent just confirmed (so others need to confirm)
            else if (newData.status === 'pending_confirmation') {
                // Find players who still need to confirm (are in the match, not the adder, and haven't confirmed yet)
                const playersStillToConfirm = allPlayers.filter(
                    playerId => playerId !== newData.addedBy && !newConfirmedBy.includes(playerId)
                );

                for (const playerId of playersStillToConfirm) {
                    const userProfileRef = db.doc(`artifacts/${appId}/users/${playerId}/profile/data`);
                    const userProfileSnap = await userProfileRef.get();

                    if (userProfileSnap.exists && userProfileSnap.data().fcmToken) {
                        const token = userProfileSnap.data().fcmToken;
                        const payload = {
                            notification: {
                                title: 'Match Pending Confirmation!',
                                body: `A match on ${newData.date} involving you needs your confirmation!`,
                                icon: '/firebase-logo.png'
                            },
                            data: {
                                matchId: change.after.id,
                                status: 'pending_confirmation'
                            }
                        };
                        try {
                            await admin.messaging().sendToDevice(token, payload);
                            console.log(`Notification sent to ${playerId} for pending confirmation.`);
                        } catch (error) {
                            console.error(`Failed to send notification to ${playerId}:`, error);
                        }
                    }
                }
            }
        }
        return null;
    });    

// Cloud Function to handle slot cancellations: notify waiting list and mark the slot for potential refund.
// functions/index.js

// ... (existing code above this function) ...

// Cloud Function to handle slot cancellations: notify waiting list and mark the slot for potential refund.
exports.handleSlotCancellation = functions.firestore
    .document('artifacts/{appId}/public/data/slots/{slotId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();
        const appId = context.params.appId;
        const slotId = context.params.slotId;

        // Condition for a slot cancellation:
        // 1. The slot was previously booked (bookedBy existed and available was false).
        // 2. Now the slot is available and bookedBy is null.
        const wasBooked = previousData.bookedBy !== null && previousData.available === false;
        const isCancelled = newData.bookedBy === null && newData.available === true;

        if (wasBooked && isCancelled) {
            console.log(`Slot ${slotId} was cancelled by ${previousData.bookedBy}. Notifying waiting list and marking for potential refund.`);

            const slotDate = newData.date;
            const slotTime = newData.time;
            const waitingListDocRef = db.collection(`artifacts/${appId}/public/data/waitingLists`).doc(`${slotDate}_${slotTime}`);

            // Mark the slot with who cancelled it. This is crucial for future conditional refund logic.
            await db.collection(`artifacts/${appId}/public/data/slots`).doc(slotId).update({
                cancelledBy: previousData.bookedBy,
                // If you store the booking cost on the slot when it's initially booked,
                // you could pass it here for the refund logic:
                // originalBookingAmount: previousData.bookingCost || null // <-- Requires client-side change to MemberDashboard.js handleBookSlot
            });

            // --- Notification Logic for Waiting List Users (Revised) ---
            const waitingListSnap = await waitingListDocRef.get();
            if (waitingListSnap.exists) {
                const waitingListData = waitingListSnap.data();
                const usersOnList = waitingListData.users || [];

                if (usersOnList.length > 0) {
                    const slotDateTime = new Date(`${slotDate}T${slotTime}:00`); // Combine date and time
                    const now = new Date();
                    // Normalize dates to start of day for accurate comparison
                    const slotDateOnly = new Date(slotDateTime.getFullYear(), slotDateTime.getMonth(), slotDateTime.getDate()).getTime();
                    const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

                    let usersToNotify = [];

                    // Rule: "before game day if there is 1 cancellation only user on WL 1 gets a notification"
                    // If slot date is after today (i.e., 'before game day'), notify only the first user.
                    if (slotDateOnly > todayDateOnly) {
                        usersToNotify.push(usersOnList[0]);
                        console.log(`Notifying only the first user on waiting list for slot ${slotDate} ${slotTime} (before game day).`);
                    } else if (slotDateOnly === todayDateOnly) {
                        // If slot date is today ('on game day'), notify everyone.
                        usersToNotify = usersOnList;
                        console.log(`Notifying all users on waiting list for slot ${slotDate} ${slotTime} (on game day).`);
                    } else {
                        // Slot date is in the past, likely old data. Don't notify.
                        console.log(`Slot date ${slotDate} is in the past, not notifying waiting list.`);
                    }

                    for (const userIdToNotify of usersToNotify) {
                        const userProfileRef = db.doc(`artifacts/${appId}/users/${userIdToNotify}/profile/data`);
                        const userProfileSnap = await userProfileRef.get();

                        if (userProfileSnap.exists && userProfileSnap.data().fcmToken) {
                            const token = userProfileSnap.data().fcmToken;
                            const payload = {
                                notification: {
                                    title: 'Slot Available!',
                                    body: `A slot on ${slotDate} at ${slotTime} is now available! Book it now!`,
                                    icon: '/firebase-logo.png' // Adjust path to a suitable icon
                                },
                                data: {
                                    slotId: slotId,
                                    date: slotDate,
                                    time: slotTime,
                                    type: 'slot_available'
                                }
                            };
                            try {
                                await admin.messaging().sendToDevice(token, payload);
                                console.log(`Notification sent to ${userIdToNotify} for slot availability.`);
                            } catch (error) {
                                console.error(`Failed to send notification to ${userIdToNotify}:`, error);
                            }
                        } else {
                            console.log(`User ${userIdToNotify} has no FCM token or profile data.`);
                        }
                    }
                } else {
                    console.log(`No users on waiting list for ${slotDate} ${slotTime}.`);
                }
            } else {
                console.log(`No waiting list document found for ${slotDate} ${slotTime}.`);
            }
        }
        return null;
    });


// functions/index.js

// ... (existing code, including exports.handleSlotCancellation, above this function) ...

// Cloud Function to process refund when a cancelled slot is re-booked.
// functions/index.js

// ... (existing code above this function) ...

// Cloud Function to process refund when a cancelled slot is re-booked.
exports.processRefundOnRebooking = functions.firestore
    .document('artifacts/{appId}/public/data/slots/{slotId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const previousData = change.before.data();
        const appId = context.params.appId;
        const slotId = context.params.slotId;

        // Condition for re-booking a previously cancelled slot:
        // 1. Slot was previously available and marked as cancelled by someone.
        // 2. Now the slot is booked by a new user.
        const wasCancelled = previousData.bookedBy === null && previousData.available === true && previousData.cancelledBy !== undefined;
        const isRebooked = newData.bookedBy !== null && newData.available === false;

        if (wasCancelled && isRebooked) {
            const originalBookerId = previousData.cancelledBy;
            console.log(`Slot ${slotId} was re-booked by ${newData.bookedBy}. Processing refund for original booker ${originalBookerId}.`);

            // --- Determine refund amount ---
            // As per clarification, refund is always 4 EUR. The first booking's one-time 4 EUR cost is not refunded.
            const refundAmount = 4;
            console.log(`Refund amount for ${originalBookerId}: ${refundAmount}€ (fixed as per rule)`);

            // Fetch original booker's profile to get their current balance
            const originalBookerProfileRef = db.doc(`artifacts/${appId}/users/${originalBookerId}/profile/data`);
            const originalBookerProfileSnap = await originalBookerProfileRef.get();

            if (originalBookerProfileSnap.exists) {
                const originalBookerData = originalBookerProfileSnap.data();
                const newBalance = (originalBookerData.balance || 0) + refundAmount;

                // Refund balance to private profile
                await originalBookerProfileRef.update({
                    balance: newBalance
                });

                // Refund balance to public user data
                const publicUserDocRef = db.doc(`artifacts/${appId}/public/data/users`, originalBookerId);
                await publicUserDocRef.update({
                    balance: newBalance
                });

                console.log(`Refunded ${refundAmount}€ to ${originalBookerId}. New balance: ${newBalance}`);

                // Send a notification to the original booker about the refund
                if (originalBookerData.fcmToken) {
                    const payload = {
                        notification: {
                            title: 'Slot Refund Processed!',
                            body: `Your slot on ${previousData.date} at ${previousData.time} was re-booked, and you have been refunded ${refundAmount}€!`,
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
                        await admin.messaging().sendToDevice(token, payload);
                        console.log(`Refund notification sent to ${originalBookerId}.`);
                    } catch (error) {
                        console.error(`Failed to send refund notification to ${originalBookerId}:`, error);
                    }
                }
            } else {
                console.warn(`Original booker profile for ${originalBookerId} not found, unable to process refund.`);
            }

            // Clear the cancelledBy field from the slot as the refund has been processed.
            await change.after.ref.update({
                cancelledBy: admin.firestore.FieldValue.delete()
            });
        }
        return null;
    });


// Cloud Function to handle cancellation fees for slots that are not re-booked by game day.
// Runs daily to check for such slots.
exports.handleNoRebookingCancellationFee = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    console.log("Running daily check for un-rebooked cancelled slots to finalize cancellation fees.");

    const slotsRef = db.collectionGroup('slots'); // Use collectionGroup if 'slots' is a subcollection in `artifacts/{appId}/public/data/slots`
    // Query for slots that are available, were cancelled by someone, and are on or before today
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Normalize to start of today

    const querySnapshot = await slotsRef
        .where('available', '==', true)
        .where('cancelledBy', '!=', null) // Check if cancelledBy field exists
        .get();

    const updates = [];
    const notifications = [];

    querySnapshot.forEach(docSnap => {
        const slotData = docSnap.data();
        const slotId = docSnap.id;
        // The following line extracts appId assuming the path is like `artifacts/{appId}/public/data/slots/{slotId}`
        // If your structure is different, you might need to adjust how appId is obtained.
        const appId = docSnap.ref.parent.parent.parent.parent.id;
        const slotDate = new Date(`${slotData.date}T00:00:00`); // Normalize slot date to start of day

        // If the slot date is today or in the past, and it's still available with a cancelledBy field,
        // it means it was not re-booked.
        if (slotDate.getTime() <= today.getTime() && slotData.cancelledBy) {
            console.log(`Slot ${slotId} on ${slotData.date} was not re-booked. Finalizing cancellation fee for ${slotData.cancelledBy}.`);

            // Clear the cancelledBy field (effectively charging the cancellation fee by not refunding)
            updates.push({
                ref: docSnap.ref,
                update: {
                    cancelledBy: admin.firestore.FieldValue.delete()
                }
            });

            // Prepare notification for the original booker (optional)
            notifications.push({
                userId: slotData.cancelledBy,
                appId: appId,
                slotDate: slotData.date,
                slotTime: slotData.time
            });
        }
    });

    if (updates.length > 0) {
        const batch = db.batch();
        updates.forEach(update => {
            batch.update(update.ref, update.update);
        });
        await batch.commit();
        console.log(`Cleared 'cancelledBy' for ${updates.length} slots. Cancellation fees finalized.`);

        // Send notifications
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
                        slotId: notif.slotId, // This might not be passed in 'notif' object, adjust if needed
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