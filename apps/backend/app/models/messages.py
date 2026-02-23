from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: str | None = None


class ChatRequest(BaseModel):
    message: str
    project_id: str = "default"


class ChatResponse(BaseModel):
    message: str
    tool_calls: list[dict] | None = None
