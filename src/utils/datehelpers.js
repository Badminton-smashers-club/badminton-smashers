// src/utils/dateHelpers.js
import { format } from 'date-fns';

/**
 * Formats a date/time string or Firebase Timestamp object consistently.
 * @param {string|Date|import('firebase/firestore').Timestamp} dateTimeInput The date/time string, Date object, or Firestore Timestamp.
 * @param {'date'|'time'|'full'|'default'} type The format type: 'date', 'time', 'full', or 'default' (for full date and time if time is provided).
 * @param {string} [timeString] Optional: A separate time string (e.g., "18:00") if dateTimeInput is just a date.
 * @returns {string} The formatted date/time string, or 'N/A'/'Invalid Date'.
 */
export const formatSlotDateTime = (dateTimeInput, type = 'default', timeString = '') => {
    if (!dateTimeInput) {
        return 'N/A';
    }

    let dateObj;
    if (dateTimeInput.toDate) { // Check if it's a Firestore Timestamp
        dateObj = dateTimeInput.toDate();
    } else if (typeof dateTimeInput === 'string' || typeof dateTimeInput === 'number') {
        dateObj = new Date(dateTimeInput);
    } else if (dateTimeInput instanceof Date) {
        dateObj = dateTimeInput;
    } else {
        console.error("formatSlotDateTime: Invalid dateTimeInput type", dateTimeInput);
        return 'Invalid Date';
    }

    if (isNaN(dateObj.getTime())) {
        console.error("formatSlotDateTime: Invalid Date object created from input:", dateTimeInput);
        return 'Invalid Date';
    }

    switch (type) {
        case 'date':
            return format(dateObj, 'MMM dd, yyyy');
        case 'time':
            return timeString || format(dateObj, 'HH:mm'); // Use timeString if provided, otherwise format from dateObj
        case 'full':
            return format(dateObj, 'MMM dd, yyyy HH:mm');
        case 'default': // For combined date and time
            return `${format(dateObj, 'MMM dd, yyyy')} ${timeString ? `- ${timeString}` : ''}`;
        default:
            return 'N/A';
    }
};
