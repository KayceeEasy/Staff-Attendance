/**
 * Staff Attendance - Core Logic Module
 * Extracted for testability.
 */

const CLOUD_URL = "https://script.google.com/macros/s/AKfycbyrj257cGtkowcqYvptTd7zchkoBtAnyDGAEpRUqCFxYn5hO21uz9EDZXn__YMTMGAqKA/exec";

/**
 * Generate a device fingerprint based on browser/device characteristics.
 * Used to identify the device making the attendance request.
 */
function getFingerprint() {
    const sig = [
        navigator.userAgent,
        screen.width,
        screen.height,
        navigator.hardwareConcurrency
    ].join('|');
    return 'id-' + btoa(sig).substr(0, 16);
}

/**
 * Build the payload object for the attendance submission.
 */
function buildPayload(name, deviceId, action, coords) {
    return JSON.stringify({
        name,
        deviceId,
        action,
        lat: coords.lat,
        lon: coords.lon
    });
}

/**
 * Validate that the required fields are present before submission.
 * Returns an error message string if invalid, or null if valid.
 */
function validateSubmission(name, coords) {
    if (!name) return "Select your name";
    if (!coords) return "Location not available";
    if (typeof coords.lat !== 'number' || typeof coords.lon !== 'number') return "Invalid coordinates";
    return null;
}

/**
 * Handle geolocation success - updates UI state.
 * Returns the parsed coordinates object.
 */
function handleGeoSuccess(position) {
    return {
        lat: position.coords.latitude,
        lon: position.coords.longitude
    };
}

/**
 * Submit attendance to the cloud endpoint.
 * Returns a promise that resolves with a result object.
 */
async function submitAttendance(name, deviceId, action, coords, fetchFn) {
    const error = validateSubmission(name, coords);
    if (error) {
        return { success: false, error };
    }

    const payload = buildPayload(name, deviceId, action, coords);

    try {
        await fetchFn(CLOUD_URL, {
            method: "POST",
            mode: "no-cors",
            body: payload
        });
        return { success: true };
    } catch (e) {
        return { success: false, error: "Connection Error", details: e.message };
    }
}

/**
 * Load saved staff name from localStorage.
 */
function loadSavedName(storage) {
    return storage.getItem('saved_name') || '';
}

/**
 * Save staff name to localStorage.
 */
function saveName(storage, name) {
    storage.setItem('saved_name', name);
}

// Export for testing (CommonJS for Jest compatibility)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CLOUD_URL,
        getFingerprint,
        buildPayload,
        validateSubmission,
        handleGeoSuccess,
        submitAttendance,
        loadSavedName,
        saveName
    };
}
