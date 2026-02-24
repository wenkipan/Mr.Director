from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api import chat, media, projects, ws, export

app = FastAPI(title="MrDV2 Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/api")
app.include_router(media.router, prefix="/api/media")
app.include_router(projects.router, prefix="/api/projects")
app.include_router(export.router, prefix="/api/export")
app.include_router(ws.router)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
