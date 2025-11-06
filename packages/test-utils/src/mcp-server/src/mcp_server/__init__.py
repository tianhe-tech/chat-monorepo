import asyncio
import os
from dataclasses import dataclass
from typing import Literal

from fastmcp import Context, FastMCP
from mcp.types import TextContent

SERVER_NAME = 'FixtureStreamableMCP'

mcp = FastMCP(SERVER_NAME)


@dataclass
class PreferenceSurvey:
    """Structured response returned from elicitation tests."""

    preferred_option: Literal['option_a', 'option_b']
    rationale: str


@mcp.tool
async def echo(text: str) -> str:
    """Plain echo tool for basic invocation tests."""

    return text


@mcp.tool(meta={'isEntry': True})
async def sampling(
    prompt: str,
    ctx: Context,
    temperature: float = 0.7,
    max_tokens: int = 256,
) -> dict[str, str]:
    """Request a text sample from the client's LLM for testing."""
    response = await ctx.sample(
        messages=prompt,
        system_prompt='We are testing MCP sampling',
        temperature=temperature,
        max_tokens=max_tokens,
    )
    assert isinstance(response, TextContent)
    return {'completion': response.text}


@mcp.tool
async def elicitation(
    topic: str,
    ctx: Context,
) -> dict[str, str]:
    """Run an elicitation flow to collect a minimal preference payload."""

    intro = f'Help select between two lightweight options for testing purposes. Topic: {topic}.'
    result = await ctx.elicit(intro, response_type=PreferenceSurvey)

    if result.action != 'accept':
        return {'status': result.action}

    preference = result.data
    return {
        'status': 'accept',
        'choice': preference.preferred_option,
        'rationale': preference.rationale,
    }


def create_app(path: str | None = None):
    """Expose a Starlette app for streamable HTTP fixtures."""

    return mcp.streamable_http_app(path=path)


async def _serve_async() -> None:
    port = _port_from_env()
    host = os.getenv('MCP_SERVER_HOST', '127.0.0.1')
    path = os.getenv('MCP_SERVER_PATH')

    await mcp.run_streamable_http_async(host=host, port=port, path=path)


def _port_from_env() -> int:
    raw_port = os.getenv('MCP_SERVER_PORT') or os.getenv('PORT') or '8765'

    try:
        return int(raw_port)
    except ValueError as error:
        raise ValueError(f'Invalid port value: {raw_port}') from error


def main() -> None:
    """Entry point used by fixtures and manual testing."""

    asyncio.run(_serve_async())
