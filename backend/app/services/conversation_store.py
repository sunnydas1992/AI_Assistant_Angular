"""
Conversation Store - Persist chat conversations to JSON files.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, List, Optional

class ConversationStore:
    """Save/load conversation history as JSON."""

    METADATA_FILE = "_metadata.json"

    def __init__(self, storage_dir: str = "data/conversations"):
        self.storage_dir = Path(storage_dir)
        self._ensure_storage_dir()
        self._metadata = self._load_metadata()

    def _ensure_storage_dir(self) -> None:
        self.storage_dir.mkdir(parents=True, exist_ok=True)

    def _load_metadata(self) -> Dict[str, Any]:
        metadata_path = self.storage_dir / self.METADATA_FILE
        if metadata_path.exists():
            try:
                with open(metadata_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                return {"conversations": {}}
        return {"conversations": {}}

    def _save_metadata(self) -> None:
        metadata_path = self.storage_dir / self.METADATA_FILE
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(self._metadata, f, indent=2)

    def save(
        self,
        conversation_data: Dict[str, Any],
        title: Optional[str] = None,
        conversation_id: Optional[str] = None
    ) -> str:
        conv_id = conversation_id or conversation_data.get(
            "conversation_id",
            datetime.now().strftime("%Y%m%d_%H%M%S")
        )
        file_path = self.storage_dir / f"{conv_id}.json"
        conversation_data["saved_at"] = datetime.now().isoformat()
        conversation_data["title"] = title or self._generate_title(conversation_data)
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(conversation_data, f, indent=2)
        self._metadata["conversations"][conv_id] = {
            "id": conv_id,
            "title": conversation_data["title"],
            "saved_at": conversation_data["saved_at"],
            "tickets": list(conversation_data.get("tickets", {}).keys()),
            "message_count": len(conversation_data.get("messages", [])),
            "file": f"{conv_id}.json"
        }
        self._save_metadata()
        return conv_id

    def _generate_title(self, conversation_data: Dict[str, Any]) -> str:
        tickets = conversation_data.get("tickets", {})
        if tickets:
            return f"Analysis: {', '.join(list(tickets.keys())[:3])}"
        return f"Conversation {conversation_data.get('conversation_id', 'Unknown')}"

    def load(self, conversation_id: str) -> Optional[Dict[str, Any]]:
        file_path = self.storage_dir / f"{conversation_id}.json"
        if not file_path.exists():
            return None
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return None

    def delete(self, conversation_id: str) -> bool:
        file_path = self.storage_dir / f"{conversation_id}.json"
        if file_path.exists():
            file_path.unlink()
            if conversation_id in self._metadata["conversations"]:
                del self._metadata["conversations"][conversation_id]
                self._save_metadata()
            return True
        return False

    def list_conversations(
        self,
        limit: int = 50,
        sort_by: str = "saved_at",
        reverse: bool = True
    ) -> List[Dict[str, Any]]:
        conversations = list(self._metadata["conversations"].values())
        if sort_by in ["saved_at", "title", "message_count"]:
            conversations.sort(key=lambda x: x.get(sort_by, ""), reverse=reverse)
        return conversations[:limit]

    def get_conversation_count(self) -> int:
        return len(self._metadata["conversations"])

    def exists(self, conversation_id: str) -> bool:
        return conversation_id in self._metadata["conversations"]
