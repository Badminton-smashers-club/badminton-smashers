// populateFirestore.js
const admin = require('firebase-admin');
const { addDays, setHours, setMinutes } = require('date-fns');

// Initialize Firebase Admin SDK
try {
    admin.initializeApp({
        projectId: 'smashers-badminton' // Use your project ID for emulator
    });
} catch (e) {
    if (!e.message.includes('already exists')) {
        console.error("Error initializing Firebase Admin:", e);
    }
}

const db = admin.firestore();
const auth = admin.auth(); // Initialize Firebase Auth Admin
const appId = 'smashers-badminton'; // Your application ID - ensure this matches your frontend's appId

const populateData = async () => {
    console.log("Starting Firestore & Auth dummy data population...");

    const batch = db.batch();
    const createdAuthUsers = []; // To store UIDs of created Auth users

    // --- 1. App Settings ---
    const appSettingsRef = db.doc(`artifacts/${appId}/public/data/appSettings/settings`);
    batch.set(appSettingsRef, {
        slotBookingCost: 5,
        cancellationFee: 2,
        cancellationDeadlineHours: 2, // 2 hours before slot
        topUpLink: 'https://example.com/mock-topup-gateway',
        minBalanceForBooking: 3
    });
    console.log("App settings added.");

    // --- 2. Members (Users) & Firebase Auth Users ---
    const members = [];
    const numMembers = 20;
    const adminEmail = 'admin@example.com';
    const adminPassword = 'password123';
    const defaultMemberPassword = 'password123'; // Common password for all members

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
                emailVerified: true // Mark as verified for convenience
            });
            console.log(`Created Auth user: ${email} with UID: ${authUserRecord.uid}`);
            createdAuthUsers.push(authUserRecord.uid);
        } catch (authError) {
            if (authError.code === 'auth/email-already-exists') {
                console.warn(`Auth user ${email} already exists. Fetching existing user.`);
                authUserRecord = await auth.getUserByEmail(email);
            } else {
                console.error(`Error creating Auth user ${email}:`, authError);
                // Optionally, skip this user or throw error
                continue;
            }
        }

        const uid = authUserRecord.uid; // Use the Auth UID as the primary identifier
        const eloRating = Math.floor(Math.random() * (1600 - 1000 + 1)) + 1000; // 1000-1600
        const balance = Math.floor(Math.random() * (50 - 5 + 1)) + 5; // 5-50 EUR
        const gamesPlayed = Math.floor(Math.random() * 30);
        const wins = Math.floor(Math.random() * gamesPlayed);
        const losses = gamesPlayed - wins;

        members.push({ uid, name, email, role, eloRating, balance, gamesPlayed, wins, losses });

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
            balance,
            firebaseAuthUid: uid // Explicitly store Auth UID
        });

        // Private User Profile (Document ID is now the Auth UID)
        const privateProfileRef = db.doc(`artifacts/${appId}/users/${uid}/profile/data`);
        batch.set(privateProfileRef, {
            name,
            balance,
            eloRating,
            gamesPlayed,
            wins,
            losses,
            hasMadeFirstBooking: Math.random() > 0.5,
            lastTopUpTimestamp: Math.random() > 0.7 ? admin.firestore.FieldValue.serverTimestamp() : null,
            fcmToken: `dummyFcmToken_${uid}` // Dummy FCM token for notifications
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
        for (let hour = 9; hour <= 21; hour += 1) { // 9 AM to 9 PM, every hour
            const slotTime = setMinutes(setHours(currentDay, hour), 0);
            const slotId = `${slotTime.toISOString().split('T')[0]}_${hour.toString().padStart(2, '0')}00`; // YYYY-MM-DD_HHMM

            let isBooked = false;
            let bookedBy = null;
            let available = true;
            let preBooked = false;

            // Randomly book some slots
            if (Math.random() < 0.3) { // 30% chance to be booked
                isBooked = true;
                // Ensure bookedBy is one of the Auth UIDs
                bookedBy = members[Math.floor(Math.random() * members.length)].uid;
                available = false;
            } else if (Math.random() < 0.1) { // 10% chance to be pre-booked (for admin)
                isBooked = true;
                bookedBy = members.find(m => m.email === adminEmail)?.uid; // Find admin's actual Auth UID
                if (!bookedBy) bookedBy = members[0].uid; // Fallback
                available = false;
                preBooked = true;
            }

            slots.push({
                id: slotId,
                timestamp: admin.firestore.Timestamp.fromDate(slotTime),
                time: `${hour.toString().padStart(2, '0')}:00`,
                isBooked,
                bookedBy,
                available,
                capacity: 2, // Assuming capacity of 2 for most slots
                preBooked
            });
        }
    }

    // Add a few past slots (some booked, some available)
    for (let d = 1; d <= 2; d++) { // 1 and 2 days ago
        const pastDay = addDays(now, -d);
        for (let hour = 10; hour <= 12; hour += 1) {
            const slotTime = setMinutes(setHours(pastDay, hour), 0);
            const slotId = `past_${pastDay.toISOString().split('T')[0]}_${hour.toString().padStart(2, '0')}00`;

            let isBooked = Math.random() < 0.5;
            let bookedBy = isBooked ? members[Math.floor(Math.random() * members.length)].uid : null;
            let available = !isBooked;

            slots.push({
                id: slotId,
                timestamp: admin.firestore.Timestamp.fromDate(slotTime),
                time: `${hour.toString().padStart(2, '0')}:00`,
                isBooked,
                bookedBy,
                available,
                capacity: 2,
                preBooked: false
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
    // Find some slots that are "booked" and we can pretend are "full"
    const potentialFullSlots = slots.filter(s => s.isBooked && s.capacity === 2 && s.bookedBy !== members.find(m => m.email === adminEmail)?.uid && (s.timestamp.toDate() > now));

    for (let i = 0; i < Math.min(5, potentialFullSlots.length); i++) { // Add up to 5 waiting lists
        const slot = potentialFullSlots[i];
        const usersOnWaitingList = [];
        const numUsersOnList = Math.floor(Math.random() * 3) + 1; // 1 to 3 users

        // Ensure users are not the one who booked the slot
        const potentialWaiters = members.filter(m => m.uid !== slot.bookedBy);

        for (let j = 0; j < numUsersOnList; j++) {
            if (potentialWaiters.length > 0) {
                const randomWaiter = potentialWaiters.splice(Math.floor(Math.random() * potentialWaiters.length), 1)[0];
                usersOnWaitingList.push(randomWaiter.uid);
            }
        }

        if (usersOnWaitingList.length > 0) {
            const waitingListId = `${slot.id}`; // Use slot ID as waiting list ID
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


    // --- 5. Matches ---
    const matches = [];
    const numMatches = 15;

    for (let i = 0; i < numMatches; i++) {
        const randomSlot = slots[Math.floor(Math.random() * slots.length)];
        const team1Player1 = members[Math.floor(Math.random() * members.length)].uid;
        let team1Player2 = null;
        let team2Player1 = null;
        let team2Player2 = null;

        // Ensure unique players within the match by filtering available players
        let availablePlayersForMatch = members.filter(m => m.uid !== team1Player1);

        const gameType = Math.random() < 0.5 ? 'Singles' : 'Doubles';

        if (gameType === 'Singles') {
            if (availablePlayersForMatch.length < 1) continue;
            team2Player1 = availablePlayersForMatch[Math.floor(Math.random() * availablePlayersForMatch.length)].uid;
        } else { // Doubles
            if (availablePlayersForMatch.length < 3) continue; // Not enough players for doubles
            team1Player2 = availablePlayersForMatch.splice(Math.floor(Math.random() * availablePlayersForMatch.length), 1)[0].uid;
            team2Player1 = availablePlayersForMatch.splice(Math.floor(Math.random() * availablePlayersForMatch.length), 1)[0].uid;
            team2Player2 = availablePlayersForMatch.splice(Math.floor(Math.random() * availablePlayersForMatch.length), 1)[0].uid;
        }

        const team1 = [team1Player1, team1Player2].filter(Boolean);
        const team2 = [team2Player1, team2Player2].filter(Boolean);

        // Ensure team2 has players if it's a singles game, otherwise skip if issues with player selection
        if (gameType === 'Singles' && team2.length === 0) continue;
        if (gameType === 'Doubles' && (team1.length < 2 || team2.length < 2)) continue;

        const statuses = ['confirmed', 'pending_confirmation', 'pending_score', 'rejected'];
        const status = statuses[Math.floor(Math.random() * statuses.length)];

        let scores = { team1: null, team2: null };
        if (status === 'confirmed') {
            scores = {
                team1: Math.floor(Math.random() * 21),
                team2: Math.floor(Math.random() * 21)
            };
            while (scores.team1 === scores.team2) { // Ensure scores are not equal
                scores.team2 = Math.floor(Math.random() * 21);
            }
        }

        let confirmedBy = [];
        if (status === 'confirmed' || status === 'pending_score') {
            confirmedBy = [...team1, ...team2];
        } else if (status === 'pending_confirmation') {
            confirmedBy = [team1[0]];
        }

        const createdBy = team1[0];

        matches.push({
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
            rejectedBy: status === 'rejected' ? members.find(m => m.email === adminEmail)?.uid : null, // Admin rejects
            rejectedAt: status === 'rejected' ? admin.firestore.FieldValue.serverTimestamp() : null,
            submittedBy: status === 'confirmed' ? members.find(m => m.email === adminEmail)?.uid : null, // Admin submits score
            submittedAt: status === 'confirmed' ? admin.firestore.FieldValue.serverTimestamp() : null
        });
    }

    matches.forEach(match => {
        const matchRef = db.collection(`artifacts/${appId}/public/data/matches`).doc();
        batch.set(matchRef, match);
    });
    console.log(`${matches.length} matches added.`);


    // --- Commit Batch ---
    try {
        await batch.commit();
        console.log("Firestore dummy data population complete!");
    } catch (error) {
        console.error("Error committing Firestore batch:", error);
    }
};

populateData().catch(console.error);