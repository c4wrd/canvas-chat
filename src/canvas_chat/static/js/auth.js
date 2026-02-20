/**
 * Auth Manager — Google Sign-In via Firebase Auth
 *
 * Provides sign-in/out, auth state listener, and ID token retrieval
 * for backend API authentication.
 */

/* global firebase */

import { getAuth } from './firebase-config.js';

/**
 * @typedef {Object} AuthUser
 * @property {string} uid
 * @property {string|null} displayName
 * @property {string|null} email
 * @property {string|null} photoURL
 */

/**
 *
 */
class AuthManager {
    /**
     *
     */
    constructor() {
        /** @type {AuthUser|null} */
        this.user = null;
        /** @type {Function[]} */
        this._listeners = [];
        this._initialized = false;
    }

    /**
     * Start listening to auth state changes.
     * Call after initFirebase().
     */
    init() {
        const auth = getAuth();
        if (!auth) {
            console.warn('[Auth] Firebase Auth not available');
            return;
        }

        auth.onAuthStateChanged((firebaseUser) => {
            if (firebaseUser) {
                this.user = {
                    uid: firebaseUser.uid,
                    displayName: firebaseUser.displayName,
                    email: firebaseUser.email,
                    photoURL: firebaseUser.photoURL,
                };
                console.log('[Auth] Signed in:', this.user.email);
            } else {
                this.user = null;
                console.log('[Auth] Signed out');
            }
            this._initialized = true;
            this._notifyListeners();
        });
    }

    /**
     * Sign in with Google popup.
     * @returns {Promise<AuthUser>}
     */
    async signIn() {
        const auth = getAuth();
        if (!auth) throw new Error('Firebase Auth not available');

        const provider = new firebase.auth.GoogleAuthProvider();
        const result = await auth.signInWithPopup(provider);
        return {
            uid: result.user.uid,
            displayName: result.user.displayName,
            email: result.user.email,
            photoURL: result.user.photoURL,
        };
    }

    /**
     * Sign out.
     * @returns {Promise<void>}
     */
    async signOut() {
        const auth = getAuth();
        if (!auth) return;
        await auth.signOut();
    }

    /**
     * Get a fresh ID token for backend API calls.
     * Returns null if not signed in.
     * @returns {Promise<string|null>}
     */
    async getIdToken() {
        const auth = getAuth();
        if (!auth || !auth.currentUser) return null;
        return auth.currentUser.getIdToken();
    }

    /**
     * Check if the user is currently signed in.
     * @returns {boolean}
     */
    isSignedIn() {
        return this.user !== null;
    }

    /**
     * Register a callback for auth state changes.
     * @param {function(AuthUser|null): void} callback
     * @returns {function(): void} Unsubscribe function
     */
    onAuthStateChanged(callback) {
        this._listeners.push(callback);
        // If already initialized, fire immediately with current state
        if (this._initialized) {
            callback(this.user);
        }
        return () => {
            this._listeners = this._listeners.filter((cb) => cb !== callback);
        };
    }

    /** @private */
    _notifyListeners() {
        for (const cb of this._listeners) {
            try {
                cb(this.user);
            } catch (err) {
                console.error('[Auth] Listener error:', err);
            }
        }
    }
}

// Singleton
const authManager = new AuthManager();

export { AuthManager, authManager };
