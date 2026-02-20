"""
Firebase Admin SDK initialization and token verification.

The Admin SDK uses a service account to:
- Verify ID tokens from frontend (Firebase Auth)
- Write to Firestore on behalf of authenticated users (artifacts)

Setup:
  1. Download service account key JSON from Firebase Console
  2. Set GOOGLE_APPLICATION_CREDENTIALS env var to the key file path
     OR place it as firebase-service-account.json in project root
  3. The SDK will auto-detect credentials
"""

import logging
import os
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)

_firebase_app = None
_initialized = False


def _try_init():
    """Attempt to initialize Firebase Admin SDK. Returns True on success."""
    global _firebase_app, _initialized

    if _initialized:
        return _firebase_app is not None

    _initialized = True

    try:
        import firebase_admin
        from firebase_admin import credentials
    except ImportError:
        logger.info(
            "firebase-admin not installed — Firebase features disabled. "
            "Install with: pip install firebase-admin"
        )
        return False

    # Check for credentials
    cred = None

    # Option 1: GOOGLE_APPLICATION_CREDENTIALS env var (standard)
    if os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"):
        cred_path = Path(os.environ["GOOGLE_APPLICATION_CREDENTIALS"])
        if cred_path.exists():
            cred = credentials.Certificate(str(cred_path))
        else:
            logger.warning(
                f"GOOGLE_APPLICATION_CREDENTIALS points to non-existent file: {cred_path}"
            )

    # Option 2: firebase-service-account.json in project root
    if cred is None:
        fallback = Path("firebase-service-account.json")
        if fallback.exists():
            cred = credentials.Certificate(str(fallback))

    # Option 3: Application Default Credentials (GCP environments)
    if cred is None:
        try:
            cred = credentials.ApplicationDefault()
        except Exception:
            pass

    if cred is None:
        logger.info(
            "No Firebase credentials found — Firebase features disabled. "
            "Set GOOGLE_APPLICATION_CREDENTIALS or place firebase-service-account.json in project root."
        )
        return False

    try:
        _firebase_app = firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin SDK initialized successfully")
        return True
    except ValueError:
        # Already initialized (e.g., in tests)
        _firebase_app = firebase_admin.get_app()
        return True
    except Exception as e:
        logger.error(f"Firebase Admin SDK initialization failed: {e}")
        return False


def is_firebase_available() -> bool:
    """Check if Firebase Admin SDK is initialized and available."""
    return _try_init()


def verify_id_token(id_token: str) -> dict | None:
    """
    Verify a Firebase ID token and return the decoded claims.

    Args:
        id_token: The ID token string from the frontend.

    Returns:
        Decoded token dict with 'uid', 'email', etc., or None if invalid.
    """
    if not _try_init():
        return None

    try:
        from firebase_admin import auth

        decoded = auth.verify_id_token(id_token)
        return decoded
    except Exception as e:
        logger.warning(f"Token verification failed: {e}")
        return None


@lru_cache(maxsize=1)
def get_firestore_client():
    """
    Get a Firestore client instance (cached).

    Returns:
        firestore.Client or None if Firebase is not available.
    """
    if not _try_init():
        return None

    try:
        from firebase_admin import firestore

        return firestore.client()
    except Exception as e:
        logger.error(f"Failed to get Firestore client: {e}")
        return None
