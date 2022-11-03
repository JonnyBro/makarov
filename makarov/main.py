import discord
from discord.ext import tasks
import modules.markov as markov
from random import randrange, choice, random
import traceback
import json
import logging
import asyncio
from time import sleep, time
import os.path
from functools import wraps, partial

logging.basicConfig(level=logging.ERROR, filename=f"logs/makarov_{round(time())}.log", filemode="w")
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

def log_error(msg):
    logging.error(msg + ":\n\t" + traceback.format_exc())

def get_channel_type(channel_id):
    try:
        with open(f"internal/whitelisted_channels_channel.makarov") as f:
            channel = json.load(f)
            if channel_id in channel:
                return "channel"
        with open(f"internal/whitelisted_channels_common.makarov") as f:
            common = json.load(f)
            if channel_id in common:
                return "common"
        with open(f"internal/whitelisted_channels_private.makarov") as f:
            private = json.load(f)
            if channel_id in private:
                return "private"
    except Exception:
        #log_error("Failed to get the channel type!")
        #not very important error, we can just ignore it 
        return None

def get_whitelist(typee):
    try:
        with open(f"internal/whitelisted_channels_{typee}.makarov") as f:
            return json.load(f)
    except Exception:
        log_error("Failed to get the whitelist!")
        return []

async def add_to_whitelist(message, typee):
    if not message.author.guild_permissions.administrator:
        await message.reply("You have no rights, comrade. Ask an admin to do this command.")
        return

    channel_type = get_channel_type(message.channel.id)
    if channel_type and typee != channel_type:
        await message.reply(f"Can't have one channel being two different types at the same time! Remove it from **{channel_type}**!")
        return

    try:
        with open(f"internal/whitelisted_channels_{typee}.makarov", "r") as f:
            whitelist = json.load(f)
    except Exception:
        whitelist = []

    msg = ""
    if message.channel.id in whitelist:
        whitelist.remove(message.channel.id)
        msg = F"Removed this channel from the **{typee}** whitelist. ({message.channel.id})"
    else:
        whitelist.append(message.channel.id)
        msg = F"Added this channel to the **{typee}** whitelist. ({message.channel.id})"

    try:
        with open(f"internal/whitelisted_channels_{typee}.makarov", "w+") as f:
            json.dump(whitelist, f)
    except Exception as e:
        log_error("Failed to write to the whitelist!")
        return

    await message.reply(msg)

@async_wrap
def markov_log_message(message):
    try:
        if not message.channel:
            return
        channel_type = get_channel_type(message.channel.id)
        if not channel_type:
            return
        if message.channel.id not in get_whitelist(channel_type):
            return
        if message.content.startswith(cfg["command_prefix"]):
            return
        if channel_type != "channel":
            with open(f"internal/{channel_type}_msg_logs.makarov", "a+") as f:
                f.write(message.content+"\n")
        elif channel_type == "channel":
            with open(f"internal/{message.channel.id}_msg_logs.makarov", "a+") as f:
                f.write(message.content+"\n")            
    except Exception:
        log_error("error in markov_log_message")

def markov_generate(message, dirr):
    order = 1
    word_amount = int(random()*10)
    tokens = markov.tokenise_text_file(dirr)
    markov_chain = markov.create_markov_chain(tokens, order=order)
    return markov.generate_text(markov_chain, word_amount)

@async_wrap
def markov_choose(message, automatic):
    if automatic and message.content.startswith(cfg["command_prefix"]):
        return
    if automatic and random() < 0.8:
        return
    channel_type = get_channel_type(message.channel.id)
    whitelist = get_whitelist(channel_type)
    output = ""
    if (channel_type == "private" or channel_type == "common") and message.channel.id in whitelist:
        output = markov_generate(message=message, dirr=f"internal/{channel_type}_msg_logs.makarov")
    elif channel_type == "channel" and message.channel.id in whitelist:
        output = markov_generate(message=message, dirr=f"internal/{message.channel.id}_msg_logs.makarov")
    return output

async def markov_main(message, automatic):
    markov_msg = await markov_choose(message, automatic)
    if markov_msg:
        async with message.channel.typing():
            await asyncio.sleep(1 + random()*2.5)
            if automatic:
                await message.channel.send(markov_msg)
            else:
                await message.reply(markov_msg)
            client.markov_timeout = cfg["timeout"]

@tasks.loop(seconds=1)
async def timer_decrement():
    client.markov_timeout = max(client.markov_timeout - 1, 0)

@tasks.loop(seconds=30)
async def custom_status():
    with open("configs/status_messages.txt", encoding='UTF-8') as f:
        await client.change_presence(activity=discord.Game(name=choice(f.read().rstrip().splitlines())))

@client.event
async def on_ready():
    client.markov_timeout = 0
    timer_decrement.start()
    if cfg["custom_status"]:
        custom_status.start()
    print(f'We have logged in as {client.user}')

@client.event
async def on_message(message):
    if message.author == client.user or message.author.bot or not message.channel:
        return

    try:
        await markov_log_message(message)
        await markov_main(message, automatic=True)
    except Exception:
        log_error("markov error")

    if message.content.startswith(cfg["command_prefix"]):
        match message.content.replace(cfg["command_prefix"], "", 1).split():
            case ["allow_common", *args]:
                await add_to_whitelist(message=message, typee="common")
            case ["allow_private", *args]:
                await add_to_whitelist(message=message, typee="private")
            case ["allow_channel", *args]:
                await add_to_whitelist(message=message, typee="channel")
            case ["help", *args]:
                await message.reply(f"I have several commands:\n" \
                                    f"\t- **{cfg['command_prefix']}allow_private** - Allow logging a channel that's considered private. Will generate text using using only private logs and post it only in private channels that have been whitelisted.\n" \
                                    f"\t- **{cfg['command_prefix']}allow_common** - Allow logging a public channel. Will generate text using only public logs and post it only in public channels that have been whitelisted.\n" \
                                    f"\t- **{cfg['command_prefix']}allow_channel** - Allow logging a certain channel. Will generate text using only logs from the specific whitelisted channel and post it only there.\n" \
                                    f"\t- **{cfg['command_prefix']}gen** - Trigger random text generation manually based on the channel it's executed in\n")
            case ["gen", *args]:
                await markov_main(message, automatic=False)

if __name__ == '__main__':
    with open("configs/1.json") as f:
        cfg = json.load(f)
    client.run(cfg["token"])