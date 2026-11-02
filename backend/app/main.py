"""FastAPI application: app creation, router registration, CORS, logging and lifecycle hooks.

Registration order matches the original monolithic server.py: the routes that were
declared directly on ``app`` come first, then everything under ``/api``.
"""

import logging

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from app import db
from app.core.config import allowed_origins
from app.routers.api import api_router
from app.routers.top_level import app_router
from app.services.bootstrap import startup


# Create the main app
app = FastAPI()

# Routes that server.py declared directly on `app` were registered before api_router
# was included, so include them first to keep the exact route matching order.
app.include_router(app_router)
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

app.on_event("startup")(startup)


@app.on_event("shutdown")
async def shutdown():
    if db.pool:
        db.pool.close()
        await db.pool.wait_closed()
