// populateFirestore.js
const admin = require('firebase-admin');
const { addDays, setHours, setMinutes, subDays } = require('date-fns');

// Initialize Firebase Admin SDK
try {
    admin.initializeApp({
        projectId: 'smashers-badminton'
    });
} catch (e) {
    if (!e.message.includes('already exists')) {
        console.error("Error initializing Firebase Admin:", e);
    }
}

const db = admin.firestore();
const auth = admin.auth();
const appId = 'smashers-badminton';

const populateData = async () => {
    console.log("Starting Firestore & Auth dummy data population...");

    const batch = db.batch();
    const createdAuthUsers = [];

    // --- 1. App Settings ---
    const appSettingsRef = db.doc(`artifacts/${appId}/public/data/appSettings/settings`);
    batch.set(appSettingsRef, {
        slotBookingCost: 4,
        cancellationDeadlineHours: 1,
        topUpLink: 'https://example.com/mock-topup-gateway',
        minBalanceForBooking: 4
    });
    console.log("App settings added.");

    // --- 2. Members (Users) & Firebase Auth Users ---
    const members = [];
    const numMembers = 20;
    const adminEmail = 'admin@example.com';
    const adminPassword = 'password123';
    const defaultMemberPassword = 'password123';

    for (let i = 0; i < numMembers; i++) {
        const name = i === 0 ? 'Admin User' : `Member ${i}`;
        const email = i === 0 ? adminEmail : `member${i}@example.com`;
        const role = i === 0 ? 'admin' : 'member';

        let authUserRecord;
        try {
            // Create Firebase Auth user
            authUserRecord = await auth.createUser({
                email: email,
                password: i === 0 ? adminPassword : defaultMemberPassword,
                displayName: name,
                emailVerified: true
            });
            console.log(`Created Auth user: ${email} with UID: ${authUserRecord.uid}`);
            createdAuthUsers.push(authUserRecord.uid);
        } catch (authError) {
            if (authError.code === 'auth/email-already-exists') {
                console.warn(`Auth user ${email} already exists. Fetching existing user.`);
                authUserRecord = await auth.getUserByEmail(email);
            } else {
                console.error(`Error creating Auth user ${email}:`, authError);
                continue;
            }
        }

        const uid = authUserRecord.uid;
        const eloRating = Math.floor(Math.random() * (1600 - 1000 + 1)) + 1000;
        const balance = Math.floor(Math.random() * (50 - 5 + 1)) + 5; // 5-50 EUR
        const gamesPlayed = Math.floor(Math.random() * 30);
        const wins = Math.floor(Math.random() * gamesPlayed);
        const losses = gamesPlayed - wins;
        const draws = gamesPlayed - wins - losses >= 0 ? gamesPlayed - wins - losses : 0;

        members.push({ uid, name, email, role, eloRating, balance, gamesPlayed, wins, losses, draws });

        // Public User Profile (Document ID is now the Auth UID)
        const publicUserRef = db.doc(`artifacts/${appId}/public/data/users/${uid}`);
        batch.set(publicUserRef, {
            name,
            email,
            role,
            eloRating,
            gamesPlayed,
            wins,
            losses,
            draws,
            balance, // Set the random balance here
            firebaseAuthUid: uid
        });

        // Private User Profile (Document ID is now the Auth UID)
        const privateProfileRef = db.doc(`artifacts/${appId}/users/${uid}/profile/data`);
        batch.set(privateProfileRef, {
            name,
            balance, // Set the random balance here as well
            eloRating,
            gamesPlayed,
            wins,
            losses,
            draws,
            hasMadeFirstBooking: Math.random() > 0.5,
            lastTopUpTimestamp: Math.random() > 0.7 ? admin.firestore.FieldValue.serverTimestamp() : null,
            fcmToken: `dummyFcmToken_${uid}`
        });
    }
    console.log(`${members.length} members (and Auth users) added/updated.`);

    // --- 3. Slots for next 5 days + some past slots ---
    const slots = [];
    const numDays = 5;
    const now = new Date();

    // Generate future slots
    for (let d = 0; d < numDays; d++) {
        const currentDay = addDays(now, d);
        for (let hour = 9; hour <= 21; hour += 1) {
            const slotTime = setMinutes(setHours(currentDay, hour), 0);
            const slotId = `${slotTime.toISOString().split('T')[0]}_${hour.toString().padStart(2, '0')}00`;

            let isBooked = false;
            let bookedBy = null;
            let available = true;
            let preBooked = false;
            let cancelledBy = null;
            let cancellationTimestamp = null;

            // Randomly book some slots
            if (Math.random() < 0.3) {
                isBooked = true;
                bookedBy = members[Math.floor(Math.random() * members.length)].uid;
                available = false;
            } else if (Math.random() < 0.1) {
                isBooked = true;
                bookedBy = members.find(m => m.email === adminEmail)?.uid;
                if (!bookedBy) bookedBy = members[0].uid;
                available = false;
                preBooked = true;
            }

            // Randomly cancel some booked slots (for future slots only)
            if (isBooked && d > 0 && Math.random() < 0.2) {
                cancelledBy = bookedBy;
                cancellationTimestamp = admin.firestore.FieldValue.serverTimestamp();
                bookedBy = null;
                isBooked = false;
                available = true;
                preBooked = false;
            }

            slots.push({
                id: slotId,
                timestamp: admin.firestore.Timestamp.fromDate(slotTime),
                time: `${hour.toString().padStart(2, '0')}:00`,
                isBooked,
                bookedBy,
                available,
                capacity: 2,
                preBooked,
                cancelledBy: cancelledBy,
                cancellationTimestamp: cancellationTimestamp
            });
        }
    }

    // Add a few past slots (some booked, some available, some cancelled for refund testing)
    for (let d = 1; d <= 3; d++) {
        const pastDay = subDays(now, d);
        for (let hour = 10; hour <= 12; hour += 1) {
            const slotTime = setMinutes(setHours(pastDay, hour), 0);
            const slotId = `past_${pastDay.toISOString().split('T')[0]}_${hour.toString().padStart(2, '0')}00`;

            let isBooked = Math.random() < 0.5;
            let bookedBy = isBooked ? members[Math.floor(Math.random() * members.length)].uid : null;
            let available = !isBooked;
            let cancelledBy = null;
            let cancellationTimestamp = null;

            if (isBooked && Math.random() < 0.3 && d === 1) {
                cancelledBy = bookedBy;
                cancellationTimestamp = admin.firestore.Timestamp.fromDate(subDays(slotTime, 0.5));
                bookedBy = null;
                isBooked = false;
                available = true;
            }

            slots.push({
                id: slotId,
                timestamp: admin.firestore.Timestamp.fromDate(slotTime),
                time: `${hour.toString().padStart(2, '0')}:00`,
                isBooked,
                bookedBy,
                available,
                capacity: 2,
                preBooked: false,
                cancelledBy: cancelledBy,
                cancellationTimestamp: cancellationTimestamp
            });
        }
    }

    slots.forEach(slot => {
        const slotRef = db.doc(`artifacts/${appId}/public/data/slots/${slot.id}`);
        batch.set(slotRef, slot);
    });
    console.log(`${slots.length} slots added.`);

    // --- 4. Waiting Lists (for some 'full' slots) ---
    const waitingLists = [];
    const potentialFullSlots = slots.filter(s => s.isBooked && s.capacity === 2 && s.bookedBy !== members.find(m => m.email === adminEmail)?.uid && (s.timestamp.toDate() > now));

    for (let i = 0; i < Math.min(5, potentialFullSlots.length); i++) {
        const slot = potentialFullSlots[i];
        const usersOnWaitingList = [];
        const numUsersOnList = Math.floor(Math.random() * 3) + 1;

        const potentialWaiters = members.filter(m => m.uid !== slot.bookedBy);

        for (let j = 0; j < numUsersOnList; j++) {
            if (potentialWaiters.length > 0) {
                const randomWaiter = potentialWaiters.splice(Math.floor(Math.random() * potentialWaiters.length), 1)[0];
                usersOnWaitingList.push(randomWaiter.uid);
            }
        }

        if (usersOnWaitingList.length > 0) {
            const waitingListId = `${slot.id}`;
            waitingLists.push({
                slotId: slot.id,
                timestamp: slot.timestamp,
                date: slot.timestamp.toDate().toISOString().split('T')[0],
                time: slot.time,
                users: usersOnWaitingList,
                slotAvailable: false
            });
        }
    }

    waitingLists.forEach(wl => {
        const wlRef = db.doc(`artifacts/${appId}/public/data/waitingLists/${wl.slotId}`);
        batch.set(wlRef, wl);
    });
    console.log(`${waitingLists.length} waiting lists added.`);


    // --- 5. Matches and Match History ---
    const matches = [];
    const numMatches = 20;

    const allMembersUids = members.map(m => m.uid);

    for (let i = 0; i < numMatches; i++) {
        const relevantSlots = slots.filter(s => s.timestamp.toDate() < now || s.timestamp.toDate() > addDays(now, 2));
        if (relevantSlots.length === 0) continue;

        const randomSlot = relevantSlots[Math.floor(Math.random() * relevantSlots.length)];
        let team1Player1Uid = allMembersUids[Math.floor(Math.random() * allMembersUids.length)];
        let team1Player2Uid = null;
        let team2Player1Uid = null;
        let team2Player2Uid = null;

        let availablePlayersForMatch = allMembersUids.filter(uid => uid !== team1Player1Uid);

        const gameType = Math.random() < 0.5 ? 'Singles' : 'Doubles';

        if (gameType === 'Singles') {
            if (availablePlayersForMatch.length < 1) continue;
            team2Player1Uid = availablePlayersForMatch[Math.floor(Math.random() * availablePlayersForMatch.length)];
        } else {
            if (availablePlayersForMatch.length < 3) continue;
            team1Player2Uid = availablePlayersForMatch.splice(Math.floor(Math.random() * availablePlayersForMatch.length), 1)[0];
            team2Player1Uid = availablePlayersForMatch.splice(Math.floor(Math.random() * availablePlayersForMatch.length), 1)[0];
            team2Player2Uid = availablePlayersForMatch.splice(Math.floor(Math.random() * availablePlayersForMatch.length), 1)[0];
        }

        const team1 = [team1Player1Uid, team1Player2Uid].filter(Boolean);
        const team2 = [team2Player1Uid, team2Player2Uid].filter(Boolean);

        if (gameType === 'Singles' && (team1.length !== 1 || team2.length !== 1)) continue;
        if (gameType === 'Doubles' && (team1.length !== 2 || team2.length !== 2)) continue;

        const statuses = ['confirmed', 'pending_confirmation', 'pending_score', 'rejected'];
        let status = statuses[Math.floor(Math.random() * statuses.length)];

        if (randomSlot.timestamp.toDate() > now) {
            if (status === 'confirmed' || status === 'pending_score' || status === 'rejected') {
                status = Math.random() < 0.7 ? 'pending_confirmation' : 'pending_score';
            }
        } else {
            if (status === 'pending_confirmation' || status === 'pending_score') {
                status = Math.random() < 0.8 ? 'confirmed' : 'rejected';
            }
        }

        let scores = { team1: null, team2: null };
        if (status === 'confirmed') {
            scores = {
                team1: Math.floor(Math.random() * 10) + 11,
                team2: Math.floor(Math.random() * 10) + 11
            };
            while (scores.team1 === scores.team2) {
                scores.team2 = Math.floor(Math.random() * 10) + 11;
            }
        } else if (status === 'pending_score') {
             if (Math.random() < 0.5) {
                scores = {
                    team1: Math.floor(Math.random() * 21),
                    team2: Math.floor(Math.random() * 21)
                };
                while (scores.team1 === scores.team2) {
                    scores.team2 = Math.floor(Math.random() * 21);
                }
             } else {
                 scores = { team1: null, team2: null };
             }
        }

        let confirmedBy = [];
        if (status === 'confirmed' || status === 'pending_score') {
            confirmedBy = [...new Set([...team1, ...team2])];
        } else if (status === 'pending_confirmation') {
            confirmedBy = [team1[0]];
            if (team2.length > 0 && Math.random() < 0.5) {
                confirmedBy.push(team2[Math.floor(Math.random() * team2.length)]);
            }
            confirmedBy = [...new Set(confirmedBy)];
        }

        const createdBy = team1[0];
        const adminUid = members.find(m => m.role === 'admin')?.uid || members[0].uid;

        const matchId = db.collection(`artifacts/${appId}/public/data/matches`).doc().id;

        const matchData = {
            id: matchId,
            slotTimestamp: randomSlot.timestamp,
            slotTime: randomSlot.time,
            gameType: gameType,
            team1: team1,
            team2: team2,
            status: status,
            confirmedBy: confirmedBy,
            scores: scores,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: createdBy,
            rejectedBy: status === 'rejected' ? adminUid : null,
            rejectedAt: status === 'rejected' ? admin.firestore.FieldValue.serverTimestamp() : null,
            submittedBy: (status === 'confirmed' && scores.team1 !== null) ? adminUid : null,
            submittedAt: (status === 'confirmed' && scores.team1 !== null) ? admin.firestore.FieldValue.serverTimestamp() : null
        };
        matches.push(matchData);

        const matchRef = db.doc(`artifacts/${appId}/public/data/matches/${matchId}`);
        batch.set(matchRef, matchData);

        if (status === 'confirmed' && scores.team1 !== null) {
            const allPlayersInMatch = [...team1, ...team2];
            const team1AvgElo = team1.reduce((sum, uid) => sum + (members.find(m => m.uid === uid)?.eloRating || 1000), 0) / team1.length;
            const team2AvgElo = team2.reduce((sum, uid) => sum + (members.find(m => m.uid === uid)?.eloRating || 1000), 0) / team2.length;

            let outcomeTeam1;
            if (scores.team1 > scores.team2) {
                outcomeTeam1 = 1;
            } else if (scores.team2 > scores.team1) {
                outcomeTeam1 = 0;
            } else {
                outcomeTeam1 = 0.5;
            }

            for (const playerId of allPlayersInMatch) {
                const player = members.find(m => m.uid === playerId);
                if (!player) continue;

                const currentElo = player.eloRating || 1000;
                const gamesPlayed = player.gamesPlayed || 0;

                let playerOutcome;
                let opponentAvgEloForPlayer;
                if (team1.includes(playerId)) {
                    playerOutcome = outcomeTeam1;
                    opponentAvgEloForPlayer = team2AvgElo;
                } else {
                    playerOutcome = 1 - outcomeTeam1;
                    opponentAvgEloForPlayer = team1AvgElo;
                }

                const K_FACTOR = 32;
                const expectedScore = 1 / (1 + Math.pow(10, (opponentAvgEloForPlayer - currentElo) / 400));
                const eloChange = K_FACTOR * (playerOutcome - expectedScore);
                const newElo = Math.max(100, Math.round(currentElo + eloChange));

                const matchHistoryRef = db.doc(`artifacts/${appId}/users/${playerId}/matches_played/${matchId}`);
                batch.set(matchHistoryRef, {
                    matchId: matchId,
                    date: randomSlot.timestamp.toDate().toISOString().split('T')[0],
                    time: randomSlot.time,
                    gameType: gameType,
                    team1: team1,
                    team2: team2,
                    scoreTeam1: scores.team1,
                    scoreTeam2: scores.team2,
                    playerTeam: team1.includes(playerId) ? 'team1' : 'team2',
                    eloChange: eloChange,
                    oldElo: currentElo,
                    newElo: newElo,
                    outcome: playerOutcome,
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                player.eloRating = newElo;
                player.gamesPlayed = (player.gamesPlayed || 0) + 1;
                player.wins = (player.wins || 0) + (playerOutcome === 1 ? 1 : 0);
                player.losses = (player.losses || 0) + (playerOutcome === 0 ? 1 : 0);
                player.draws = (player.draws || 0) + (playerOutcome === 0.5 ? 1 : 0);
            }
        }
    }

    console.log(`${matches.length} matches added and corresponding match history entries created for confirmed matches.`);


    // --- Commit Batch ---
    try {
        await batch.commit();
        console.log("Firestore dummy data population complete!");
    } catch (error) {
        console.error("Error committing Firestore batch:", error);
    }
};

populateData().catch(console.error);