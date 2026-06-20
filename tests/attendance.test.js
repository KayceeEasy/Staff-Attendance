/**
 * Unit tests for Staff Attendance core logic module.
 */

const {
    CLOUD_URL,
    getFingerprint,
    buildPayload,
    validateSubmission,
    handleGeoSuccess,
    submitAttendance,
    loadSavedName,
    saveName
} = require('../src/attendance');

describe('getFingerprint', () => {
    beforeEach(() => {
        Object.defineProperty(global.navigator, 'userAgent', {
            value: 'Mozilla/5.0 TestAgent',
            configurable: true
        });
        Object.defineProperty(global.navigator, 'hardwareConcurrency', {
            value: 4,
            configurable: true
        });
        Object.defineProperty(global.screen, 'width', {
            value: 1920,
            configurable: true
        });
        Object.defineProperty(global.screen, 'height', {
            value: 1080,
            configurable: true
        });
    });

    test('returns a string starting with "id-"', () => {
        const fp = getFingerprint();
        expect(fp).toMatch(/^id-/);
    });

    test('returns a consistent value for the same environment', () => {
        const fp1 = getFingerprint();
        const fp2 = getFingerprint();
        expect(fp1).toBe(fp2);
    });

    test('produces a fingerprint of expected length (id- + 16 chars)', () => {
        const fp = getFingerprint();
        expect(fp.length).toBe(3 + 16); // "id-" (3) + 16 base64 chars
    });

    test('produces different fingerprints for different user agents', () => {
        const fp1 = getFingerprint();

        Object.defineProperty(global.navigator, 'userAgent', {
            value: 'DifferentAgent/2.0',
            configurable: true
        });
        const fp2 = getFingerprint();

        expect(fp1).not.toBe(fp2);
    });

    test('fingerprint uses base64 encoding of device signature', () => {
        const fp = getFingerprint();
        // After removing "id-" prefix, the remainder should be valid base64 chars
        const encoded = fp.slice(3);
        expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    });

    test('fingerprint is deterministic for same navigator/screen values', () => {
        const results = new Set();
        for (let i = 0; i < 10; i++) {
            results.add(getFingerprint());
        }
        expect(results.size).toBe(1);
    });
});

describe('buildPayload', () => {
    test('returns a valid JSON string with all fields', () => {
        const result = buildPayload('Uche', 'id-abc123', 'IN', { lat: 6.5, lon: 3.4 });
        const parsed = JSON.parse(result);
        expect(parsed).toEqual({
            name: 'Uche',
            deviceId: 'id-abc123',
            action: 'IN',
            lat: 6.5,
            lon: 3.4
        });
    });

    test('handles OUT action', () => {
        const result = buildPayload('Julianah', 'id-xyz789', 'OUT', { lat: 7.0, lon: 4.0 });
        const parsed = JSON.parse(result);
        expect(parsed.action).toBe('OUT');
        expect(parsed.name).toBe('Julianah');
    });

    test('handles negative coordinates', () => {
        const result = buildPayload('Kenneth', 'id-neg', 'IN', { lat: -33.8, lon: -151.2 });
        const parsed = JSON.parse(result);
        expect(parsed.lat).toBe(-33.8);
        expect(parsed.lon).toBe(-151.2);
    });

    test('handles zero coordinates', () => {
        const result = buildPayload('Martha', 'id-zero', 'IN', { lat: 0, lon: 0 });
        const parsed = JSON.parse(result);
        expect(parsed.lat).toBe(0);
        expect(parsed.lon).toBe(0);
    });
});

describe('validateSubmission', () => {
    const validCoords = { lat: 6.5, lon: 3.4 };

    test('returns null for valid inputs', () => {
        expect(validateSubmission('Uche', validCoords)).toBeNull();
    });

    test('returns error when name is empty string', () => {
        expect(validateSubmission('', validCoords)).toBe("Select your name");
    });

    test('returns error when name is null', () => {
        expect(validateSubmission(null, validCoords)).toBe("Select your name");
    });

    test('returns error when name is undefined', () => {
        expect(validateSubmission(undefined, validCoords)).toBe("Select your name");
    });

    test('returns error when coords is null', () => {
        expect(validateSubmission('Uche', null)).toBe("Location not available");
    });

    test('returns error when coords is undefined', () => {
        expect(validateSubmission('Uche', undefined)).toBe("Location not available");
    });

    test('returns error when lat is not a number', () => {
        expect(validateSubmission('Uche', { lat: 'bad', lon: 3.4 })).toBe("Invalid coordinates");
    });

    test('returns error when lon is not a number', () => {
        expect(validateSubmission('Uche', { lat: 6.5, lon: null })).toBe("Invalid coordinates");
    });

    test('accepts zero as valid coordinate', () => {
        expect(validateSubmission('Uche', { lat: 0, lon: 0 })).toBeNull();
    });

    test('name priority: checks name before coords', () => {
        expect(validateSubmission('', null)).toBe("Select your name");
    });
});

describe('handleGeoSuccess', () => {
    test('extracts lat/lon from position object', () => {
        const position = {
            coords: { latitude: 6.5244, longitude: 3.3792 }
        };
        const result = handleGeoSuccess(position);
        expect(result).toEqual({ lat: 6.5244, lon: 3.3792 });
    });

    test('handles negative coordinates', () => {
        const position = {
            coords: { latitude: -33.8688, longitude: 151.2093 }
        };
        const result = handleGeoSuccess(position);
        expect(result).toEqual({ lat: -33.8688, lon: 151.2093 });
    });

    test('handles zero coordinates', () => {
        const position = {
            coords: { latitude: 0, longitude: 0 }
        };
        const result = handleGeoSuccess(position);
        expect(result).toEqual({ lat: 0, lon: 0 });
    });

    test('handles high precision coordinates', () => {
        const position = {
            coords: { latitude: 6.524379123456, longitude: 3.379205987654 }
        };
        const result = handleGeoSuccess(position);
        expect(result.lat).toBeCloseTo(6.524379123456, 10);
        expect(result.lon).toBeCloseTo(3.379205987654, 10);
    });
});

describe('submitAttendance', () => {
    const validCoords = { lat: 6.5, lon: 3.4 };
    const deviceId = 'id-test123';

    test('returns success when fetch resolves', async () => {
        const mockFetch = jest.fn().mockResolvedValue({ ok: true });
        const result = await submitAttendance('Uche', deviceId, 'IN', validCoords, mockFetch);
        expect(result).toEqual({ success: true });
    });

    test('calls fetch with correct URL and options', async () => {
        const mockFetch = jest.fn().mockResolvedValue({ ok: true });
        await submitAttendance('Uche', deviceId, 'IN', validCoords, mockFetch);

        expect(mockFetch).toHaveBeenCalledWith(CLOUD_URL, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify({
                name: 'Uche',
                deviceId,
                action: 'IN',
                lat: 6.5,
                lon: 3.4
            })
        });
    });

    test('returns error when fetch throws', async () => {
        const mockFetch = jest.fn().mockRejectedValue(new Error('Network failure'));
        const result = await submitAttendance('Uche', deviceId, 'IN', validCoords, mockFetch);
        expect(result).toEqual({
            success: false,
            error: "Connection Error",
            details: "Network failure"
        });
    });

    test('returns validation error when name is empty', async () => {
        const mockFetch = jest.fn();
        const result = await submitAttendance('', deviceId, 'IN', validCoords, mockFetch);
        expect(result).toEqual({ success: false, error: "Select your name" });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    test('returns validation error when coords missing', async () => {
        const mockFetch = jest.fn();
        const result = await submitAttendance('Uche', deviceId, 'IN', null, mockFetch);
        expect(result).toEqual({ success: false, error: "Location not available" });
        expect(mockFetch).not.toHaveBeenCalled();
    });

    test('handles OUT action correctly', async () => {
        const mockFetch = jest.fn().mockResolvedValue({ ok: true });
        const result = await submitAttendance('Julianah', deviceId, 'OUT', validCoords, mockFetch);
        expect(result).toEqual({ success: true });

        const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
        expect(payload.action).toBe('OUT');
    });

    test('does not call fetch when validation fails', async () => {
        const mockFetch = jest.fn();
        await submitAttendance('', deviceId, 'IN', validCoords, mockFetch);
        await submitAttendance('Uche', deviceId, 'IN', null, mockFetch);
        expect(mockFetch).not.toHaveBeenCalled();
    });
});

describe('loadSavedName', () => {
    test('returns saved name from storage', () => {
        const mockStorage = { getItem: jest.fn().mockReturnValue('Uche') };
        expect(loadSavedName(mockStorage)).toBe('Uche');
        expect(mockStorage.getItem).toHaveBeenCalledWith('saved_name');
    });

    test('returns empty string when no name saved', () => {
        const mockStorage = { getItem: jest.fn().mockReturnValue(null) };
        expect(loadSavedName(mockStorage)).toBe('');
    });

    test('returns empty string when storage returns undefined', () => {
        const mockStorage = { getItem: jest.fn().mockReturnValue(undefined) };
        expect(loadSavedName(mockStorage)).toBe('');
    });
});

describe('saveName', () => {
    test('saves name to storage', () => {
        const mockStorage = { setItem: jest.fn() };
        saveName(mockStorage, 'Esther');
        expect(mockStorage.setItem).toHaveBeenCalledWith('saved_name', 'Esther');
    });

    test('saves empty string', () => {
        const mockStorage = { setItem: jest.fn() };
        saveName(mockStorage, '');
        expect(mockStorage.setItem).toHaveBeenCalledWith('saved_name', '');
    });
});

describe('CLOUD_URL', () => {
    test('is defined and is a valid Google Apps Script URL', () => {
        expect(CLOUD_URL).toBeDefined();
        expect(CLOUD_URL).toMatch(/^https:\/\/script\.google\.com\/macros\/s\//);
    });

    test('ends with /exec', () => {
        expect(CLOUD_URL).toMatch(/\/exec$/);
    });
});
