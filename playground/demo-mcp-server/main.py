from fastmcp import FastMCP, Context
from dataclasses import dataclass
from typing import Annotated

mcp = FastMCP('My MCP Server')


@dataclass
class DemoResult:
    value: str
    label: str


@mcp.tool
async def i_need_user_confirm(echo: Annotated[str, 'Message to echo'], ctx: Context) -> str:
    """This is a tool for confirmation."""
    print('tool input', echo)
    result = await ctx.elicit('Please confirm your action.', DemoResult)
    if result.action == 'accept':
        return f'you accepted: {result.data}'
    elif result.action == 'decline':
        return 'you declined.'
    else:
        return 'cancelled'


def main():
    mcp.run(transport='http')


if __name__ == '__main__':
    main()
