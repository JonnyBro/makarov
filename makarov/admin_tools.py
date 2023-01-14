import discord
import json
import asyncio
from functools import wraps, partial

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

def async_wrap(func):
    ''' Wrapper for sync functions to make them async '''
    @wraps(func)
    async def run(*args, loop=None, executor=None, **kwargs):
        if loop is None:
            loop = asyncio.get_event_loop()
        pfunc = partial(func, *args, **kwargs)
        return await loop.run_in_executor(executor, pfunc)
    return run

def async_to_sync(to_await):
    async_response = []

    async def run_and_capture_result():
        r = await to_await
        async_response.append(r)

    loop = client.loop #asyncio.get_event_loop()
    coroutine = run_and_capture_result()
    loop.run_until_complete(coroutine)
    return async_response[0]

async def main_gui():
    print("-----------------------")
    print("- list - List guilds")
    print("- leave (id) - Leave a guild")
    print("- say (id) - Pick a guild, channel and then say something in it")
    print("-----------------------")
    option = input(f"What do you need to do?: ").lower()
    if option.startswith("list"): 
        for guild in client.guilds:
            print(guild.name, " - ", guild.id)
    if option.startswith("leave"):
        cmd, idd = option.split()
        guild = client.get_guild(int(idd))
        await guild.leave()

async def main_gui_loop():
    print(f"Logged in as {client.user}")
    while True:
        await main_gui()

@client.event
async def on_ready():
    await main_gui_loop()

if __name__ == '__main__':
    with open("configs/1.json") as f:
        cfg = json.load(f)
    client.run(cfg["token"])