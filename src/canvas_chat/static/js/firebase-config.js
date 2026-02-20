/**
 * Firebase Configuration & Initialization
 *
 * Uses Firebase compat SDK loaded via CDN in index.html.
 * Config values are public (they identify the project, not grant access).
 * Authentication is handled by Firebase Auth; Firestore rules protect data.
 */

/* global firebase */

const firebaseConfig = {
  apiKey: "AIzaSyBeNG4c_E8E3PpvI4KIjTDVsam7HZdUUxQ",
  authDomain: "canvas-chat-5e388.firebaseapp.com",
  projectId: "canvas-chat-5e388",
  storageBucket: "canvas-chat-5e388.firebasestorage.app",
  messagingSenderId: "687611975323",
  appId: "1:687611975323:web:d2e60557a334711402d83e"
};


let _app = null;
let _auth = null;
let _db = null;
let _initialized = false;

/**
 * Initialize Firebase app, auth, and Firestore.
 * Safe to call multiple times — subsequent calls are no-ops.
 * @returns {{ app: object, auth: object, db: object } | null} Firebase instances, or null if SDK not loaded
 */
export function initFirebase() {
    if (_initialized) {
        return { app: _app, auth: _auth, db: _db };
    }

    if (typeof firebase === 'undefined') {
        console.warn('[Firebase] SDK not loaded — skipping initialization');
        return null;
    }

    try {
        _app = firebase.initializeApp(firebaseConfig);
        _auth = firebase.auth();
        _db = firebase.firestore();

        // Enable offline persistence (queues writes when disconnected)
        _db.enablePersistence({ synchronizeTabs: true }).catch((err) => {
            if (err.code === 'failed-precondition') {
                console.warn('[Firebase] Persistence failed: multiple tabs open');
            } else if (err.code === 'unimplemented') {
                console.warn('[Firebase] Persistence not available in this browser');
            }
        });

        _initialized = true;
        console.log('[Firebase] Initialized successfully');
        return { app: _app, auth: _auth, db: _db };
    } catch (err) {
        console.error('[Firebase] Initialization failed:', err);
        return null;
    }
}

/**
 * Get the Firebase Auth instance (must call initFirebase first).
 * @returns {object|null}
 */
export function getAuth() {
    return _auth;
}

/**
 * Get the Firestore instance (must call initFirebase first).
 * @returns {object|null}
 */
export function getFirestore() {
    return _db;
}

/**
 * Check if Firebase has been initialized.
 * @returns {boolean}
 */
export function isFirebaseInitialized() {
    return _initialized;
}
