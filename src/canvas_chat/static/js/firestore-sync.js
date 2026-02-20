/**
 * Firestore Sync Engine
 *
 * Handles syncing sessions, settings, and artifacts to/from Cloud Firestore.
 * Designed as a write-through layer: IndexedDB remains primary,
 * Firestore syncs in background when signed in.
 */

import { getFirestore } from './firebase-config.js';

/** Max operations per Firestore batch (limit is 500, use 400 for safety) */
const BATCH_CHUNK_SIZE = 400;

/** Debounce delay for Firestore writes (ms) */
const SYNC_DEBOUNCE_MS = 2500;

/**
 *
 */
class FirestoreSync {
    /**
     * @param {string} uid - Firebase Auth user ID
     */
    constructor(uid) {
        this.uid = uid;
        this.db = getFirestore();
        this._debounceTimers = new Map();
        this._unsubscribers = [];

        if (!this.db) {
            throw new Error('Firestore not initialized');
        }
    }

    // =========================================================================
    // Sessions
    // =========================================================================

    /**
     * Save a session to Firestore (metadata + nodes/edges as subcollections).
     * Debounced to reduce write frequency.
     * @param {Object} session - Full session object with nodes and edges
     * @returns {Promise<void>}
     */
    saveSession(session) {
        return new Promise((resolve) => {
            const key = `session-${session.id}`;
            if (this._debounceTimers.has(key)) {
                clearTimeout(this._debounceTimers.get(key));
            }
            this._debounceTimers.set(
                key,
                setTimeout(async () => {
                    this._debounceTimers.delete(key);
                    try {
                        await this._writeSession(session);
                    } catch (err) {
                        console.error('[FirestoreSync] saveSession error:', err);
                    }
                    resolve();
                }, SYNC_DEBOUNCE_MS)
            );
        });
    }

    /**
     * Write session data to Firestore immediately.
     * @param session
     * @private
     */
    async _writeSession(session) {
        const sessionRef = this.db
            .collection('users')
            .doc(this.uid)
            .collection('sessions')
            .doc(session.id);

        // Write session metadata (without nodes/edges)
        const metadata = {
            name: session.name || 'Untitled Session',
            created_at: session.created_at || Date.now(),
            updated_at: session.updated_at || Date.now(),
            node_count: session.nodes ? session.nodes.length : 0,
        };

        if (session.tags) {
            metadata.tags = session.tags;
        }

        if (session.viewport) {
            metadata.viewport = session.viewport;
        }

        await sessionRef.set(metadata, { merge: true });

        // Write nodes in batches
        if (session.nodes && session.nodes.length > 0) {
            await this._batchWrite(
                sessionRef.collection('nodes'),
                session.nodes,
                (node) => node.id,
                (node) => ({ ...node })
            );
        }

        // Write edges in batches
        if (session.edges && session.edges.length > 0) {
            await this._batchWrite(
                sessionRef.collection('edges'),
                session.edges,
                (edge) => edge.id,
                (edge) => ({ ...edge })
            );
        }

        console.log(`[FirestoreSync] Session saved: ${session.id}`);
    }

    /**
     * Batch-write items to a subcollection, chunked for Firestore limits.
     * @param collectionRef
     * @param items
     * @param getId
     * @param toData
     * @private
     */
    async _batchWrite(collectionRef, items, getId, toData) {
        for (let i = 0; i < items.length; i += BATCH_CHUNK_SIZE) {
            const chunk = items.slice(i, i + BATCH_CHUNK_SIZE);
            const batch = this.db.batch();

            for (const item of chunk) {
                const docRef = collectionRef.doc(getId(item));
                batch.set(docRef, toData(item));
            }

            await batch.commit();
        }
    }

    /**
     * Load a session from Firestore, including nodes and edges subcollections.
     * @param {string} sessionId
     * @returns {Promise<Object|null>}
     */
    async getSession(sessionId) {
        const sessionRef = this.db
            .collection('users')
            .doc(this.uid)
            .collection('sessions')
            .doc(sessionId);

        const doc = await sessionRef.get();
        if (!doc.exists) return null;

        const session = { id: doc.id, ...doc.data() };

        // Load nodes subcollection
        const nodesSnap = await sessionRef.collection('nodes').get();
        session.nodes = nodesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Load edges subcollection
        const edgesSnap = await sessionRef.collection('edges').get();
        session.edges = edgesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        return session;
    }

    /**
     * List session metadata (no nodes/edges loaded).
     * @returns {Promise<Array<Object>>}
     */
    async listSessions() {
        const snapshot = await this.db
            .collection('users')
            .doc(this.uid)
            .collection('sessions')
            .orderBy('updated_at', 'desc')
            .get();

        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }

    /**
     * Delete a session and its subcollections.
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async deleteSession(sessionId) {
        const sessionRef = this.db
            .collection('users')
            .doc(this.uid)
            .collection('sessions')
            .doc(sessionId);

        // Delete subcollection documents first
        await this._deleteCollection(sessionRef.collection('nodes'));
        await this._deleteCollection(sessionRef.collection('edges'));

        // Delete session document
        await sessionRef.delete();

        console.log(`[FirestoreSync] Session deleted: ${sessionId}`);
    }

    /**
     * Delete all documents in a collection (Firestore has no native collection delete).
     * @param collectionRef
     * @private
     */
    async _deleteCollection(collectionRef) {
        const snapshot = await collectionRef.get();
        if (snapshot.empty) return;

        for (let i = 0; i < snapshot.docs.length; i += BATCH_CHUNK_SIZE) {
            const chunk = snapshot.docs.slice(i, i + BATCH_CHUNK_SIZE);
            const batch = this.db.batch();
            for (const doc of chunk) {
                batch.delete(doc.ref);
            }
            await batch.commit();
        }
    }

    /**
     * Listen to the session list for real-time updates.
     * @param {function(Array<Object>): void} callback
     * @returns {function(): void} Unsubscribe function
     */
    listenToSessionList(callback) {
        const unsubscribe = this.db
            .collection('users')
            .doc(this.uid)
            .collection('sessions')
            .orderBy('updated_at', 'desc')
            .onSnapshot(
                (snapshot) => {
                    const sessions = snapshot.docs.map((doc) => ({
                        id: doc.id,
                        ...doc.data(),
                    }));
                    callback(sessions);
                },
                (err) => {
                    console.error('[FirestoreSync] Session list listener error:', err);
                }
            );

        this._unsubscribers.push(unsubscribe);
        return unsubscribe;
    }

    // =========================================================================
    // Settings (non-sensitive preferences only — no API keys)
    // =========================================================================

    /**
     * Save syncable settings to Firestore.
     * @param {Object} settings
     * @returns {Promise<void>}
     */
    async saveSettings(settings) {
        await this.db.collection('users').doc(this.uid).collection('settings').doc('preferences').set(settings, { merge: true });

        console.log('[FirestoreSync] Settings saved');
    }

    /**
     * Load synced settings from Firestore.
     * @returns {Promise<Object|null>}
     */
    async getSettings() {
        const doc = await this.db
            .collection('users')
            .doc(this.uid)
            .collection('settings')
            .doc('preferences')
            .get();

        return doc.exists ? doc.data() : null;
    }

    // =========================================================================
    // User Profile
    // =========================================================================

    /**
     * Save or update user profile in Firestore.
     * @param {Object} profile - { displayName, email, photoURL }
     * @returns {Promise<void>}
     */
    async saveProfile(profile) {
        await this.db
            .collection('users')
            .doc(this.uid)
            .set(
                {
                    profile: {
                        ...profile,
                        updated_at: Date.now(),
                    },
                },
                { merge: true }
            );
    }

    // =========================================================================
    // Artifacts
    // =========================================================================

    /**
     * Listen to user's artifacts collection for real-time updates.
     * @param {function(Array<Object>): void} callback
     * @returns {function(): void} Unsubscribe function
     */
    listenToArtifacts(callback) {
        const unsubscribe = this.db
            .collection('users')
            .doc(this.uid)
            .collection('artifacts')
            .orderBy('created_at', 'desc')
            .onSnapshot(
                (snapshot) => {
                    const artifacts = snapshot.docs.map((doc) => ({
                        id: doc.id,
                        ...doc.data(),
                    }));
                    callback(artifacts);
                },
                (err) => {
                    console.error('[FirestoreSync] Artifacts listener error:', err);
                }
            );

        this._unsubscribers.push(unsubscribe);
        return unsubscribe;
    }

    /**
     * Get a single artifact by ID.
     * @param {string} artifactId
     * @returns {Promise<Object|null>}
     */
    async getArtifact(artifactId) {
        const doc = await this.db
            .collection('users')
            .doc(this.uid)
            .collection('artifacts')
            .doc(artifactId)
            .get();

        return doc.exists ? { id: doc.id, ...doc.data() } : null;
    }

    /**
     * List user's artifacts.
     * @param {string} [typeFilter] - Optional type filter (e.g., "deep_research")
     * @returns {Promise<Array<Object>>}
     */
    async listArtifacts(typeFilter) {
        let query = this.db
            .collection('users')
            .doc(this.uid)
            .collection('artifacts')
            .orderBy('created_at', 'desc');

        if (typeFilter) {
            query = query.where('type', '==', typeFilter);
        }

        const snapshot = await query.get();
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }

    // =========================================================================
    // Cleanup
    // =========================================================================

    /**
     * Unsubscribe from all real-time listeners and cancel pending debounced writes.
     */
    destroy() {
        for (const unsub of this._unsubscribers) {
            unsub();
        }
        this._unsubscribers = [];

        for (const timer of this._debounceTimers.values()) {
            clearTimeout(timer);
        }
        this._debounceTimers.clear();

        console.log('[FirestoreSync] Destroyed');
    }
}

export { FirestoreSync };
