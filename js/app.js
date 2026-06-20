/**
 * Main application logic for Staff Attendance.
 * Depends on: js/utils.js (must be loaded first)
 */

const CLOUD_URL =
    'https://script.google.com/macros/s/AKfycbyrj257cGtkowcqYvptTd7zchkoBtAnyDGAEpRUqCFxYn5hO21uz9EDZXn__YMTMGAqKA/exec';

const deviceId = getFingerprint();
let coords = null;

window.onload = function () {
    lucide.createIcons();

    const savedName = localStorage.getItem('saved_name');
    if (savedName) {
        dom.staffName().value = savedName;
    }

    navigator.geolocation.getCurrentPosition(
        function (pos) {
            coords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
            setLocationStatus('ready', 'Location Ready');
            setButtonsEnabled(true);
        },
        function () {
            setLocationStatus('error', 'GPS REQUIRED');
        },
        { enableHighAccuracy: true }
    );
};

async function submit(action) {
    const name = dom.staffName().value;
    if (!name) {
        return alert('Select your name');
    }

    showMessage('Syncing...', 'loading');
    setDebugInfo('Sending ID: ' + deviceId);
    localStorage.setItem('saved_name', name);

    const payload = JSON.stringify({
        name,
        deviceId,
        action,
        lat: coords.lat,
        lon: coords.lon,
    });

    try {
        await fetch(CLOUD_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: payload,
        });
        showMessage('Success! Log sent to cloud.', 'success');
    } catch (e) {
        showMessage('Connection Error', 'error');
        setDebugInfo('Error: ' + e.message);
    }
}
