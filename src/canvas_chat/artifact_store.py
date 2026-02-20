"""
Artifact Store — server-side CRUD for user artifacts in Firestore.

Artifacts are cross-session, server-generated content like:
- Deep research reports
- Generated images
- Analysis results

Any backend plugin can save artifacts for authenticated users.
"""

import logging
import time
from uuid import uuid4

logger = logging.getLogger(__name__)


class ArtifactStore:
    """Write/read artifacts to/from a user's Firestore collection."""

    def __init__(self, firestore_client):
        self.db = firestore_client

    def _artifacts_ref(self, uid: str):
        return self.db.collection("users").document(uid).collection("artifacts")

    def save_artifact(
        self,
        uid: str,
        *,
        artifact_type: str,
        title: str,
        content: str,
        source_session_id: str | None = None,
        source_node_id: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """
        Save an artifact to a user's Firestore artifacts collection.

        Args:
            uid: Firebase Auth user ID.
            artifact_type: Type string (e.g., "deep_research", "report", "image").
            title: Human-readable title.
            content: The artifact body (markdown, HTML, etc.).
            source_session_id: Optional session ID that produced this artifact.
            source_node_id: Optional node ID that produced this artifact.
            metadata: Optional type-specific metadata dict.

        Returns:
            The generated artifact ID.
        """
        artifact_id = str(uuid4())
        now = time.time() * 1000  # JS-compatible timestamp (ms)

        doc = {
            "type": artifact_type,
            "title": title,
            "content": content,
            "source_session_id": source_session_id,
            "source_node_id": source_node_id,
            "metadata": metadata or {},
            "created_at": now,
            "updated_at": now,
        }

        self._artifacts_ref(uid).document(artifact_id).set(doc)

        logger.info(
            f"Artifact saved: uid={uid}, id={artifact_id}, type={artifact_type}"
        )
        return artifact_id

    def list_artifacts(self, uid: str, type_filter: str | None = None) -> list[dict]:
        """
        List a user's artifacts, optionally filtered by type.

        Args:
            uid: Firebase Auth user ID.
            type_filter: Optional type filter.

        Returns:
            List of artifact dicts with 'id' field.
        """
        query = self._artifacts_ref(uid).order_by("created_at", direction="DESCENDING")

        if type_filter:
            query = query.where("type", "==", type_filter)

        docs = query.stream()
        return [{"id": doc.id, **doc.to_dict()} for doc in docs]

    def get_artifact(self, uid: str, artifact_id: str) -> dict | None:
        """
        Get a single artifact by ID.

        Args:
            uid: Firebase Auth user ID.
            artifact_id: Artifact document ID.

        Returns:
            Artifact dict with 'id' field, or None if not found.
        """
        doc = self._artifacts_ref(uid).document(artifact_id).get()
        if not doc.exists:
            return None
        return {"id": doc.id, **doc.to_dict()}
