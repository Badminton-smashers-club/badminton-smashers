// createAllDummyData.js
// Run this script from your terminal: node createAllDummyData.js

const admin = require('firebase-admin');

// --- Emulator Configuration ---
// These environment variables tell the Admin SDK to connect to the emulators.
// Ensure your emulators are running (firebase emulators:start) before running this script.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

// Initialize Firebase Admin SDK
// IMPORTANT: Ensure you provide the projectId here
admin.initializeApp({
    projectId: 'smashers-badminton' // <<< MAKE SURE THIS MATCHES YOUR REAL APP_ID/PROJECT_ID
});

const db = admin.firestore();
const auth = admin.auth();

// --- IMPORTANT: Replace with your actual app ID ---
const APP_ID = 'smashers-badminton'; // <<< Ensure this matches your REACT_APP_FIREBASE_PROJECT_ID

// Global array to store created user UIDs and their roles/names for later use in slots/matches
const createdUsers = [];

/**
 * Creates dummy users in Firebase Auth and their Firestore profiles.
 */
async function createDummyUsers() {
    console.log('\n--- Creating Dummy Users ---');

    const usersToCreate = [
        {
            email: 'admin@example.com',
            password: 'password123',
            displayName: 'Admin User',
            role: 'admin',
            initialBalance: 100,
            initialElo: 1500
        },
        {
            email: 'alice@example.com',
            password: 'password123',
            displayName: 'Alice Smith',
            role: 'member',
            initialBalance: 50,
            initialElo: 1200
        },
        {
            email: 'bob@example.com',
            password: 'password123',
            displayName: 'Bob Johnson',
            role: 'member',
            initialBalance: 20,
            initialElo: 1100
        },
        {
            email: 'charlie@example.com',
            password: 'password123',
            displayName: 'Charlie Brown',
            role: 'member',
            initialBalance: 0, // A user with no balance for testing
            initialElo: 1050
        }
    ];

    for (const userData of usersToCreate) {
        try {
            // 1. Create user in Firebase Authentication
            let uid;
            try {
                const userRecord = await auth.getUserByEmail(userData.email);
                uid = userRecord.uid;
                console.warn(`Auth user ${userData.email} already exists. Using existing UID: ${uid}`);
            } catch (error) {
                if (error.code === 'auth/user-not-found') {
                    const userRecord = await auth.createUser({
                        email: userData.email,
                        password: userData.password,
                        displayName: userData.displayName,
                        emailVerified: true, // Mark as verified for easier testing
                    });
                    uid = userRecord.uid;
                    console.log(`Created Auth user: ${userData.email} (UID: ${uid})`);
                } else {
                    throw error; // Re-throw other auth errors
                }
            }

            // Store user info globally for later use
            createdUsers.push({ uid, ...userData });

            // 2. Create or update public user profile in Firestore
            const publicUserRef = db.collection(`artifacts/${APP_ID}/public/data/users`).doc(uid);
            await publicUserRef.set({
                firebaseAuthUid: uid, // Store Auth UID in Firestore document
                name: userData.displayName,
                email: userData.email,
                role: userData.role,
                balance: userData.initialBalance,
                eloRating: userData.initialElo,
                gamesPlayed: 0,
                profilePicUrl: '', // Default empty
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastGameDate: null,
            }, { merge: true }); // Use merge to update if exists, create if not
            console.log(`Created/Updated public profile for ${userData.displayName}`);

            // 3. Create or update private user profile in Firestore
            // *** FIX APPLIED HERE ***
            const privateUserRef = db.doc(`artifacts/${APP_ID}/users/${uid}/profile/data`); // Directly target the document
            await privateUserRef.set({
                firebaseAuthUid: uid, // Required by security rules
                name: userData.displayName,
                email: userData.email,
                balance: userData.initialBalance,
                eloRating: userData.initialElo,
                scores: [],
                gamesPlayed: 0,
                hasMadeFirstBooking: false,
                lastTopUpTimestamp: null,
                fcmToken: '', // Default empty
            }, { merge: true });
            console.log(`Created/Updated private profile for ${userData.displayName}`);

        } catch (error) {
            console.error(`Error processing user ${userData.email}:`, error);
        }
    }
    console.log('--- Dummy Users Created ---');
}

/**
 * Creates dummy slots in Firestore.
 */
async function createDummySlots() {
    console.log('\n--- Creating Dummy Slots ---');
    const slotsCollectionRef = db.collection(`artifacts/${APP_ID}/public/data/slots`);

    // Check if any slots already exist to prevent excessive duplication
    const existingSlotsSnapshot = await slotsCollectionRef.limit(1).get();
    if (!existingSlotsSnapshot.empty) {
        console.log('Dummy slots already exist. Skipping creation.');
        return;
    }

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dayAfterTomorrow = new Date(today);
    dayAfterTomorrow.setDate(today.getDate() + 2);

    const formatDateToISO = (date, time) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}T${time}:00.000Z`;
    };

    const slotsToCreate = [
        // Today's slots
        { dateTime: formatDateToISO(today, '10:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '11:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '12:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '13:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '14:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '15:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '16:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '17:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '18:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '19:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '20:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(today, '21:00'), isBooked: false, bookedBy: null },

        // Tomorrow's slots
        { dateTime: formatDateToISO(tomorrow, '10:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '11:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '12:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '13:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '14:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '15:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '16:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '17:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '18:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '19:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '20:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(tomorrow, '21:00'), isBooked: false, bookedBy: null },

        // Day after tomorrow's slots
        { dateTime: formatDateToISO(dayAfterTomorrow, '10:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '11:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '12:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '13:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '14:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '15:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '16:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '17:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '18:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '19:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '20:00'), isBooked: false, bookedBy: null },
        { dateTime: formatDateToISO(dayAfterTomorrow, '21:00'), isBooked: false, bookedBy: null },
    ];

    for (const slotData of slotsToCreate) {
        try {
            await slotsCollectionRef.add(slotData);
            // console.log(`Added slot: ${slotData.dateTime}`); // Too verbose, uncomment for detailed logging
        } catch (error) {
            console.error(`Error adding slot ${slotData.dateTime}:`, error);
        }
    }
    console.log('--- Dummy Slots Created ---');
}

/**
 * Creates dummy matches in Firestore.
 */
async function createDummyMatches() {
    console.log('\n--- Creating Dummy Matches ---');
    const matchesCollectionRef = db.collection(`artifacts/${APP_ID}/public/data/matches`);

    // Check if any matches already exist to prevent excessive duplication
    const existingMatchesSnapshot = await matchesCollectionRef.limit(1).get();
    if (!existingMatchesSnapshot.empty) {
        console.log('Dummy matches already exist. Skipping creation.');
        return;
    }

    // Ensure we have enough users to form teams
    if (createdUsers.length < 2) {
        console.warn('Not enough dummy users created to form matches. Skipping match creation.');
        return;
    }

    const alice = createdUsers.find(u => u.email === 'alice@example.com');
    const bob = createdUsers.find(u => u.email === 'bob@example.com');
    const charlie = createdUsers.find(u => u.email === 'charlie@example.com');
    const adminUser = createdUsers.find(u => u.email === 'admin@example.com');

    // Get today's date for match dates
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(today.getDate() - 2);

    const formatDate = (date) => date.toISOString().split('T')[0];
    const formatTime = (date) => date.toTimeString().split(' ')[0].substring(0, 5);

    const matchesToCreate = [];

    if (alice && bob && charlie && adminUser) {
        // Confirmed match (yesterday) - Alice & Charlie vs Bob
        matchesToCreate.push({
            date: formatDate(yesterday),
            time: formatTime(yesterday), // Use actual time for sorting
            team1: [alice.uid, charlie.uid],
            team2: [bob.uid],
            score1: 21,
            score2: 18,
            addedBy: adminUser.uid, // Admin added for testing
            status: 'confirmed',
            confirmedBy: [alice.uid, bob.uid, charlie.uid, adminUser.uid], // All confirmed
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            players: [alice.uid, bob.uid, charlie.uid], // For array-contains query
            eloChanges: [] // Will be populated by Cloud Function
        });

        // Pending match (today) - Alice vs Bob (added by Alice, needs Bob's confirmation)
        matchesToCreate.push({
            date: formatDate(today),
            time: formatTime(today),
            team1: [alice.uid],
            team2: [bob.uid],
            score1: 21,
            score2: 15,
            addedBy: alice.uid,
            status: 'pending_confirmation',
            confirmedBy: [alice.uid], // Only Alice has confirmed
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            players: [alice.uid, bob.uid],
            eloChanges: []
        });

        // Another pending match (tomorrow) - Bob vs Charlie (added by Bob, needs Charlie's confirmation)
        matchesToCreate.push({
            date: formatDate(today), // Use today for simplicity in testing filtering
            time: '16:00', // Different time
            team1: [bob.uid],
            team2: [charlie.uid],
            score1: 19,
            score2: 21,
            addedBy: bob.uid,
            status: 'pending_confirmation',
            confirmedBy: [bob.uid], // Only Bob has confirmed
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            players: [bob.uid, charlie.uid],
            eloChanges: []
        });
    } else {
        console.warn('Required dummy users (Alice, Bob, Charlie, Admin) not found. Skipping match creation.');
    }

    for (const matchData of matchesToCreate) {
        try {
            await matchesCollectionRef.add(matchData);
            // console.log(`Added match: ${matchData.date} - ${matchData.team1.join(',')} vs ${matchData.team2.join(',')}`); // Too verbose
        } catch (error) {
            console.error(`Error adding match:`, error);
        }
    }
    console.log('--- Dummy Matches Created ---');
}

/**
 * Main function to run all data creation steps.
 */
async function runAllDataCreation() {
    try {
        await createDummyUsers();
        await createDummySlots();
        await createDummyMatches();
        console.log('\n--- All Dummy Data Creation Completed! ---');
    } catch (error) {
        console.error('An error occurred during dummy data creation:', error);
    } finally {
        process.exit(); // Exit the script process
    }
}

runAllDataCreation();