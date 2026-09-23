/**
 * Shared utilities for Perimetrr Presence Verification.
 * Loaded by index.html, admin/index.html, and related portal surfaces.
 */

const STORAGE_KEYS = {
    pendingQueue: 'attendance_pending_queue',
    recentLog: 'attendance_recent_log',
    lastSynced: 'attendance_last_synced',
    lastAction: 'attendance_last_action',
    pendingAction: 'attendance_pending_action',
    theme: 'attendance_theme',
    deviceLock: 'attendance_device_lock',
    analytics: 'attendance_analytics',
    language: 'attendance_language'
};

// Supabase Initialization
const supabaseUrl = 'https://akhditjeiwjuzvubnacw.supabase.co';
const supabaseKey = 'sb_publishable_9BkVRtmi-6UG15Va5xNHbw_R7J_hKhi';
const supabaseClient = (typeof window !== 'undefined' && window.supabase) ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;
if (typeof window !== 'undefined') {
    window.supabaseUrl = supabaseUrl;
    window.supabaseKey = supabaseKey;
    window.supabaseClient = supabaseClient;
}

/* ---------- Multi-Language Internationalization (i18n) ---------- */

const I18N_DICTIONARY = {
    en: {
        appName: "Staff Attendance",
        verifyingGps: "Verifying GPS...",
        gpsReady: "📍 GPS Ready • Select Name",
        withinPerimeter: "Within office premises",
        awayFromOffice: "Away from office",
        metersFromOffice: "meters from office",
        officeRequired: "📍 On-site (Required)",
        officeMode: "📍 Office",
        homeMode: "🏠 Home",
        flexibleMode: "🏠 Flexible / Remote",
        executiveMode: "🏠 Flexible / Remote",
        signIn: "SIGN IN",
        signOut: "SIGN OUT",
        signOutRemote: "SIGN OUT (REMOTE)",
        remoteActive: "🏠 Remote Sign-Out Active",
        selectYourName: "SELECT YOUR NAME",
        verifying: "VERIFYING...",
        pleaseWait: "PLEASE WAIT...",
        readyToSignIn: "Ready to sign in",
        readyToSignOut: "Ready to sign out",
        typeSearchName: "Type to search your name...",
        switchWorkspace: "Switch",
        connectWorkspaceTitle: "Connect to Your Workspace",
        connectWorkspaceDesc: "Enter your organization's 6-character Workspace Code or open your company's setup link to pair this phone.",
        connectWorkspaceBtn: "Connect Workspace",
        scanQrBtn: "Scan a QR Code",
        cancelScan: "Cancel Scan",
        cameraBlockedNotice: "Camera access blocked: Tap the 🔒 icon in your browser address bar to allow camera, or enter your 6-character code below.",
        tryCameraAgain: "Try Camera Again",
        switchAccount: "Change",
        deviceBound: "Linked",
        biometricsBadge: "Biometrics",
        adminLogin: "Admin Login",
        quickGuide: "Quick Guide",
        toggleTheme: "Toggle Theme",
        refresh: "Refresh",
        onLeave: "🌴 On Leave",
        completed: "COMPLETED",
        adminEmail: "Admin Email",
        password: "Password",
        logIn: "Log in",
        forgotPassword: "Forgot password?",
        backToAttendance: "← Back to attendance",
        signInSuccess: "Sign-in successful!",
        signOutSuccess: "Sign-out successful!",
        connectedTo: "Connected to",
        invalidCode: "Invalid Workspace Code. Please verify with your team administrator."
    },
    es: {
        appName: "Asistencia de Personal",
        verifyingGps: "Verificando GPS...",
        gpsReady: "📍 GPS Listo • Selecciona Nombre",
        withinPerimeter: "Dentro de la oficina",
        awayFromOffice: "Fuera de la oficina",
        metersFromOffice: "metros de la oficina",
        officeRequired: "📍 En Sitio (Obligatorio)",
        officeMode: "📍 Oficina",
        homeMode: "🏠 En Casa",
        flexibleMode: "🏠 Flexible / Remoto",
        executiveMode: "🏠 Flexible / Remoto",
        signIn: "REGISTRAR ENTRADA",
        signOut: "REGISTRAR SALIDA",
        signOutRemote: "SALIDA (REMOTO)",
        remoteActive: "🏠 Salida remota activa",
        selectYourName: "SELECCIONA TU NOMBRE",
        verifying: "VERIFICANDO...",
        pleaseWait: "ESPERE POR FAVOR...",
        readyToSignIn: "Listo para registrar entrada",
        readyToSignOut: "Listo para registrar salida",
        typeSearchName: "Escribe para buscar tu nombre...",
        switchWorkspace: "Cambiar",
        connectWorkspaceTitle: "Conéctate a tu Espacio de Trabajo",
        connectWorkspaceDesc: "Ingresa el código de 6 caracteres de tu empresa o usa el enlace de invitación para vincular este teléfono.",
        connectWorkspaceBtn: "Conectar Espacio",
        scanQrBtn: "Escanear Código QR",
        cancelScan: "Cancelar Escaneo",
        cameraBlockedNotice: "Acceso a la cámara bloqueado: toca el icono 🔒 en la barra del navegador para permitirla, o escribe tu código de 6 caracteres abajo.",
        tryCameraAgain: "Reintentar Cámara",
        switchAccount: "Cambiar",
        deviceBound: "Vinculado",
        biometricsBadge: "Biometría",
        adminLogin: "Acceso Admin",
        quickGuide: "Guía Rápida",
        toggleTheme: "Cambiar Tema",
        refresh: "Actualizar",
        onLeave: "🌴 De Permiso",
        completed: "COMPLETADO",
        adminEmail: "Correo del Administrador",
        password: "Contraseña",
        logIn: "Iniciar Sesión",
        forgotPassword: "¿Olvidaste tu contraseña?",
        backToAttendance: "← Volver a asistencia",
        signInSuccess: "¡Entrada registrada con éxito!",
        signOutSuccess: "¡Salida registrada con éxito!",
        connectedTo: "Conectado a",
        invalidCode: "Código de espacio de trabajo inválido. Consulta con tu administrador."
    },
    fr: {
        appName: "Présence du Personnel",
        verifyingGps: "Vérification GPS...",
        gpsReady: "📍 GPS Prêt • Sélectionnez Votre Nom",
        withinPerimeter: "Dans les locaux du bureau",
        awayFromOffice: "Hors du bureau",
        metersFromOffice: "mètres du bureau",
        officeRequired: "📍 Sur Site (Obligatoire)",
        officeMode: "📍 Bureau",
        homeMode: "🏠 Télétravail",
        flexibleMode: "🏠 Flexible / Télétravail",
        executiveMode: "🏠 Flexible / Télétravail",
        signIn: "ENREGISTRER L'ARRIVÉE",
        signOut: "ENREGISTRER LE DÉPART",
        signOutRemote: "DÉPART (À DISTANCE)",
        remoteActive: "🏠 Départ à distance actif",
        selectYourName: "SÉLECTIONNEZ VOTRE NOM",
        verifying: "VÉRIFICATION...",
        pleaseWait: "VEUILLEZ PATIENTER...",
        readyToSignIn: "Prêt pour l'arrivée",
        readyToSignOut: "Prêt pour le départ",
        typeSearchName: "Tapez pour chercher votre nom...",
        switchWorkspace: "Changer",
        connectWorkspaceTitle: "Connectez-vous à votre Espace",
        connectWorkspaceDesc: "Saisissez le code d'entreprise à 6 caractères ou ouvrez le lien d'invitation pour jumeler ce téléphone.",
        connectWorkspaceBtn: "Rejoindre l'Espace",
        scanQrBtn: "Scanner un QR Code",
        cancelScan: "Annuler le Scan",
        cameraBlockedNotice: "Accès caméra bloqué : appuyez sur l'icône 🔒 dans votre barre d'adresse pour l'autoriser, ou saisissez votre code ci-dessous.",
        tryCameraAgain: "Réessayer la Caméra",
        switchAccount: "Changer",
        deviceBound: "Lié",
        biometricsBadge: "Biométrie",
        adminLogin: "Accès Admin",
        quickGuide: "Guide Rapide",
        toggleTheme: "Changer de Thème",
        refresh: "Actualiser",
        onLeave: "🌴 En Congé",
        completed: "TERMINÉ",
        adminEmail: "E-mail Administrateur",
        password: "Mot de passe",
        logIn: "Se connecter",
        forgotPassword: "Mot de passe oublié ?",
        backToAttendance: "← Retour à la présence",
        signInSuccess: "Arrivée enregistrée avec succès !",
        signOutSuccess: "Départ enregistré avec succès !",
        connectedTo: "Connecté à",
        invalidCode: "Code d'espace invalide. Veuillez vérifier auprès de votre administrateur."
    },
    pt: {
        appName: "Presença de Funcionários",
        verifyingGps: "Verificando GPS...",
        gpsReady: "📍 GPS Pronto • Selecione Seu Nome",
        withinPerimeter: "Dentro do escritório",
        awayFromOffice: "Fora do escritório",
        metersFromOffice: "metros do escritório",
        officeRequired: "📍 No Local (Obrigatório)",
        officeMode: "📍 Escritório",
        homeMode: "🏠 Home Office",
        flexibleMode: "🏠 Flexível / Remoto",
        executiveMode: "🏠 Flexível / Remoto",
        signIn: "REGISTRAR ENTRADA",
        signOut: "REGISTRAR SAÍDA",
        signOutRemote: "SAÍDA (REMOTO)",
        remoteActive: "🏠 Saída remota ativa",
        selectYourName: "SELECIONE SEU NOME",
        verifying: "VERIFICANDO...",
        pleaseWait: "POR FAVOR, AGUARDE...",
        readyToSignIn: "Pronto para registrar entrada",
        readyToSignOut: "Pronto para registrar saída",
        typeSearchName: "Digite para buscar seu nome...",
        switchWorkspace: "Trocar",
        connectWorkspaceTitle: "Conecte-se ao seu Espaço",
        connectWorkspaceDesc: "Insira o código de 6 caracteres da sua empresa ou use o link de convite para emparelhar este celular.",
        connectWorkspaceBtn: "Conectar Espaço",
        scanQrBtn: "Escanear Código QR",
        cancelScan: "Cancelar Leitura",
        cameraBlockedNotice: "Acesso à câmera bloqueado: toque no ícone 🔒 na barra de endereço para permitir, ou digite seu código de 6 dígitos abaixo.",
        tryCameraAgain: "Tentar Câmera Novamente",
        switchAccount: "Trocar",
        deviceBound: "Vinculado",
        biometricsBadge: "Biometria",
        adminLogin: "Acesso Admin",
        quickGuide: "Guia Rápido",
        toggleTheme: "Mudar Tema",
        refresh: "Atualizar",
        onLeave: "🌴 De Licença",
        completed: "CONCLUÍDO",
        adminEmail: "E-mail do Administrador",
        password: "Senha",
        logIn: "Entrar",
        forgotPassword: "Esqueceu a senha?",
        backToAttendance: "← Voltar para presença",
        signInSuccess: "Entrada registrada com sucesso!",
        signOutSuccess: "Saída registrada com sucesso!",
        connectedTo: "Conectado a",
        invalidCode: "Código de espaço inválido. Confirme com o administrador da sua equipe."
    },
    ar: {
        appName: "حضور الموظفين",
        verifyingGps: "جاري التحقق من الموقع (GPS)...",
        gpsReady: "📍 تم التحقق من الموقع • حدد اسمك",
        withinPerimeter: "داخل مقر العمل",
        awayFromOffice: "خارج مقر العمل",
        metersFromOffice: "متر من المكتب",
        officeRequired: "📍 في المقر (مطلوب)",
        officeMode: "📍 المكتب",
        homeMode: "🏠 العمل من المنزل",
        flexibleMode: "🏠 نمط مرن / عن بُعد",
        executiveMode: "🏠 نمط مرن / عن بُعد",
        signIn: "تسجيل الدخول",
        signOut: "تسجيل الخروج",
        signOutRemote: "تسجيل خروج (عن بُعد)",
        remoteActive: "🏠 تسجيل الخروج عن بُعد متاح",
        selectYourName: "اختر اسمك",
        verifying: "جاري التحقق...",
        pleaseWait: "يرجى الانتظار...",
        readyToSignIn: "جاهز لتسجيل الحضور",
        readyToSignOut: "جاهز لتسجيل الانصراف",
        typeSearchName: "اكتب للبحث عن اسمك...",
        switchWorkspace: "تبديل",
        connectWorkspaceTitle: "الاتصال بمساحة عملك",
        connectWorkspaceDesc: "أدخل رمز مساحة العمل المكون من 6 خانات أو افتح رابط الدعوة لربط هذا الجهاز.",
        connectWorkspaceBtn: "اتصال بمساحة العمل",
        scanQrBtn: "مسح رمز QR",
        cancelScan: "إلغاء المسح",
        cameraBlockedNotice: "تم حظر الوصول إلى الكاميرا: انقر على أيقونة 🔒 في شريط المتصفح للسماح بالكاميرا، أو أدخل الرمز أدناه.",
        tryCameraAgain: "إعادة محاولة الكاميرا",
        switchAccount: "تغيير",
        deviceBound: "مرتبط",
        biometricsBadge: "البصمة",
        adminLogin: "دخول المسؤول",
        quickGuide: "دليل سريع",
        toggleTheme: "تبديل السمة",
        refresh: "تحديث",
        onLeave: "🌴 في إجازة",
        completed: "مكتمل",
        adminEmail: "بريد المسؤول",
        password: "كلمة المرور",
        logIn: "تسجيل الدخول",
        forgotPassword: "نسيت كلمة المرور؟",
        backToAttendance: "← العودة إلى الحضور",
        signInSuccess: "تم تسجيل الحضور بنجاح!",
        signOutSuccess: "تم تسجيل الانصراف بنجاح!",
        connectedTo: "متصل بـ",
        invalidCode: "رمز مساحة العمل غير صالح. يرجى مراجعة مسؤول فريقك."
    }
};

const LANG_CONFIG = {
    en: { flag: "🇬🇧", label: "English", code: "EN" },
    es: { flag: "🇪🇸", label: "Español", code: "ES" },
    fr: { flag: "🇫🇷", label: "Français", code: "FR" },
    pt: { flag: "🇵🇹", label: "Português", code: "PT" },
    ar: { flag: "🇸🇦", label: "العربية", code: "AR" }
};

function getAppLanguage() {
    try {
        if (typeof safeStorage !== 'undefined') {
            return safeStorage.getItem('app_language') || 'en';
        }
        if (typeof localStorage !== 'undefined') {
            return localStorage.getItem('app_language') || 'en';
        }
    } catch (e) {}
    return 'en';
}

function setAppLanguage(lang) {
    const supported = ['en', 'es', 'fr', 'pt', 'ar'];
    const validLang = supported.includes(lang) ? lang : 'en';
    try {
        if (typeof safeStorage !== 'undefined') {
            safeStorage.setItem('app_language', validLang);
        } else if (typeof localStorage !== 'undefined') {
            localStorage.setItem('app_language', validLang);
        }
    } catch (e) {}

    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.lang = validLang;
        document.documentElement.dir = (validLang === 'ar') ? 'rtl' : 'ltr';
    }

    applyLanguageTranslations(validLang);

    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('languageChanged', { detail: { lang: validLang } }));
    }
}

function t(key, defaultFallback = '') {
    const lang = getAppLanguage();
    if (I18N_DICTIONARY[lang] && I18N_DICTIONARY[lang][key]) {
        return I18N_DICTIONARY[lang][key];
    }
    if (I18N_DICTIONARY.en && I18N_DICTIONARY.en[key]) {
        return I18N_DICTIONARY.en[key];
    }
    return defaultFallback;
}

function applyLanguageTranslations(lang) {
    if (typeof document === 'undefined') return;

    // 1. Text content with data-i18n
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (key) {
            const val = t(key);
            if (val) el.textContent = val;
        }
    });

    // 2. Placeholders with data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
            const val = t(key);
            if (val) el.placeholder = val;
        }
    });

    // 3. Update topbar language indicator
    const meta = LANG_CONFIG[lang] || LANG_CONFIG.en;
    document.querySelectorAll('.current-lang-flag, #current-lang-flag').forEach(el => {
        el.textContent = meta.flag;
    });
    document.querySelectorAll('.current-lang-code, #current-lang-code').forEach(el => {
        el.textContent = meta.code;
    });

    // 4. Update dropdown menu active states
    document.querySelectorAll('.lang-option-btn').forEach(btn => {
        const btnLang = btn.getAttribute('data-lang');
        if (btnLang === lang) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

function initLanguageSelector() {
    if (typeof document === 'undefined') return;

    document.querySelectorAll('.lang-selector-wrap').forEach(wrap => {
        const langBtn = wrap.querySelector('.lang-btn') || wrap.querySelector('#lang-select-btn');
        const menu = wrap.querySelector('.lang-dropdown-menu') || wrap.querySelector('#lang-dropdown-menu');
        if (langBtn && menu && !langBtn.dataset.bound) {
            langBtn.dataset.bound = 'true';
            langBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close any other open dropdown menus first
                document.querySelectorAll('.lang-dropdown-menu').forEach(m => {
                    if (m !== menu) m.style.display = 'none';
                });
                menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
            });

            menu.querySelectorAll('.lang-option-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const lang = btn.getAttribute('data-lang');
                    if (lang) setAppLanguage(lang);
                    menu.style.display = 'none';
                });
            });
        }
    });

    if (!document.__langClickBound) {
        document.__langClickBound = true;
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.lang-selector-wrap')) {
                document.querySelectorAll('.lang-dropdown-menu').forEach(m => {
                    m.style.display = 'none';
                });
            }
        });
    }

    // Apply currently saved language immediately
    const curLang = getAppLanguage();
    if (document.documentElement) {
        document.documentElement.lang = curLang;
        document.documentElement.dir = (curLang === 'ar') ? 'rtl' : 'ltr';
    }
    applyLanguageTranslations(curLang);
}

// Automatically initialize language on DOMContentLoaded
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLanguageSelector);
    } else {
        initLanguageSelector();
    }
}


/* ---------- HTML Escaping & Date Utilities ---------- */

function formatWeekKeyFromDmy(dmyStr) {
    if (!dmyStr) return dmyStr;
    if (dmyStr.includes('-') || dmyStr.includes(',')) return dmyStr;
    const parts = dmyStr.split('/');
    if (parts.length !== 3) return dmyStr;
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const year = parseInt(parts[2], 10);
    const monday = new Date(year, month, day);
    const friday = new Date(year, month, day + 4);
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monMonth = monthNames[monday.getMonth()];
    const friMonth = monthNames[friday.getMonth()];
    // Always include both month names to match GAS-saved keys: "July 27 - July 31, 2026"
    return `${monMonth} ${monday.getDate()} - ${friMonth} ${friday.getDate()}, ${year}`;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* ---------- Analytics/Monitoring ---------- */

function logAnalyticsEvent(type, details = {}) {
    const analytics = readStoredJson(STORAGE_KEYS.analytics, []);
    const event = {
        type,
        details,
        timestamp: new Date().toISOString()
    };
    analytics.unshift(event);
    writeStoredJson(STORAGE_KEYS.analytics, analytics.slice(0, 100));

    if (navigator.onLine) {
        const deviceId = typeof window._deviceId !== 'undefined' ? window._deviceId : '';
        const detailStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
        callBackend({ mode: 'log-analytics', eventType: type, details: detailStr, deviceId }).catch(() => {});
    }
}

function getAnalytics() {
    return readStoredJson(STORAGE_KEYS.analytics, []);
}

function clearAnalytics() {
    writeStoredJson(STORAGE_KEYS.analytics, []);
}


/* ---------- Safe Storage Wrapper ---------- */
window.safeStorage = {
    getItem: (key) => { try { return localStorage.getItem(key); } catch(e) { return null; } },
    setItem: (key, val) => { try { localStorage.setItem(key, val); } catch(e) {} },
    removeItem: (key) => { try { localStorage.removeItem(key); } catch(e) {} }
};

window.safeSession = {
    getItem: (key) => { try { return sessionStorage.getItem(key); } catch(e) { return null; } },
    setItem: (key, val) => { try { sessionStorage.setItem(key, val); } catch(e) {} },
    removeItem: (key) => { try { sessionStorage.removeItem(key); } catch(e) {} }
};

/* ---------- Storage helpers ---------- */

function readStoredJson(key, fallback = []) {
    try {
        const value = safeStorage.getItem(key);
        return value ? JSON.parse(value) : fallback;
    } catch (error) {
        console.warn(`Failed to parse stored value for "${key}":`, error);
        return fallback;
    }
}

function writeStoredJson(key, value) {
    try {
        safeStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
        console.warn(`Failed to persist value for "${key}":`, error);
    }
}

/* ---------- Crypto: SHA-256 hashing ---------- */

async function sha256Hex(text) {
    const cryptoObj = (typeof window !== 'undefined' && window.crypto) ? window.crypto : (typeof crypto !== 'undefined' ? crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) {
        throw new Error('Web Crypto API is unavailable in this browser context (requires HTTPS or localhost).');
    }
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/* ---------- Request deduplication ---------- */

const pendingRequests = new Map();

async function callBackendDeduplicated(payload, timeoutMs = 20000) {
    const requestKey = JSON.stringify(payload);
    
    if (pendingRequests.has(requestKey)) {
        return pendingRequests.get(requestKey);
    }
    
    const promise = callBackend(payload, timeoutMs)
        .finally(() => {
            pendingRequests.delete(requestKey);
        });
    
    pendingRequests.set(requestKey, promise);
    return promise;
}

/* ---------- Backend communication ----------
   Routes requests to Supabase (PostgreSQL + Edge RPCs). */

async function getStaffMetadataMap() {
    let metadata = {};
    try {
        const stored = safeStorage.getItem('STAFF_METADATA');
        if (stored) metadata = JSON.parse(stored);
    } catch(e) {}

    try {
        const { data, error } = await supabaseClient.from('app_config').select('value').eq('key', 'STAFF_METADATA').single();
        if (!error && data && data.value) {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            if (parsed && typeof parsed === 'object') {
                metadata = { ...metadata, ...parsed };
                try { safeStorage.setItem('STAFF_METADATA', JSON.stringify(metadata)); } catch(e) {}
            }
        }
    } catch(e) {}

    return metadata;
}

async function saveStaffMetadataMap(metadata) {
    try { safeStorage.setItem('STAFF_METADATA', JSON.stringify(metadata)); } catch(e) {}
    try {
        await supabaseClient.from('app_config').upsert([{
            key: 'STAFF_METADATA',
            value: JSON.stringify(metadata)
        }], { onConflict: 'key' });
    } catch(e) {
        console.warn('Could not sync STAFF_METADATA to app_config:', e);
    }
}

/* ---------- Multi-Tenant Registry & Data Scoping (Commercial v3.0) ---------- */

function generateWorkspaceCode(slug) {
    const prefix = String(slug || 'WKS').replace(/[^a-zA-Z0-9]/g, '').substring(0, 4).toUpperCase() || 'WKS';
    const rand = Math.floor(10 + Math.random() * 90);
    return `${prefix}-${rand}`;
}

async function getTenantRegistry() {
    let tenants = [];
    try {
        const stored = safeStorage.getItem('TENANTS_REGISTRY');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length) tenants = parsed;
        }
    } catch (e) {}

    try {
        const { data, error } = await supabaseClient.from('app_config').select('value').eq('key', 'TENANTS_REGISTRY').single();
        if (!error && data && data.value) {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            if (Array.isArray(parsed) && parsed.length) {
                tenants = parsed;
                try { safeStorage.setItem('TENANTS_REGISTRY', JSON.stringify(tenants)); } catch (e) {}
            }
        }
    } catch (e) {}

    // Ensure all tenants have a valid workspace_code
    let updated = false;
    tenants.forEach((t) => {
        if (!t.workspace_code) {
            t.workspace_code = generateWorkspaceCode(t.slug);
            updated = true;
        }
    });

    if (updated) {
        saveTenantRegistry(tenants).catch(() => {});
    }

    return tenants;
}

async function getTenantByWorkspaceCode(code) {
    if (!code) return null;
    const clean = String(code).trim().toUpperCase();
    const registry = await getTenantRegistry();
    return registry.find(t => (t.workspace_code && t.workspace_code.toUpperCase() === clean)) || null;
}

async function saveTenantRegistry(tenants) {
    try { safeStorage.setItem('TENANTS_REGISTRY', JSON.stringify(tenants)); } catch (e) {}
    try {
        await supabaseClient.from('app_config').upsert([{
            key: 'TENANTS_REGISTRY',
            value: JSON.stringify(tenants)
        }], { onConflict: 'key' });
    } catch (e) {
        console.warn('Could not sync TENANTS_REGISTRY to app_config:', e);
    }
}

async function getActiveTenant(optionalSlug = null) {
    try {
        let slug = optionalSlug;

        if (typeof window !== 'undefined' && window.location) {
            const urlParams = new URLSearchParams(window.location.search);

            // 1. One-time Setup / Join link: ?join=CODE or ?code=CODE
            const joinCode = urlParams.get('join') || urlParams.get('code');
            if (joinCode) {
                const cleanCode = joinCode.trim().toUpperCase();
                const registry = await getTenantRegistry();
                const matched = registry.find(t => 
                    (t.workspace_code && t.workspace_code.toUpperCase() === cleanCode) ||
                    (t.slug && t.slug.toLowerCase() === cleanCode.toLowerCase())
                );
                if (matched) {
                    slug = matched.slug;
                    try {
                        safeStorage.setItem('active_tenant_slug', matched.slug);
                        // Clean the URL immediately to '/' so zero code or slug remains in address bar/history
                        if (window.history && window.history.replaceState) {
                            window.history.replaceState({}, document.title, window.location.pathname.replace(/\/tenant\/[^\/]+/i, '') || '/');
                        }
                    } catch (e) {}
                }
            }

            // 2. Direct clean path fallback: /tenant/:slug
            if (!slug) {
                const pathParts = window.location.pathname.split('/').filter(Boolean);
                const tenantIdx = pathParts.indexOf('tenant');
                if (tenantIdx !== -1 && pathParts[tenantIdx + 1]) {
                    slug = pathParts[tenantIdx + 1];
                }
            }

            // 3. Query param fallback: ?tenant= or ?company=
            if (!slug) {
                slug = urlParams.get('tenant') || urlParams.get('company');
            }

            // 4. Admin session memory fallback
            if (!slug && typeof safeSession !== 'undefined') {
                slug = safeSession.getItem('admin_tenant_slug') || safeSession.getItem('masquerade_tenant');
            }

            // 5. Device memory fallback (paired device)
            if (!slug) {
                slug = safeStorage.getItem('active_tenant_slug');
            }
        }

        const registry = await getTenantRegistry();
        if (slug) {
            const cleanSlug = String(slug).trim().toLowerCase();
            const match = registry.find(t => (t.slug && t.slug.toLowerCase() === cleanSlug) || (t.id && t.id.toLowerCase() === cleanSlug));
            if (match) {
                try { safeStorage.setItem('active_tenant_slug', match.slug); } catch(e) {}
                return match;
            }
        }

        // Strict Zero-Exposure: If unpaired and no valid workspace code/slug provided, return null
        return null;
    } catch (e) {
        return null;
    }
}

/* ---------- WebAuthn Native Biometric Engine ---------- */

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa ? window.btoa(binary) : '';
}

function base64ToBuffer(base64) {
    if (!base64 || typeof window === 'undefined' || !window.atob) return new Uint8Array(0);
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

async function isBiometricsAvailable() {
    try {
        if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
        if (typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
            return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        }
        return false;
    } catch (e) {
        return false;
    }
}

function isBiometricsEnrolled(staffName) {
    if (!staffName) return false;
    const clean = String(staffName).trim().toLowerCase();
    const stored = safeStorage.getItem(`biometric_cred_${clean}`);
    return Boolean(stored);
}

function getStoredBiometricCredentialId(staffName) {
    if (!staffName) return null;
    const clean = String(staffName).trim().toLowerCase();
    return safeStorage.getItem(`biometric_cred_${clean}`);
}

function getCredentialsApi() {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.credentials) {
        return window.navigator.credentials;
    }
    if (typeof navigator !== 'undefined' && navigator.credentials) {
        return navigator.credentials;
    }
    return null;
}

async function enrollBiometrics(staffId, staffName, tenantName = 'Attendance Cloud') {
    if (!staffName) throw new Error('Staff name is required for biometric registration');
    const creds = getCredentialsApi();
    if (!window.PublicKeyCredential || !creds) {
        throw new Error('WebAuthn biometric authentication is not supported on this browser/device.');
    }

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const safeIdStr = String(staffId || staffName);
    const userIdBuffer = new Uint8Array(safeIdStr.length);
    for (let i = 0; i < safeIdStr.length; i++) {
        userIdBuffer[i] = safeIdStr.charCodeAt(i);
    }

    const creationOptions = {
        publicKey: {
            challenge: challenge,
            rp: {
                name: tenantName,
                id: window.location.hostname
            },
            user: {
                id: userIdBuffer,
                name: staffName,
                displayName: staffName
            },
            pubKeyCredParams: [
                { alg: -7, type: 'public-key' },  // ES256 (P-256)
                { alg: -257, type: 'public-key' } // RS256
            ],
            authenticatorSelection: {
                authenticatorAttachment: 'platform', // Face ID / Touch ID / Windows Hello
                userVerification: 'preferred',
                requireResidentKey: false
            },
            timeout: 60000,
            attestation: 'none'
        }
    };

    const credential = await creds.create(creationOptions);
    if (!credential) throw new Error('Biometric registration was cancelled or timed out.');

    const credIdBase64 = bufferToBase64(credential.rawId);
    const clean = String(staffName).trim().toLowerCase();
    safeStorage.setItem(`biometric_cred_${clean}`, credIdBase64);
    safeStorage.setItem(`biometric_enabled_${clean}`, 'true');

    return {
        success: true,
        credentialId: credIdBase64
    };
}

async function verifyBiometrics(staffName) {
    if (!staffName) return { success: false, message: 'Staff name required' };
    const credIdBase64 = getStoredBiometricCredentialId(staffName);
    if (!credIdBase64) return { success: false, message: 'No biometric credentials enrolled on this device' };

    const creds = getCredentialsApi();
    if (!window.PublicKeyCredential || !creds) {
        return { success: false, message: 'Biometrics unsupported' };
    }

    const challenge = new Uint8Array(32);
    window.crypto.getRandomValues(challenge);

    const rawIdBuffer = base64ToBuffer(credIdBase64);

    const requestOptions = {
        publicKey: {
            challenge: challenge,
            allowCredentials: [{
                id: rawIdBuffer,
                type: 'public-key',
                transports: ['internal']
            }],
            userVerification: 'preferred',
            timeout: 60000
        }
    };

    try {
        const assertion = await creds.get(requestOptions);
        if (assertion) {
            return { success: true, assertion };
        }
        return { success: false, message: 'Verification failed' };
    } catch (err) {
        return { success: false, error: err.name, message: err.message || 'Biometric check cancelled' };
    }
}

function clearBiometrics(staffName) {
    if (!staffName) return;
    const clean = String(staffName).trim().toLowerCase();
    safeStorage.removeItem(`biometric_cred_${clean}`);
    safeStorage.removeItem(`biometric_enabled_${clean}`);
}

/* ---------- Per-Tenant Staff & Config Scoping ---------- */

async function getTenantStaffList(tenantSlug) {
    const slug = String(tenantSlug || (typeof activeTenantSlug !== 'undefined' ? activeTenantSlug : (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'default'))).trim().toLowerCase();
    try {
        // 1. Check scoped app_config key
        const configKey = `TENANT_STAFF_${slug}`;
        const { data, error } = await supabaseClient.from('app_config').select('value').eq('key', configKey).single();
        if (!error && data && data.value) {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            if (Array.isArray(parsed) && parsed.length) return parsed;
        }

        // 2. Query staff table scoped to this tenant
        const { data: dbStaff } = await supabaseClient
            .from('staff')
            .select('*')
            .eq('tenant_slug', slug)
            .order('name');

        if (dbStaff && dbStaff.length) {
            const list = dbStaff.map(s => ({
                id: s.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'staff_' + Math.random().toString(36).substring(2, 9)),
                name: s.name,
                dept: s.dept || 'General',
                schedule_policy: s.schedule_policy || 'weekly_hybrid',
                is_team_lead: Boolean(s.is_team_lead),
                include_in_reports: s.include_in_reports !== false,
                device_id: s.device_id || null,
                device_token: s.device_token || null
            }));
            await saveTenantStaffList(slug, list);
            return list;
        }

        return [];
    } catch (e) {
        console.warn(`Error in getTenantStaffList for ${slug}:`, e);
        return [];
    }
}

async function saveTenantStaffList(tenantSlug, staffArray) {
    const slug = String(tenantSlug || (typeof activeTenantSlug !== 'undefined' ? activeTenantSlug : (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'default'))).trim().toLowerCase();
    const configKey = `TENANT_STAFF_${slug}`;
    try {
        await supabaseClient.from('app_config').upsert([{
            key: configKey,
            value: JSON.stringify(staffArray)
        }], { onConflict: 'key' });
    } catch (e) {
        console.warn(`Error saving tenant staff for ${slug}:`, e);
    }
}

async function getTenantAdminList(tenantSlug) {
    const slug = String(tenantSlug || (typeof activeTenantSlug !== 'undefined' ? activeTenantSlug : (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'default'))).trim().toLowerCase();
    const configKey = `TENANT_ADMINS_${slug}`;
    try {
        const stored = safeStorage.getItem(configKey);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length) return parsed;
        }
    } catch(e) {}
    try {
        const { data, error } = await supabaseClient.from('app_config').select('value').eq('key', configKey).single();
        if (!error && data && data.value) {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            if (Array.isArray(parsed)) {
                try { safeStorage.setItem(configKey, JSON.stringify(parsed)); } catch(e) {}
                return parsed;
            }
        }
    } catch (e) {}
    return [];
}

async function saveTenantAdminList(tenantSlug, adminArray) {
    const slug = String(tenantSlug || (typeof activeTenantSlug !== 'undefined' ? activeTenantSlug : (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'default'))).trim().toLowerCase();
    const configKey = `TENANT_ADMINS_${slug}`;
    try { safeStorage.setItem(configKey, JSON.stringify(adminArray)); } catch(e) {}
    try {
        await supabaseClient.from('app_config').upsert([{
            key: configKey,
            value: JSON.stringify(adminArray)
        }], { onConflict: 'key' });
    } catch (e) {
        console.warn(`Error saving tenant admins for ${slug}:`, e);
    }
}

async function getTenantConfig(tenantSlug) {
    const slug = String(tenantSlug || (typeof activeTenantSlug !== 'undefined' ? activeTenantSlug : (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'default'))).trim().toLowerCase();
    const configKey = `TENANT_CONFIG_${slug}`;
    try {
        const { data, error } = await supabaseClient.from('app_config').select('value').eq('key', configKey).single();
        if (!error && data && data.value) {
            const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
            if (!parsed.hybrid_office_days) parsed.hybrid_office_days = 2;
            if (!parsed.slug) parsed.slug = slug;
            return parsed;
        }
    } catch (e) {}

    // Fallback to tenant registry defaults
    const registry = await getTenantRegistry();
    const t = registry.find(item => item.slug.toLowerCase() === slug) || {};
    return {
        slug: t.slug || slug,
        name: t.name || (slug.charAt(0).toUpperCase() + slug.slice(1)),
        office_name: t.office_name || 'Main Office',
        latitude: Number(t.latitude) || 6.4357,
        longitude: Number(t.longitude) || 3.4738,
        radius: Number(t.radius) || 100,
        grace_period_minutes: Number(t.grace_period_minutes) || 15,
        default_policy: t.default_policy || 'weekly_hybrid',
        hybrid_office_days: Number(t.hybrid_office_days) || 2,
        brand_color: t.brand_color || '#1a56db',
        logo_url: t.logo_url || '',
        workday_start_time: t.workday_start_time || '08:30',
        late_cutoff_minutes: Number(t.late_cutoff_minutes) || 510,
        workday_end_time: t.workday_end_time || '17:00',
        workday_end_minutes: Number(t.workday_end_minutes) || 1020,
        allow_remote_signout_post_closing: t.allow_remote_signout_post_closing !== undefined ? t.allow_remote_signout_post_closing : true,
        count_wfh_in_attendance_quota: t.wfh_quota_enabled !== undefined ? t.wfh_quota_enabled : true,
        wfh_quota_enabled: t.wfh_quota_enabled !== undefined ? t.wfh_quota_enabled : true,
        workdays: t.workdays || '1_5',
        team_lead_priority_sort: t.team_lead_priority_sort !== undefined ? t.team_lead_priority_sort : true,
        timezone: t.timezone || 'Africa/Lagos'
    };
}

async function saveTenantConfig(tenantSlug, configObj) {
    const slug = String(tenantSlug || (typeof activeTenantSlug !== 'undefined' ? activeTenantSlug : (typeof getActiveTenantSlug === 'function' ? getActiveTenantSlug() : 'default'))).trim().toLowerCase();
    const configKey = `TENANT_CONFIG_${slug}`;
    try {
        await supabaseClient.from('app_config').upsert([{
            key: configKey,
            value: JSON.stringify(configObj)
        }], { onConflict: 'key' });
    } catch (e) {
        console.warn(`Error saving tenant config for ${slug}:`, e);
    }
}

async function resolveRequestedTenantSlug(payload) {
    if (payload && payload.tenantSlug) return String(payload.tenantSlug).trim().toLowerCase();
    const activeTenant = await getActiveTenant();
    if (activeTenant && activeTenant.slug) return activeTenant.slug.toLowerCase();
    const sessionSlug = (typeof safeSession !== 'undefined' && (safeSession.getItem('admin_tenant_slug') || safeSession.getItem('masquerade_tenant'))) || null;
    if (sessionSlug) return sessionSlug.toLowerCase();
    const storageSlug = (typeof safeStorage !== 'undefined' && safeStorage.getItem('active_tenant_slug')) || null;
    if (storageSlug) return storageSlug.toLowerCase();
    return null;
}

async function callBackend(payload, timeoutMs = 20000) {
    if (!supabaseClient) return { ok: false, message: 'Supabase client not loaded.' };
    const adminToken = payload.adminToken || safeSession.getItem('admin_token') || '';
    const mode = payload.mode;
    
    try {
        switch (mode) {
            case 'admin-login': {
                const emailClean = String(payload.email || '').trim().toLowerCase();
                const password = String(payload.password || '').trim();
                const passwordHash = await sha256Hex(password);
                
                let authUser = null;
                let userRole = 'admin';
                let isSuperuser = false;

                // 1. Try Supabase Auth Login
                try {
                    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
                        email: payload.email,
                        password: password
                    });
                    if (!authError && authData && authData.user) {
                        authUser = authData.user;
                        const { data: roleData } = await supabaseClient.from('admin_roles').select('role').eq('id', authUser.id).single();
                        if (roleData && roleData.role) {
                            userRole = roleData.role;
                            if (userRole === 'developer') isSuperuser = true;
                        }
                    }
                } catch(e) {}

                // 2. Match tenant from registry
                const registry = await getTenantRegistry();
                let matchedTenant = registry.find(t => 
                    (t.admin_email && t.admin_email.toLowerCase() === emailClean) ||
                    (t.email && t.email.toLowerCase() === emailClean) ||
                    (t.contact_email && t.contact_email.toLowerCase() === emailClean) ||
                    (t.slug && emailClean.includes(`@${t.slug.toLowerCase()}.internal`))
                );

                // Check tenant primary admin password fallback if not authenticated via Supabase
                if (matchedTenant && !authUser) {
                    if (matchedTenant.admin_password && matchedTenant.admin_password === password) {
                        authUser = { id: 'primary_' + matchedTenant.slug, email: matchedTenant.admin_email };
                    }
                }

                // 3. If not found in primary tenant registry, search delegated admins in TENANT_ADMINS_${slug}
                if (!matchedTenant) {
                    for (const t of registry) {
                        const tenantAdmins = await getTenantAdminList(t.slug);
                        const matchedAdmin = tenantAdmins.find(a => 
                            (a.email && a.email.toLowerCase() === emailClean) ||
                            (a.username && a.username.toLowerCase() === emailClean)
                        );
                        if (matchedAdmin) {
                            if (authUser) {
                                matchedTenant = t;
                                userRole = matchedAdmin.role || userRole;
                                break;
                            } else if (matchedAdmin.password_hash && (matchedAdmin.password_hash === passwordHash || matchedAdmin.password_hash === password)) {
                                matchedTenant = t;
                                userRole = matchedAdmin.role || 'admin';
                                authUser = { id: matchedAdmin.id, email: matchedAdmin.email };
                                break;
                            }
                        }
                    }
                }

                if (!matchedTenant && !authUser) {
                    return { ok: false, message: 'Invalid admin credentials.' };
                }

                const tenantSlug = matchedTenant ? matchedTenant.slug : (payload.tenantSlug || null);

                return {
                    ok: true,
                    message: 'Admin access granted.',
                    role: userRole,
                    isSuperuser: isSuperuser,
                    username: payload.email,
                    tenantSlug: tenantSlug,
                    tenant: matchedTenant || null
                };
            }
            case 'admin-logout': {
                await supabaseClient.auth.signOut();
                return { ok: true, message: 'Logged out.' };
            }
            case 'attendance': {
                let lat = payload.lat;
                let lon = payload.lon;
                const isRemoteSignout = Boolean(payload.isRemoteSignOut);

                // If remote sign-out post-closing is requested, resolve office coordinates if needed
                if (payload.action === 'OUT' && isRemoteSignout) {
                    try {
                        const { data: configData } = await supabaseClient.from('app_config').select('*');
                        const cfg = {};
                        if (configData) configData.forEach(r => cfg[r.key] = r.value);
                        const allowRemote = cfg.ALLOW_REMOTE_SIGNOUT_POST_CLOSING !== undefined ? cfg.ALLOW_REMOTE_SIGNOUT_POST_CLOSING : true;
                        if (allowRemote === true || allowRemote === 'true') {
                            if (!lat || !lon || (Number(lat) === 0 && Number(lon) === 0)) {
                                lat = Number(cfg.OFFICE_LAT || 6.4518631);
                                lon = Number(cfg.OFFICE_LON || 3.5277863);
                            }
                        }
                    } catch (e) {
                        console.warn('Error checking remote signout config:', e);
                    }
                }

                const { data, error } = await supabaseClient.rpc('process_attendance', {
                    p_name: payload.name,
                    p_action: payload.action,
                    p_lat: lat,
                    p_lon: lon,
                    p_device_id: payload.deviceId || ''
                });
                if (error) throw error;

                if (data && data.ok && payload.action === 'OUT' && isRemoteSignout) {
                    data.status = 'Off-Site Sign-Out';
                    data.message = `Remote sign-out recorded for ${payload.name} (Post-Closing). Have a great evening!`;
                    try {
                        await supabaseClient.from('attendance_logs')
                            .update({ status: 'Off-Site Sign-Out' })
                            .eq('name', payload.name)
                            .eq('action', 'OUT')
                            .order('created_at', { ascending: false })
                            .limit(1);
                    } catch (e) {}
                }

                return {
                    ok: data.ok,
                    allowed: data.ok,
                    message: data.message,
                    status: data.status,
                    distance: data.distance,
                    raw: data
                };
            }
            case 'list-logs': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: true, logs: [] };

                let query = supabaseClient.from('attendance').select('*');
                
                // Strict multi-tenant isolation
                if (tenantSlug === 'lifecard') {
                    query = query.or('tenant_slug.eq.lifecard,tenant_slug.is.null');
                } else {
                    query = query.eq('tenant_slug', tenantSlug);
                }

                if (payload.name) {
                    query = query.ilike('name', `%${payload.name.trim()}%`);
                }
                if (payload.fromDate) {
                    query = query.gte('date', payload.fromDate);
                }
                if (payload.toDate) {
                    query = query.lte('date', payload.toDate);
                }

                const limitVal = parseInt(payload.limit, 10) || 200;
                query = query.order('created_at', { ascending: false }).limit(limitVal);

                const { data, error } = await query;
                if (error) throw error;
                return { ok: true, logs: data || [] };
            }
            case 'list-staff': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: true, allowed: true, staff: [] };
                const staff = await getTenantStaffList(tenantSlug);
                return { ok: true, allowed: true, staff };
            }
            case 'add-staff': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const name = String(payload.name || '').trim();
                if (!name) return { ok: false, message: 'Staff name is required.' };

                const staff = await getTenantStaffList(tenantSlug);
                if (staff.some(s => s.name.toLowerCase() === name.toLowerCase())) {
                    return { ok: false, message: `Staff member "${name}" already exists.` };
                }

                const newMember = {
                    id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'staff_' + Math.random().toString(36).substring(2, 9),
                    name,
                    dept: String(payload.dept || 'General').trim(),
                    schedule_policy: String(payload.schedule_policy || 'weekly_hybrid').trim(),
                    is_team_lead: Boolean(payload.is_team_lead),
                    include_in_reports: payload.include_in_reports !== false,
                    device_id: null,
                    device_token: null,
                    created_at: new Date().toISOString()
                };

                staff.push(newMember);
                await saveTenantStaffList(tenantSlug, staff);

                if (tenantSlug === 'lifecard') {
                    try {
                        await supabaseClient.from('staff').insert([{ name }]);
                    } catch (e) {}
                    const metaMap = await getStaffMetadataMap();
                    metaMap[name] = { dept: newMember.dept, schedule_policy: newMember.schedule_policy, is_team_lead: newMember.is_team_lead, include_in_reports: newMember.include_in_reports };
                    await saveStaffMetadataMap(metaMap);
                }

                return { ok: true, message: 'Staff added successfully.', staffMember: newMember };
            }
            case 'batch-import-staff': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const list = Array.isArray(payload.staff) ? payload.staff : [];
                if (!list.length) return { ok: false, message: 'No staff data provided.' };

                const staff = await getTenantStaffList(tenantSlug);
                const existingNames = new Set(staff.map(s => String(s.name || '').trim().toLowerCase()));
                let addedCount = 0;
                let updatedCount = 0;

                for (const item of list) {
                    const name = String(item.name || '').trim();
                    if (!name) continue;
                    const dept = String(item.dept || 'General').trim();
                    const schedule_policy = String(item.schedule_policy || 'weekly_hybrid').trim();
                    const is_team_lead = Boolean(item.is_team_lead);
                    const include_in_reports = item.include_in_reports !== false;

                    const existingIdx = staff.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
                    if (existingIdx !== -1) {
                        staff[existingIdx] = {
                            ...staff[existingIdx],
                            dept,
                            schedule_policy,
                            is_team_lead,
                            include_in_reports
                        };
                        updatedCount++;
                    } else {
                        staff.push({
                            id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'staff_' + Math.random().toString(36).substring(2, 9),
                            name,
                            dept,
                            schedule_policy,
                            is_team_lead,
                            include_in_reports,
                            device_id: null,
                            device_token: null,
                            created_at: new Date().toISOString()
                        });
                        existingNames.add(name.toLowerCase());
                        addedCount++;
                    }
                }

                await saveTenantStaffList(tenantSlug, staff);
                return {
                    ok: true,
                    message: `Imported ${addedCount} new staff, updated ${updatedCount} existing.`,
                    addedCount,
                    updatedCount
                };
            }
            case 'update-staff': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const name = String(payload.name || '').trim();
                const staff = await getTenantStaffList(tenantSlug);
                const idx = staff.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
                if (idx === -1) return { ok: false, message: 'Staff member not found.' };

                staff[idx] = {
                    ...staff[idx],
                    dept: payload.dept !== undefined ? String(payload.dept).trim() : staff[idx].dept,
                    schedule_policy: payload.schedule_policy !== undefined ? String(payload.schedule_policy).trim() : staff[idx].schedule_policy,
                    is_team_lead: payload.is_team_lead !== undefined ? Boolean(payload.is_team_lead) : staff[idx].is_team_lead,
                    include_in_reports: payload.include_in_reports !== undefined ? Boolean(payload.include_in_reports) : staff[idx].include_in_reports
                };
                await saveTenantStaffList(tenantSlug, staff);

                if (tenantSlug === 'lifecard') {
                    const metaMap = await getStaffMetadataMap();
                    metaMap[name] = { dept: staff[idx].dept, schedule_policy: staff[idx].schedule_policy, is_team_lead: staff[idx].is_team_lead, include_in_reports: staff[idx].include_in_reports };
                    await saveStaffMetadataMap(metaMap);
                }

                return { ok: true, message: 'Staff updated successfully.', staffMember: staff[idx] };
            }
            case 'remove-staff': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const name = String(payload.name || '').trim();
                let staff = await getTenantStaffList(tenantSlug);
                staff = staff.filter(s => s.name.toLowerCase() !== name.toLowerCase());
                await saveTenantStaffList(tenantSlug, staff);

                if (tenantSlug === 'lifecard') {
                    try { await supabaseClient.from('staff').delete().eq('name', name); } catch(e) {}
                    const metaMap = await getStaffMetadataMap();
                    if (metaMap[name]) { delete metaMap[name]; await saveStaffMetadataMap(metaMap); }
                }

                return { ok: true, message: 'Staff removed successfully.' };
            }
            case 'reset-staff-lock': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const name = String(payload.name || '').trim();
                const staff = await getTenantStaffList(tenantSlug);
                const member = staff.find(s => s.name.toLowerCase() === name.toLowerCase());
                if (member) {
                    member.device_id = null;
                    member.device_token = null;
                    member.was_unlinked_by_admin = true;
                    await saveTenantStaffList(tenantSlug, staff);
                }
                if (tenantSlug === 'lifecard') {
                    try { await supabaseClient.from('staff').update({ device_id: null }).eq('name', name); } catch(e) {}
                }
                return { ok: true, message: 'Device lock reset successfully.' };
            }
            case 'reset-all-locks': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const staff = await getTenantStaffList(tenantSlug);
                staff.forEach(s => { s.device_id = null; s.device_token = null; s.was_unlinked_by_admin = true; });
                await saveTenantStaffList(tenantSlug, staff);
                if (tenantSlug === 'lifecard') {
                    try { await supabaseClient.from('staff').update({ device_id: null }).neq('name', 'dummy'); } catch(e) {}
                }
                return { ok: true, message: 'All device locks reset successfully.' };
            }
            case 'get-config': {
                const { data, error } = await supabaseClient.from('app_config').select('*');
                if (error) throw error;
                const configObj = {
                    WORKDAY_END_MINUTES: 1020,
                    ALLOW_REMOTE_SIGNOUT_POST_CLOSING: 'true',
                    COUNT_WFH_IN_ATTENDANCE_QUOTA: 'true',
                    TIMEZONE: 'Africa/Lagos'
                };
                if (data) data.forEach(row => configObj[row.key] = row.value);
                return { ok: true, config: configObj };
            }
            case 'update-config': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (tenantSlug) {
                    try {
                        const registry = await getTenantRegistry();
                        const tIdx = registry.findIndex(t => t.slug && t.slug.toLowerCase() === tenantSlug.toLowerCase());
                        if (tIdx !== -1) {
                            if (payload.key === 'TIMEZONE') registry[tIdx].timezone = payload.value;
                            if (payload.key === 'OFFICE_LAT') registry[tIdx].latitude = Number(payload.value);
                            if (payload.key === 'OFFICE_LON') registry[tIdx].longitude = Number(payload.value);
                            if (payload.key === 'RADIUS_METERS') registry[tIdx].radius = Number(payload.value);
                            if (payload.key === 'LATE_CUTOFF_MINUTES') registry[tIdx].late_cutoff_minutes = Number(payload.value);
                            if (payload.key === 'WORKDAY_END_MINUTES') registry[tIdx].workday_end_minutes = Number(payload.value);
                            if (payload.key === 'WORK_DAYS') registry[tIdx].workdays = payload.value;
                            if (payload.key === 'TEAM_LEAD_PRIORITY_SORT') registry[tIdx].team_lead_priority_sort = (payload.value === 'true' || payload.value === true);
                            if (payload.key === 'HYBRID_OFFICE_DAYS') registry[tIdx].hybrid_office_days = Number(payload.value);
                            if (payload.key === 'COUNT_WFH_IN_ATTENDANCE_QUOTA') registry[tIdx].wfh_quota_enabled = (payload.value === 'true' || payload.value === true);
                            await saveTenantRegistry(registry);
                        }
                    } catch(e) {
                        console.warn('Could not sync update-config to tenant registry:', e);
                    }
                }

                const configKey = tenantSlug && tenantSlug !== 'lifecard' ? `${tenantSlug}::${payload.key}` : payload.key;
                const { error } = await supabaseClient.from('app_config').upsert([{ key: configKey, value: payload.value }], { onConflict: 'key' });
                if (error) throw error;
                if (tenantSlug === 'lifecard') {
                    try { await supabaseClient.from('app_config').upsert([{ key: payload.key, value: payload.value }], { onConflict: 'key' }); } catch(e) {}
                }
                return { ok: true, message: 'Configuration updated.' };
            }
            case 'list-admin-users': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };

                const registry = await getTenantRegistry();
                const currentTenant = registry.find(t => t.slug && t.slug.toLowerCase() === tenantSlug.toLowerCase());

                const delegatedAdmins = await getTenantAdminList(tenantSlug);
                const combined = [];

                if (currentTenant && currentTenant.admin_email) {
                    combined.push({
                        id: 'primary-admin-' + tenantSlug,
                        username: currentTenant.admin_name || 'Primary Admin',
                        email: currentTenant.admin_email,
                        role: 'admin',
                        is_primary: true
                    });
                }

                delegatedAdmins.forEach(u => {
                    if (!combined.some(c => c.email && u.email && c.email.toLowerCase() === u.email.toLowerCase())) {
                        combined.push(u);
                    }
                });

                return { ok: true, users: combined };
            }
            case 'add-admin-user': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };

                const username = (payload.newUsername || payload.username || '').trim();
                const email = (payload.email || `${username.toLowerCase().replace(/[^a-z0-9]/g, '')}@${tenantSlug}.internal`).trim();
                const password = (payload.password || payload.newPassword || '').trim();
                if (!password || password.length < 6) {
                    return { ok: false, message: 'Password is required and must be at least 6 characters.' };
                }
                const role = payload.role || payload.tier || 'admin';
                const passwordHash = await sha256Hex(password);

                const delegatedAdmins = await getTenantAdminList(tenantSlug);
                const existing = delegatedAdmins.find(a => 
                    (a.email && a.email.toLowerCase() === email.toLowerCase()) ||
                    (a.username && a.username.toLowerCase() === username.toLowerCase())
                );
                if (existing) {
                    return { ok: false, message: 'An admin user with this username or email already exists in this workspace.' };
                }

                // Register with Supabase Auth for full backend compatibility if available
                let authUserId = null;
                try {
                    const { data: currentSessionData } = await supabaseClient.auth.getSession();
                    const currentSession = currentSessionData?.session;

                    const { data: authData } = await supabaseClient.auth.signUp({
                        email: email,
                        password: password
                    });

                    if (authData && authData.user) {
                        authUserId = authData.user.id;
                        await supabaseClient.from('admin_roles').upsert([{
                            id: authUserId,
                            role: role,
                            email: email,
                            username: username
                        }], { onConflict: 'id' }).catch(() => {});
                    }

                    if (currentSession) {
                        await supabaseClient.auth.setSession({
                            access_token: currentSession.access_token,
                            refresh_token: currentSession.refresh_token
                        }).catch(() => {});
                    }
                } catch (e) {
                    console.warn('Supabase Auth signUp skipped or fallback utilized:', e);
                }

                const newAdmin = {
                    id: authUserId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'adm_' + Math.random().toString(36).substring(2, 9)),
                    username: username || email.split('@')[0],
                    email: email,
                    password_hash: passwordHash,
                    role: role,
                    created_at: new Date().toISOString()
                };

                delegatedAdmins.push(newAdmin);
                await saveTenantAdminList(tenantSlug, delegatedAdmins);

                return { ok: true, message: `Admin account "${newAdmin.username}" assigned successfully!` };
            }
            case 'remove-admin-user': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const target = String(payload.targetUsername || payload.userId || '').trim().toLowerCase();

                let delegatedAdmins = await getTenantAdminList(tenantSlug);
                delegatedAdmins = delegatedAdmins.filter(a => 
                    (a.username && a.username.toLowerCase() !== target) &&
                    (a.email && a.email.toLowerCase() !== target) &&
                    (a.id && a.id !== target)
                );
                await saveTenantAdminList(tenantSlug, delegatedAdmins);

                try {
                    await supabaseClient.from('admin_roles').delete().or(`username.eq."${target}",email.eq."${target}"`);
                } catch(e) {}

                return { ok: true, message: 'Admin account removed.' };
            }
            case 'update-admin-role': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const target = String(payload.targetUsername || '').trim().toLowerCase();
                const role = payload.newRole || payload.role;

                const delegatedAdmins = await getTenantAdminList(tenantSlug);
                const member = delegatedAdmins.find(a => 
                    (a.username && a.username.toLowerCase() === target) ||
                    (a.email && a.email.toLowerCase() === target)
                );
                if (member) {
                    member.role = role;
                    await saveTenantAdminList(tenantSlug, delegatedAdmins);
                }

                try {
                    await supabaseClient.from('admin_roles').update({ role }).or(`username.eq."${target}",email.eq."${target}"`);
                } catch(e) {}

                return { ok: true, message: 'Admin role updated successfully.' };
            }
            case 'update-admin-user': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                const target = payload.targetUsername;
                const updates = {};
                if (payload.newUsername && payload.newUsername.trim()) updates.username = payload.newUsername.trim();
                if (payload.email && payload.email.trim()) updates.email = payload.email.trim();
                if (payload.tier) updates.role = payload.tier;

                if (tenantSlug) {
                    const delegatedAdmins = await getTenantAdminList(tenantSlug);
                    const member = delegatedAdmins.find(a => 
                        (a.username && a.username.toLowerCase() === target.toLowerCase()) ||
                        (a.email && a.email.toLowerCase() === target.toLowerCase())
                    );
                    if (member) {
                        if (updates.username) member.username = updates.username;
                        if (updates.email) member.email = updates.email;
                        if (updates.role) member.role = updates.role;
                        await saveTenantAdminList(tenantSlug, delegatedAdmins);
                    }
                }

                try {
                    if (Object.keys(updates).length > 0) {
                        await supabaseClient
                            .from('admin_roles')
                            .update(updates)
                            .or(`username.eq."${target}",email.eq."${target}"`);
                    }
                } catch(e) {}
                return { ok: true, message: 'Admin user updated successfully.' };
            }
            case 'admin-reset-user-password':
            case 'reset-admin-password': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                const targetUser = String(payload.targetUsername || '').trim().toLowerCase();
                const newPass = payload.newPassword || payload.newPasswordHash;
                if (!newPass) return { ok: false, message: 'No new password provided.' };

                if (tenantSlug) {
                    const delegatedAdmins = await getTenantAdminList(tenantSlug);
                    const member = delegatedAdmins.find(a => 
                        (a.username && a.username.toLowerCase() === targetUser) ||
                        (a.email && a.email.toLowerCase() === targetUser)
                    );
                    if (member) {
                        member.password_hash = await sha256Hex(newPass);
                        await saveTenantAdminList(tenantSlug, delegatedAdmins);
                    }
                }

                try {
                    const { data: roleRow } = await supabaseClient
                        .from('admin_roles')
                        .select('id, email')
                        .or(`username.eq."${targetUser}",email.eq."${targetUser}"`)
                        .single();
                    if (roleRow) {
                        await supabaseClient.auth.updateUser({ password: newPass });
                    }
                } catch(e) {}

                return { ok: true, message: 'Password reset successfully.' };
            }
            case 'admin-change-password': {
                const pass = payload.newPassword || payload.newPasswordHash;
                if (pass) {
                    // Make sure the Supabase client's session is fresh before calling updateUser
                    let session = null;
                    try {
                        const { data: sessData } = await supabaseClient.auth.getSession();
                        session = sessData?.session || null;
                    } catch(e) {}
                    if (!session) {
                        // Try a token refresh in case the access token is just expired
                        try {
                            const { data: refreshData } = await supabaseClient.auth.refreshSession();
                            session = refreshData?.session || null;
                        } catch(e) {}
                    }
                    if (!session) {
                        return { ok: false, message: 'No active admin session — please log in again before changing your password.' };
                    }
                    // Re-assert the session so the client sends the correct Bearer token
                    await supabaseClient.auth.setSession({
                        access_token: session.access_token,
                        refresh_token: session.refresh_token
                    });
                    const { error } = await supabaseClient.auth.updateUser({ password: pass });
                    if (error) throw error;
                }
                return { ok: true, message: 'Password updated successfully!' };
            }
            case 'admin-set-recovery-email': {
                const email = payload.email;
                if (email) {
                    await supabaseClient.from('app_config').upsert([{ key: 'RECOVERY_EMAIL', value: email }], { onConflict: 'key' });
                    const { data: userData } = await supabaseClient.auth.getUser();
                    if (userData && userData.user) {
                        await supabaseClient.from('admin_roles').update({ email: email }).eq('id', userData.user.id);
                    }
                }
                return { ok: true, message: 'Recovery email saved successfully.' };
            }
            case 'get-recovery-email': {
                let email = null;
                try {
                    const { data: userData } = await supabaseClient.auth.getUser();
                    if (userData && userData.user) {
                        const { data: rData } = await supabaseClient.from('admin_roles').select('email').eq('id', userData.user.id).single();
                        if (rData && rData.email) email = rData.email;
                    }
                } catch(e) {}
                if (!email) {
                    const { data: cfg } = await supabaseClient.from('app_config').select('value').eq('key', 'RECOVERY_EMAIL').single();
                    if (cfg && cfg.value) email = cfg.value;
                }
                return { ok: true, email: email };
            }
            case 'admin-forgot-password-request': {
                if (payload.username && payload.username.includes('@')) {
                    await supabaseClient.auth.resetPasswordForEmail(payload.username);
                }
                return { ok: true, message: 'Password reset request processed.' };
            }
            case 'admin-forgot-password-confirm': {
                if (payload.newPasswordHash || payload.newPassword) {
                    await supabaseClient.auth.updateUser({ password: payload.newPassword || payload.newPasswordHash });
                }
                return { ok: true, message: 'Password reset successful.' };
            }
            case 'get-hybrid-schedule': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: true, allowed: true, schedule: {} };

                const rawKey = payload.weekStart;
                const formattedKey = formatWeekKeyFromDmy(rawKey);
                // Build candidate formats
                const rawCandidates = [formattedKey, rawKey];
                if (formattedKey !== rawKey) {
                    const parts2 = formattedKey.split(' - ');
                    if (parts2.length === 2) {
                        const shortEnd = parts2[1].replace(/^\w+ /, '');
                        rawCandidates.push(`${parts2[0]} - ${shortEnd}`);
                    }
                }

                // Check tenant-scoped keys first: `${tenantSlug}::${k}`
                const candidates = rawCandidates.map(k => `${tenantSlug}::${k}`);
                // If lifecard, also allow fallback to unscoped legacy keys
                if (tenantSlug === 'lifecard') {
                    candidates.push(...rawCandidates);
                }

                let scheduleData = null;
                // Try exact match on each candidate key
                for (const key of candidates) {
                    const { data, error } = await supabaseClient
                        .from('hybrid_schedules')
                        .select('schedule_data, week_key')
                        .eq('week_key', key)
                        .limit(1);
                    if (!error && data && data.length) {
                        scheduleData = data[0].schedule_data;
                        break;
                    }
                }

                // Fallback: fetch recent rows and fuzzy-match the week_key by year + month
                if (!scheduleData) {
                    const year = formattedKey.match(/(\d{4})/)?.[1];
                    const monName = formattedKey.split(' ')[0];
                    if (year && monName) {
                        const { data: allRows } = await supabaseClient
                            .from('hybrid_schedules')
                            .select('schedule_data, week_key')
                            .order('week_key', { ascending: false })
                            .limit(50);
                        const match = (allRows || []).find(r => {
                            if (!r.week_key) return false;
                            const isMatchTenant = r.week_key.startsWith(`${tenantSlug}::`) || (tenantSlug === 'lifecard' && !r.week_key.includes('::'));
                            return isMatchTenant && r.week_key.includes(year) && r.week_key.includes(monName);
                        });
                        if (match) scheduleData = match.schedule_data;
                    }
                }

                if (!scheduleData) {
                    return { ok: true, allowed: true, schedule: {} };
                }

                let parsedSchedule = scheduleData;
                if (typeof parsedSchedule === 'string') {
                    try { parsedSchedule = JSON.parse(parsedSchedule); } catch(e) {}
                }
                return { ok: true, allowed: true, schedule: parsedSchedule };
            }
            case 'save-hybrid-schedule':
            case 'update-hybrid-schedule': {
                const tenantSlug = await resolveRequestedTenantSlug(payload);
                if (!tenantSlug) return { ok: false, message: 'No active workspace selected or authorized.' };
                const scopedKey = `${tenantSlug}::${payload.weekStart}`;
                const { error } = await supabaseClient
                    .from('hybrid_schedules')
                    .upsert({
                        week_key: scopedKey,
                        schedule_data: payload.scheduleData || payload.schedule,
                        timestamp: new Date().toISOString()
                    }, { onConflict: 'week_key' });
                if (error) throw error;
                // If lifecard, also keep legacy unscoped key synced for backwards compatibility
                if (tenantSlug === 'lifecard') {
                    try {
                        await supabaseClient.from('hybrid_schedules').upsert({
                            week_key: payload.weekStart,
                            schedule_data: payload.scheduleData || payload.schedule,
                            timestamp: new Date().toISOString()
                        }, { onConflict: 'week_key' });
                    } catch(e) {}
                }
                return { ok: true, message: 'Hybrid schedule saved.' };
            }
            case 'claim-account': {
                const { data, error } = await supabaseClient.rpc('claim_account', {
                    p_name: payload.name,
                    p_device_id: payload.deviceId || ''
                });
                if (error) throw error;
                return {
                    ok: data.ok,
                    allowed: data.ok,
                    email: data.email,
                    password: data.password,
                    message: data.message
                };
            }
            case 'verify-owner':
            case 'verify-user': {
                const activeTenant = await getActiveTenant(payload.tenantSlug);
                const tenantSlug = (payload.tenantSlug || (activeTenant ? activeTenant.slug : 'default')).toLowerCase();
                const staff = await getTenantStaffList(tenantSlug);
                const queryName = String(payload.name || '').trim().toLowerCase();
                const member = staff.find(s => String(s.name || '').trim().toLowerCase() === queryName);

                if (!member) {
                    const { data, error } = await supabaseClient.from('staff').select('device_id').eq('name', payload.name).single();
                    if (error || !data) return { ok: false, allowed: false, message: 'Staff member not found.' };
                    if (!data.device_id) return { ok: true, allowed: true, message: 'No device locked yet.' };
                    if (data.device_id === payload.deviceId) return { ok: true, allowed: true, message: 'Device verified.' };
                    const { data: conflictData } = await supabaseClient.from('staff').select('name').eq('device_id', payload.deviceId).single();
                    const conflictOwner = conflictData ? conflictData.name : 'another user';
                    return { ok: false, allowed: false, message: `This device is already registered to ${conflictOwner}. Device sharing is not allowed.` };
                }

                if (!member.device_id) return { ok: true, allowed: true, message: 'No device locked yet.' };
                if (member.device_id === payload.deviceId) return { ok: true, allowed: true, message: 'Device verified.' };

                const conflictMember = staff.find(s => s.device_id === payload.deviceId);
                const conflictOwner = conflictMember ? conflictMember.name : 'another user';
                return { ok: false, allowed: false, message: `This device is already registered to ${conflictOwner}. Device sharing is not allowed.` };
            }
            case 'register-owner': {
                const activeTenant = await getActiveTenant(payload.tenantSlug);
                const tenantSlug = (payload.tenantSlug || (activeTenant ? activeTenant.slug : 'default')).toLowerCase();
                const staff = await getTenantStaffList(tenantSlug);
                const queryName = String(payload.name || '').trim().toLowerCase();
                const member = staff.find(s => String(s.name || '').trim().toLowerCase() === queryName);

                if (member) {
                    if (member.device_id === payload.deviceId) return { ok: true, allowed: true };
                    if (member.device_id) return { ok: false, allowed: false, message: 'Already registered to another device.' };

                    const conflictMember = staff.find(s => s.device_id === payload.deviceId && String(s.name || '').trim().toLowerCase() !== queryName);
                    if (conflictMember) {
                        return { ok: false, allowed: false, message: `This device is already registered to ${conflictMember.name}. Device sharing is not allowed.` };
                    }

                    member.device_id = payload.deviceId;
                    member.device_token = payload.deviceToken || null;
                    delete member.was_unlinked_by_admin;
                    await saveTenantStaffList(tenantSlug, staff);
                }

                try {
                    const { data } = await supabaseClient.from('staff').select('device_id').eq('name', payload.name).single();
                    if (data && !data.device_id) {
                        await supabaseClient.from('staff').update({ device_id: payload.deviceId }).eq('name', payload.name);
                    }
                } catch(e) {}

                return { ok: true, allowed: true, message: 'Device registered successfully.' };
            }
            case 'reassign-owner': {
                return { ok: false, allowed: false, message: 'Please see the administrator to reset your device lock.' };
            }
            case 'list-tenants': {
                const tenants = await getTenantRegistry();
                return { ok: true, tenants };
            }
            case 'check-tenant-slug': {
                const slug = String(payload.slug || '').trim().toLowerCase();
                if (!slug) return { ok: false, available: false, message: 'Workspace identifier is empty.' };
                const registry = await getTenantRegistry();
                const exists = registry.some(t => t.slug && t.slug.toLowerCase() === slug);
                return { ok: true, available: !exists, slug };
            }
            case 'onboard-tenant': {
                const tenantData = payload.tenant;
                if (!tenantData || !tenantData.name) {
                    return { ok: false, message: 'Company name is required.' };
                }
                const slug = String(tenantData.slug || tenantData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '');
                const registry = await getTenantRegistry();
                if (registry.find(t => t.slug.toLowerCase() === slug)) {
                    return { ok: false, message: `Workspace identifier '${slug}' is already registered. Please choose another one.` };
                }
                const newTenant = {
                    id: slug,
                    slug: slug,
                    name: String(tenantData.name).trim(),
                    tagline: String(tenantData.tagline || 'Staff Attendance & Workplace Portal').trim(),
                    logo_url: String(tenantData.logo_url || '').trim(),
                    brand_color: String(tenantData.brand_color || '#1a56db').trim(),
                    office_name: String(tenantData.office_name || 'Main Office').trim(),
                    latitude: Number(tenantData.latitude) || 6.4357,
                    longitude: Number(tenantData.longitude) || 3.4738,
                    radius: Number(tenantData.radius) || 100,
                    admin_name: String(tenantData.admin_name || '').trim(),
                    admin_email: String(tenantData.admin_email || '').trim(),
                    plan_tier: tenantData.plan_tier || 'Pro',
                    subscription_status: 'trialing',
                    trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
                    grace_period_ends_at: null,
                    retention_discount_applied: false,
                    status: 'active',
                    created_at: new Date().toISOString()
                };
                registry.push(newTenant);
                await saveTenantRegistry(registry);
                return { ok: true, message: 'Tenant onboarded successfully!', tenant: newTenant };
            }
            case 'apply-retention-deal': {
                const slug = String(payload.slug || '').trim().toLowerCase();
                const discount = Number(payload.discount_percent) || 50;
                const months = Number(payload.duration_months) || 3;
                if (!slug) return { ok: false, message: 'Workspace identifier is required.' };
                const registry = await getTenantRegistry();
                const idx = registry.findIndex(t => t.slug && t.slug.toLowerCase() === slug);
                if (idx >= 0) {
                    registry[idx].retention_discount_applied = true;
                    registry[idx].retention_discount_percent = discount;
                    registry[idx].retention_deal_months = months;
                    registry[idx].retention_applied_at = new Date().toISOString();
                    await saveTenantRegistry(registry);
                }
                await logAuditEvent({
                    type: 'BILLING_RETENTION_DEAL_ACCEPTED',
                    details: `Retention discount applied (${discount}% off for ${months} months) for tenant: ${slug}`
                });
                return { ok: true, message: 'Retention deal applied successfully.' };
            }
            case 'apply-coupon': {
                const slug = String(payload.tenantSlug || payload.slug || '').trim().toLowerCase();
                const code = String(payload.couponCode || '').trim().toUpperCase();
                if (!slug) return { ok: false, message: 'Workspace identifier is required.' };
                if (!code) return { ok: false, message: 'Coupon code required.' };

                let daysToAdd = 0;
                let discountPercent = 0;
                let message = '';

                if (code === 'EXTEND14') {
                    daysToAdd = 14;
                    message = 'Promo code applied! 14 days added to your free trial.';
                } else if (code === 'VIP30') {
                    daysToAdd = 30;
                    message = 'VIP coupon applied! 30 days added to your free trial.';
                } else if (code === 'WELCOME50') {
                    discountPercent = 50;
                    message = 'Welcome coupon applied! 50% discount activated for 3 months.';
                } else {
                    return { ok: false, message: 'Invalid or unrecognized coupon code.' };
                }

                const registry = await getTenantRegistry();
                const idx = registry.findIndex(t => t.slug && t.slug.toLowerCase() === slug);
                let newTrialEnd = null;

                if (idx >= 0) {
                    if (daysToAdd > 0) {
                        const curEnd = registry[idx].trial_ends_at ? new Date(registry[idx].trial_ends_at) : new Date();
                        const baseDate = curEnd.getTime() > Date.now() ? curEnd : new Date();
                        baseDate.setDate(baseDate.getDate() + daysToAdd);
                        newTrialEnd = baseDate.toISOString();
                        registry[idx].trial_ends_at = newTrialEnd;
                    }
                    if (discountPercent > 0) {
                        registry[idx].retention_discount_applied = true;
                        registry[idx].retention_discount_percent = discountPercent;
                    }
                    await saveTenantRegistry(registry);
                }

                try {
                    const dbUpdates = {};
                    if (newTrialEnd) dbUpdates.trial_ends_at = newTrialEnd;
                    if (discountPercent > 0) {
                        dbUpdates.retention_discount_applied = true;
                        dbUpdates.retention_discount_percent = discountPercent;
                    }
                    if (Object.keys(dbUpdates).length > 0) {
                        await supabaseClient.from('tenants').update(dbUpdates).eq('slug', slug);
                    }
                } catch(e) {}

                await logAuditEvent({
                    type: 'BILLING_COUPON_REDEEMED',
                    details: `Coupon ${code} redeemed by tenant ${slug}: ${message}`
                });

                return { 
                    ok: true, 
                    message, 
                    newTrialEnd, 
                    discountApplied: discountPercent > 0 
                };
            }
            case 'extend-tenant-trial': {
                const slug = String(payload.tenantSlug || payload.slug || '').trim().toLowerCase();
                const days = parseInt(payload.days, 10) || 14;
                if (!slug) return { ok: false, message: 'Workspace identifier is required.' };

                const registry = await getTenantRegistry();
                const idx = registry.findIndex(t => t.slug && t.slug.toLowerCase() === slug);
                let newTrialEnd = null;

                if (idx >= 0) {
                    const curEnd = registry[idx].trial_ends_at ? new Date(registry[idx].trial_ends_at) : new Date();
                    const baseDate = curEnd.getTime() > Date.now() ? curEnd : new Date();
                    baseDate.setDate(baseDate.getDate() + days);
                    newTrialEnd = baseDate.toISOString();
                    registry[idx].trial_ends_at = newTrialEnd;
                    await saveTenantRegistry(registry);
                }

                try {
                    if (newTrialEnd) {
                        await supabaseClient.from('tenants').update({ trial_ends_at: newTrialEnd }).eq('slug', slug);
                    }
                } catch(e) {}

                await logAuditEvent({
                    type: 'SUPER_ADMIN_TRIAL_EXTENDED',
                    details: `Trial extended by ${days} days for tenant ${slug}. New end: ${newTrialEnd}`
                });

                return { ok: true, message: `Trial successfully extended by ${days} days.`, newTrialEnd };
            }
            case 'update-tenant': {
                const { slug, updates } = payload;
                if (!slug) return { ok: false, message: 'Workspace identifier is required.' };
                const registry = await getTenantRegistry();
                const idx = registry.findIndex(t => (t.slug && t.slug.toLowerCase() === slug.toLowerCase()) || (t.id && t.id.toLowerCase() === slug.toLowerCase()));
                if (idx === -1) return { ok: false, message: 'Tenant not found.' };
                registry[idx] = { ...registry[idx], ...updates };
                await saveTenantRegistry(registry);
                return { ok: true, message: 'Tenant updated successfully.', tenant: registry[idx] };
            }
            case 'verify-staff-member': {
                const activeTenant = await getActiveTenant(payload.tenantSlug);
                const tenantSlug = (payload.tenantSlug || (activeTenant ? activeTenant.slug : 'default')).toLowerCase();
                const queryName = String(payload.name || '').trim().toLowerCase();
                if (!queryName) return { ok: false, message: 'Please enter your registered staff name.' };

                const staff = await getTenantStaffList(tenantSlug);
                const member = staff.find(s => String(s.name || '').trim().toLowerCase() === queryName);

                if (!member) {
                    return { ok: false, message: `No registered staff found matching "${payload.name}" for ${activeTenant ? activeTenant.name : 'this company'}. Please verify your spelling or contact HR.` };
                }

                const wasUnlinked = Boolean(member.was_unlinked_by_admin);
                if (wasUnlinked) {
                    delete member.was_unlinked_by_admin;
                    await saveTenantStaffList(tenantSlug, staff);
                }

                return {
                    ok: true,
                    name: member.name,
                    dept: member.dept || 'General',
                    schedule_policy: member.schedule_policy || 'weekly_hybrid',
                    is_team_lead: Boolean(member.is_team_lead),
                    is_linked: Boolean(member.device_id),
                    was_unlinked_by_admin: wasUnlinked
                };
            }
            case 'unlink-staff-device': {
                const activeTenant = await getActiveTenant(payload.tenantSlug);
                const tenantSlug = (payload.tenantSlug || (activeTenant ? activeTenant.slug : 'default')).toLowerCase();
                const staff = await getTenantStaffList(tenantSlug);
                const targetName = String(payload.name || '').trim().toLowerCase();
                const member = staff.find(s => String(s.name || '').trim().toLowerCase() === targetName);
                if (member) {
                    member.device_id = null;
                    member.device_token = null;
                    member.was_unlinked_by_admin = true;
                    await saveTenantStaffList(tenantSlug, staff);
                }
                try { await supabaseClient.from('staff').update({ device_id: null }).eq('name', payload.name); } catch(e) {}
                return { ok: true, message: `Device unlinked for ${payload.name}.` };
            }
            case 'update-tenant-config': {
                const activeTenant = await getActiveTenant(payload.tenantSlug);
                const slug = (payload.tenantSlug || (activeTenant ? activeTenant.slug : 'default')).toLowerCase();
                const currentConfig = await getTenantConfig(slug);
                const updated = { ...currentConfig, ...(payload.config || {}) };
                await saveTenantConfig(slug, updated);
                return { ok: true, message: 'Tenant configuration updated successfully.', config: updated };
            }
            case 'super-admin-update-tenant-full': {
                const { slug, updates, config } = payload;
                if (!slug) return { ok: false, message: 'Workspace identifier is required.' };
                const registry = await getTenantRegistry();
                const idx = registry.findIndex(t => (t.slug && t.slug.toLowerCase() === slug.toLowerCase()) || (t.id && t.id.toLowerCase() === slug.toLowerCase()));
                if (idx === -1) return { ok: false, message: 'Tenant not found in registry.' };

                // Handle slug rename if requested
                const newSlug = updates && updates.slug ? String(updates.slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '') : slug;
                if (newSlug !== slug.toLowerCase() && registry.some(t => t.slug.toLowerCase() === newSlug)) {
                    return { ok: false, message: `Workspace identifier '${newSlug}' is already registered.` };
                }

                // If slug changed, migrate staff and config keys
                if (newSlug !== slug.toLowerCase()) {
                    const existingStaff = await getTenantStaffList(slug);
                    const existingConfig = await getTenantConfig(slug);
                    await saveTenantStaffList(newSlug, existingStaff);
                    await saveTenantConfig(newSlug, existingConfig);
                    try {
                        await supabaseClient.from('app_config').delete().in('key', [`TENANT_STAFF_${slug}`, `TENANT_CONFIG_${slug}`]);
                    } catch(e) {}
                }

                registry[idx] = { ...registry[idx], ...updates, slug: newSlug, id: newSlug };
                await saveTenantRegistry(registry);

                if (config) {
                    await saveTenantConfig(newSlug, config);
                }

                return { ok: true, message: 'Tenant master profile updated successfully.', tenant: registry[idx] };
            }
            case 'super-admin-delete-tenant': {
                const { slug } = payload;
                if (!slug) return { ok: false, message: 'Workspace identifier is required.' };
                const cleanSlug = slug.trim().toLowerCase();
                let registry = await getTenantRegistry();
                registry = registry.filter(t => t.slug.toLowerCase() !== cleanSlug && t.id.toLowerCase() !== cleanSlug);
                await saveTenantRegistry(registry);

                // Clean up app_config keys
                try {
                    await supabaseClient.from('app_config').delete().in('key', [`TENANT_STAFF_${cleanSlug}`, `TENANT_CONFIG_${cleanSlug}`]);
                } catch(e) {}

                return { ok: true, message: `Tenant '${slug}' was successfully deleted.` };
            }
            case 'super-admin-reset-tenant-password': {
                const { slug, newPassword } = payload;
                if (!slug || !newPassword) return { ok: false, message: 'Workspace identifier and new password are required.' };
                const registry = await getTenantRegistry();
                const tenant = registry.find(t => t.slug.toLowerCase() === slug.toLowerCase() || t.id.toLowerCase() === slug.toLowerCase());
                if (!tenant) return { ok: false, message: 'Tenant not found.' };

                tenant.admin_password = newPassword;
                await saveTenantRegistry(registry);
                return { ok: true, message: `Admin password for ${tenant.name} was successfully reset.` };
            }
            case 'super-admin-purge-tenant-logs': {
                const { slug } = payload;
                if (!slug) return { ok: false, message: 'Workspace identifier is required.' };
                try {
                    await supabaseClient.from('attendance').delete().eq('tenant_slug', slug.toLowerCase());
                } catch(e) {}
                return { ok: true, message: `Attendance history purged for ${slug}.` };
            }
            default:
                // For unmapped endpoints, return false so the UI knows it's not implemented yet
                return { ok: false, allowed: false, message: `Endpoint '${mode}' is not implemented in Supabase yet.` };
        }
    } catch (err) {
        console.error('Supabase Error:', err);
        return { ok: false, allowed: false, message: err.message || 'Database error.' };
    }
}

function normalizeBackendResponse(data) {
    if (!data) return { ok: false, allowed: false, message: 'No response from backend.', raw: null };
    if (data.result !== undefined) {
        const normalized = normalizeBackendResponse(data.result);
        if (normalized.raw === null && typeof data.result === 'string') {
            normalized.raw = data.result;
        }
        return normalized;
    }
    if (typeof data === 'string') {
        const parts = data.split('|');
        const isSuccess = ['WELCOME', 'LATE', 'NORMAL'].includes(parts[0]);
        return { ok: isSuccess, allowed: isSuccess, message: parts[1] || data, raw: data };
    }
    return {
        ok: data.ok === true || data.allowed === true,
        allowed: data.allowed === true || data.ok === true,
        message: data.message || data.result || 'Backend response received.',
        staff: data.staff || null,
        owner: data.owner || data.deviceOwner || null,
        logs: data.logs || null,
        config: data.config || null,
        schedule: data.schedule || null,
        csrfToken: data.csrfToken || null,
        adminToken: data.adminToken || null,
        raw: null
    };
}

/* ---------- Theme ---------- */

function applyTheme(theme, animate = false) {
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');
    const isDark = theme === 'dark';

    const updateDOM = () => {
        root.setAttribute('data-theme', isDark ? 'dark' : 'light');
        if (toggle) {
            if (window.lucide && typeof window.lucide.createIcons === 'function') {
                toggle.innerHTML = isDark ? '<i data-lucide="sun" size="16"></i>' : '<i data-lucide="moon" size="16"></i>';
                window.lucide.createIcons();
            } else {
                toggle.textContent = isDark ? 'Light' : 'Dark';
            }
            toggle.setAttribute('aria-pressed', String(isDark));
            toggle.setAttribute('title', isDark ? 'Switch to light mode' : 'Switch to dark mode');
        }
        try {
            safeStorage.setItem(STORAGE_KEYS.theme, isDark ? 'dark' : 'light');
        } catch (e) {
            console.warn('localStorage not available:', e);
        }
    };

    if (animate && typeof document.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.startViewTransition(() => {
            updateDOM();
        });
    } else {
        updateDOM();
    }
}

function initTheme() {
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;
    
    let saved = null;
    try {
        saved = safeStorage.getItem(STORAGE_KEYS.theme);
    } catch (e) {
        console.warn('localStorage not available:', e);
    }
    
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved === 'dark' || (!saved && prefersDark) ? 'dark' : 'light', false);
    
    toggle.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        applyTheme(next, true);
    });
}

/* ---------- Hard refresh ---------- */

async function hardRefresh() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
    }
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((reg) => reg.unregister()));
        }
        if (window.caches && caches.keys) {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => caches.delete(key)));
        }
    } catch (error) {
        console.warn('Error clearing service worker/cache during refresh:', error);
    } finally {
        window.location.reload();
    }
}

function initRefreshButton() {
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', hardRefresh);
    }
}

/* ---------- Show/hide password toggle ---------- */

function initPasswordToggle(toggleEl) {
    const targetId = toggleEl.getAttribute('data-toggle-target');
    const input = document.getElementById(targetId);
    if (!input || toggleEl.dataset.toggleBound) return;
    toggleEl.dataset.toggleBound = 'true';

    const syncToggleState = () => {
        const isHidden = input.type === 'password';
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            toggleEl.innerHTML = isHidden ? '<i data-lucide="eye" size="14"></i>' : '<i data-lucide="eye-off" size="14"></i>';
            window.lucide.createIcons();
        } else {
            toggleEl.textContent = isHidden ? 'Show' : 'Hide';
        }
        toggleEl.setAttribute('aria-label', isHidden ? 'Show password' : 'Hide password');
        toggleEl.classList.toggle('visible', !isHidden);
    };

    syncToggleState();
    toggleEl.addEventListener('click', () => {
        const isHidden = input.type === 'password';
        input.type = isHidden ? 'text' : 'password';
        syncToggleState();
    });
}

function initAllPasswordToggles(root = document) {
    root.querySelectorAll('[data-toggle-target]').forEach(initPasswordToggle);
}

/* ---------- Formatting ---------- */

function formatTimestamp(isoString) {
    if (!isoString) return 'Pending';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Pending';
    const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateStr}, ${timeStr}`;
}

function formatRelativeTimestamp(isoString) {
    if (!isoString) return 'Pending';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return 'Pending';

    const now = new Date();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

    const isToday = date.getFullYear() === now.getFullYear() &&
                    date.getMonth() === now.getMonth() &&
                    date.getDate() === now.getDate();

    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const isYesterday = date.getFullYear() === yesterday.getFullYear() &&
                        date.getMonth() === yesterday.getMonth() &&
                        date.getDate() === yesterday.getDate();

    if (isToday) {
        return `Today, ${timeStr}`;
    } else if (isYesterday) {
        return `Yesterday, ${timeStr}`;
    } else {
        const day = String(date.getDate()).padStart(2, '0');
        const month = date.toLocaleDateString([], { month: 'short' });
        return `${day} ${month}, ${timeStr}`;
    }
}

function formatDateDisplay(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' + date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/* ---------- Toast notifications ---------- */

let toastTimer = null;

function showToast(message, type = 'default', durationMs = 3400) {
    let toastEl = document.getElementById('app-toast');
    if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.id = 'app-toast';
        document.body.appendChild(toastEl);
    }
    let iconSvg = '';
    if (type === 'success') {
        iconSvg = '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    } else if (type === 'error') {
        iconSvg = '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    } else {
        iconSvg = '<svg class="toast-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
    }
    toastEl.innerHTML = `${iconSvg}<span style="flex:1;">${escapeHtml(message)}</span>`;
    toastEl.className = `toast visible${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ' toast-info'}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toastEl.classList.remove('visible');
    }, durationMs);
}

/* ---------- Inline dialog ---------- */

function showInlineDialog({ title, message, fields = [], confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, customContentHtml = '' }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';
        const fieldsHtml = fields.map((field, idx) => {
            const inputId = `dialog-field-${idx}`;
            const labelHtml = field.label ? `<label for="${inputId}" style="display:block; font-size:0.78rem; font-weight:600; color:var(--text-muted); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.04em;">${escapeHtml(field.label)}</label>` : '';
            if (field.type === 'select') {
                const optionsHtml = (field.options || []).map(opt => `
                    <option value="${escapeHtml(opt.value)}" ${field.value === opt.value ? 'selected' : ''}>${escapeHtml(opt.label)}</option>
                `).join('');
                return `
                    <div style="margin-bottom:12px;">
                        ${labelHtml}
                        <select id="${inputId}" class="dialog-select" style="width:100%; padding:8px 12px; border-radius:6px; border:1px solid var(--border); background:var(--surface-2); color:var(--text); font-size:0.88rem;">
                            ${optionsHtml}
                        </select>
                    </div>
                `;
            }

            const prefilledValue = (field.value !== undefined && field.value !== null) ? escapeHtml(String(field.value)) : '';
            const input = `
                <input
                    id="${inputId}"
                    type="${field.type || 'text'}"
                    placeholder="${escapeHtml(field.placeholder || '')}"
                    autocomplete="${field.autocomplete || 'off'}"
                    value="${prefilledValue}"
                />
            `;
            if (field.type === 'password') {
                return `
                    <div style="margin-bottom:12px;">
                        ${labelHtml}
                        <div class="password-field-wrap" style="margin-bottom:0;">
                            ${input}
                            <button type="button" class="password-toggle" data-toggle-target="${inputId}" aria-label="Show password"><i data-lucide="eye" size="14"></i></button>
                        </div>
                    </div>
                `;
            }
            return `<div style="margin-bottom:12px;">${labelHtml}${input}</div>`;
        }).join('');
        overlay.innerHTML = `
            <div class="dialog-box">
                <h3>${escapeHtml(title)}</h3>
                ${message ? `<p style="color:var(--text-muted); font-size:0.88rem; margin-bottom:14px;">${escapeHtml(message)}</p>` : ''}
                ${fieldsHtml}
                ${customContentHtml}
                <div class="dialog-actions">
                    <button type="button" class="admin-btn secondary" data-action="cancel">${escapeHtml(cancelLabel)}</button>
                    <button type="button" class="admin-btn${danger ? ' danger' : ''}" data-action="confirm">${escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        initAllPasswordToggles(overlay);

        const cleanup = (result) => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector('[data-action="cancel"]').addEventListener('click', () => cleanup(null));
        overlay.querySelector('[data-action="confirm"]').addEventListener('click', () => {
            const values = fields.map((field, idx) => {
                const raw = overlay.querySelector(`#dialog-field-${idx}`).value;
                return field.type === 'password' ? raw : raw.trim();
            });
            // Only require non-empty for fields that are not optional
            const missingRequired = fields.some((field, idx) => !field.optional && !values[idx]);
            if (fields.length && missingRequired) {
                showToast('Please fill in all required fields.', 'error');
                return;
            }
            // Capture all custom select/input values before overlay removal
            const customSelects = overlay.querySelectorAll('select');
            customSelects.forEach(sel => {
                if (sel.id) window['_dialogVal_' + sel.id] = sel.value;
            });
            cleanup(fields.length ? values : true);
        });
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) cleanup(null);
        });
        overlay.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') cleanup(null);
        });

        const firstInput = overlay.querySelector('input');
        if (firstInput) firstInput.focus();
    });
}

function confirmDialog(message, { danger = false, confirmLabel = 'Confirm', title = 'Please confirm' } = {}) {
    return showInlineDialog({ title, message, confirmLabel, danger }).then((result) => result === true);
}

function promptDialog(title, placeholder = '', type = 'text') {
    return showInlineDialog({ title, fields: [{ placeholder, type }] }).then((result) => (result ? result[0] : null));
}
