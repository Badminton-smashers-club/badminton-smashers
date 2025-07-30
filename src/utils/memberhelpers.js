// src/utils/memberHelpers.js

/**
 * Finds a member's name by their UID from a list of members.
 * @param {string} uid The Firebase Auth UID of the member.
 * @param {Array<Object>} members An array of member objects, each with 'id' (which should be firebaseAuthUid) and 'name'.
 * @returns {string} The member's name, or 'Unknown Player' if not found.
 */
export const getMemberName = (uid, members) => {
    const member = members.find(m => m.id === uid); // Assuming member.id is the firebaseAuthUid
    return member ? member.name : 'Unknown Player';
};

/**
 * Finds a member's UID by their name from a list of members.
 * @param {string} name The name of the member.
 * @param {Array<Object>} members An array of member objects, each with 'id' (which should be firebaseAuthUid) and 'name'.
 * @returns {string|null} The member's UID, or null if not found.
 */
export const getMemberUid = (name, members) => {
    const member = members.find(m => m.name === name);
    return member ? member.id : null; // Assuming member.id is the firebaseAuthUid
};
