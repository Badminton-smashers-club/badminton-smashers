// firestore-dummy-data-seeder.js

// This script generates dummy data for your Firestore database.
// It creates:
// 1. Dummy users (public and private profiles)
// 2. Dummy matches referencing these users
// 3. Dummy booking slots, some booked by dummy users for future game days

// --- Setup Instructions ---
// 1. Ensure you have Node.js installed.
// 2. In your project's root directory (or a new 'scripts' directory), run:
//    npm init -y
//    npm install firebase-admin uuid
// 3. Go to your Firebase Console -> Project settings -> Service accounts.
// 4. Click "Generate new private key" and download the JSON file.
// 5. Place this JSON file in the same directory as this script (e.g., 'serviceAccountKey.json').
// 6. Replace 'YOUR_FIREBASE_APP_ID' below with your actual Firebase App ID
//    (found in your App.js firebaseConfig, or Firebase Console -> Project settings -> General -> Your apps -> Web app -> App ID).
// 7. Run the script: node firestore-dummy-data-seeder.js

const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid'); // For generating unique IDs

// --- IMPORTANT: REPLACE WITH YOUR ACTUAL VALUES ---
// Path to your Firebase service account key JSON file
// Ensure this file is named 'serviceAccountKey.json' and is in the same directory as this script
const serviceAccount = require('./serviceAccountKey.json');

// Your Firebase App ID (e.g., "1:743415345915:web:d8d04bcdce55b8848db65e")
const APP_ID = "YOUR_FIREBASE_APP_ID";
// --- END IMPORTANT ---

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- Helper to generate a random user ID (simulating Firebase Auth UID) ---
// In a real scenario, these would come from actual Firebase Auth user creations.
const generateDummyUid = () => uuidv4().replace(/-/g, '').substring(0, 28); // Firebase UIDs are 28 chars

async function seedDatabase() {
  console.log("Starting Firestore dummy data seeding...");

  const batch = db.batch();
  const dummyUsers = []; // To store generated UIDs for matches/slots

  // --- Define your pre-filled players here ---
  // If you have actual Firebase UIDs for these players (e.g., from manual registration),
  // replace generateDummyUid() with their actual UID string.
  // Example: { uid: "actual_firebase_uid_for_player_x", name: "Player X", email: "playerx@example.com", role: "member" }
  const preFilledPlayers = [
    { uid: generateDummyUid(), name: "Alice Player", email: "alice.player@example.com", role: "member" },
    { uid: generateDummyUid(), name: "Bob Player", email: "bob.player@example.com", role: "member" },
    { uid: generateDummyUid(), name: "Charlie Player", email: "charlie.player@example.com", role: "member" },
    { uid: generateDummyUid(), name: "David Player", email: "david.player@example.com", role: "member" },
    { uid: generateDummyUid(), name: "Eve Player", email: "eve.player@example.com", role: "member" },
    { uid: generateDummyUid(), name: "Frank Player", email: "frank.player@example.com", role: "member" },
    { uid: generateDummyUid(), name: "Grace Player", email: "grace.player@example.com", role: "member" },
    { uid: generateDummyUid(), name: "Heidi Player", email: "heidi.player@example.com", role: "member" },
    // Add more players as needed based on your pre-filled list
  ];

  // Add pre-filled players to the main dummyUsers array
  dummyUsers.push(...preFilledPlayers);

  // --- 1. Create Dummy Users (Public and Private Profiles) ---
  console.log("\nCreating dummy users...");
  // Create additional random users if you want more variety beyond pre-filled ones
  // const numAdditionalUsers = 2; // Example: Add 2 more random users
  // for (let i = 0; i < numAdditionalUsers; i++) {
  //   const uid = generateDummyUid();
  //   const name = `Random Player ${String.fromCharCode(73 + i)}`; // E.g., I, J...
  //   const email = `random.player${i}@example.com`;
  //   const role = 'member';
  //   dummyUsers.push({ uid, name, email, role });
  // }

  // Now, create Firestore documents for all dummy users (pre-filled + random)
  for (const user of dummyUsers) {
    // Public User Profile
    const publicUserRef = db.doc(`artifacts/${APP_ID}/public/data/users/${user.uid}`);
    batch.set(publicUserRef, {
      firebaseAuthUid: user.uid,
      name: user.name,
      email: user.email,
      role: user.role,
      eloRating: 1000 + Math.floor(Math.random() * 200) - 100, // Vary Elo slightly
      gamesPlayed: Math.floor(Math.random() * 50),
      balance: Math.floor(Math.random() * 100) - 50, // Some positive, some negative
      scores: [], // Will be updated by match confirmation in real app
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Private User Profile
    const privateUserRef = db.doc(`artifacts/${APP_ID}/users/${user.uid}/profile/data`);
    batch.set(privateUserRef, {
      firebaseAuthUid: user.uid,
      name: user.name,
      email: user.email,
      balance: 0, // Reset balance for private, public is authoritative for display
      eloRating: 1000, // Reset Elo for private, public is authoritative for display
      gamesPlayed: 0, // Reset gamesPlayed for private, public is authoritative for display
      scores: [], // Will be updated by match confirmation in real app
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  console.log(`Created ${dummyUsers.length} dummy users (including pre-filled).`);

  // --- 2. Create Dummy Matches ---
  console.log("\nCreating dummy matches...");
  const numMatches = 10;
  // Ensure we have at least 4 players for doubles matches
  if (dummyUsers.length < 4) {
      console.warn("Not enough dummy users to create diverse matches. Consider increasing numAdditionalUsers or preFilledPlayers.");
  }

  const shuffleArray = (array) => { // Helper for shuffling arrays
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  };

  for (let i = 0; i < numMatches; i++) {
    const team1Players = [];
    const team2Players = [];

    // Ensure unique players for each team
    const availablePlayersForMatch = [...dummyUsers];
    shuffleArray(availablePlayersForMatch);

    // Pick players for team 1 (1 or 2 players)
    const numTeam1 = Math.random() > 0.5 && availablePlayersForMatch.length >= 2 ? 2 : 1;
    for (let j = 0; j < numTeam1; j++) {
      team1Players.push(availablePlayersForMatch.shift().uid); // Use shift to remove from array
    }

    // Pick players for team 2 (1 or 2 players, matching team 1 size if possible)
    const numTeam2 = numTeam1 === 1 ? 1 : (Math.random() > 0.5 && availablePlayersForMatch.length >= 2 ? 2 : 1);
    for (let j = 0; j < numTeam2; j++) {
      if (availablePlayersForMatch.length > 0) {
        team2Players.push(availablePlayersForMatch.shift().uid);
      } else {
        // Fallback if not enough unique players for doubles (shouldn't happen with enough users)
        team2Players.push(dummyUsers[Math.floor(Math.random() * dummyUsers.length)].uid);
      }
    }

    const score1 = Math.floor(Math.random() * 22); // Max 21, but allow slightly higher for variety
    const score2 = Math.floor(Math.random() * 22);
    const status = Math.random() > 0.7 ? 'confirmed' : 'pending_confirmation'; // Some confirmed, some pending
    const addedBy = dummyUsers[Math.floor(Math.random() * dummyUsers.length)].uid;
    const confirmedBy = status === 'confirmed' ? [team2Players[0]] : []; // Opponent confirms if status is confirmed

    // Generate a date within the last 30 days
    const randomDaysAgo = Math.floor(Math.random() * 30);
    const matchDate = new Date();
    matchDate.setDate(matchDate.getDate() - randomDaysAgo);
    const formattedDate = matchDate.toISOString().split('T')[0]; // YYYY-MM-DD

    const matchRef = db.collection(`artifacts/${APP_ID}/public/data/matches`).doc();
    batch.set(matchRef, {
      date: formattedDate,
      team1: team1Players,
      team2: team2Players,
      score1: score1,
      score2: score2,
      addedBy: addedBy,
      confirmedBy: confirmedBy,
      status: status,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  console.log(`Created ${numMatches} dummy matches.`);

  // --- 3. Create Dummy Slots with Pre-booked Players for Future Game Days ---
  console.log("\nCreating dummy slots...");
  const numFutureDays = 7; // Generate slots for the next 7 days
  const slotsPerDay = 3; // Number of slots per day
  const courts = ['Court 1', 'Court 2', 'Court 3'];
  const times = ['18:00', '19:00', '20:00']; // Common evening game times

  for (let d = 0; d < numFutureDays; d++) {
    const slotDate = new Date();
    slotDate.setDate(slotDate.getDate() + d + 1); // Start from tomorrow
    const formattedDate = slotDate.toISOString().split('T')[0];

    for (let s = 0; s < slotsPerDay; s++) {
      const court = courts[Math.floor(Math.random() * courts.length)];
      const time = times[Math.floor(Math.random() * times.length)];
      const maxPlayers = Math.random() > 0.5 ? 4 : 2; // Some singles courts, some doubles

      const bookedBy = [];
      let status = 'available';

      // Prioritize booking by pre-filled players
      const playersToBook = [...preFilledPlayers]; // Use a fresh copy
      shuffleArray(playersToBook); // Shuffle for random selection

      // Book a certain number of players from the pre-filled list
      // Ensure we don't try to book more players than available or maxPlayers
      const numToBook = Math.min(maxPlayers, Math.floor(Math.random() * (playersToBook.length + 1))); // Book 0 to maxPlayers, or up to available players
      for (let i = 0; i < numToBook; i++) {
        if (playersToBook.length > 0) {
          bookedBy.push(playersToBook.shift().uid); // Use shift to remove from array
        }
      }

      if (bookedBy.length > 0) {
        status = bookedBy.length === maxPlayers ? 'fully_booked' : 'partially_booked';
      }

      const slotRef = db.collection(`artifacts/${APP_ID}/public/data/slots`).doc();
      batch.set(slotRef, {
        date: formattedDate,
        time: time,
        court: court,
        maxPlayers: maxPlayers,
        bookedBy: bookedBy,
        status: status,
        isRecurring: false,
        originalSlotRef: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
  console.log(`Created ${numFutureDays * slotsPerDay} dummy slots for future days.`);

  // Commit the batch
  try {
    await batch.commit();
    console.log("\nAll dummy data committed successfully!");
  } catch (error) {
    console.error("Error committing batch:", error);
  }
}

// Run the seeding function
seedDatabase().catch(console.error);
