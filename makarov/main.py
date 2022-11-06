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
import subprocess
import shlex
import os
import markovify

logging.basicConfig(level=logging.ERROR, filename=f"logs/makarov_{round(time())}.log", filemode="w")
intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

def create_dir(dirr):
    if not os.path.exists(dirr):
        os.mkdir(dirr)

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

async def send_wrapped_text(text, target, pre_text=False):
    ''' Wraps the passed text under the 2000 character limit, sends everything and gives it neat formatting.
        text is the text that you need to wrap
        target is the person/channel where you need to send the wrapped text to
    '''
    if pre_text:
        pre_text = pre_text + "\n"
    else:
        pre_text = ""

    try:
        target = target.channel
    except AttributeError:
        pass

    wrapped_text = [(text[i:i + 1992 - len(pre_text)]) for i in range(0, len(text), 1992 - len(pre_text))]
    for i in range(len(wrapped_text)):
        if i > 0:
            pre_text = ""
        await target.send(f"{pre_text}```{wrapped_text[i]}```")

@async_wrap
def shell_exec(command):
    p = subprocess.Popen(shlex.split(command), stdout=subprocess.PIPE, stderr=subprocess.PIPE).communicate()
    return p[0].decode("utf-8", errors="ignore")

async def update_bot(message):
    try:
        message = message.channel
    except AttributeError:
        pass
    reset_output_cmd = await shell_exec("git reset --hard")
    update_output_cmd = await shell_exec("git pull")
    await send_wrapped_text(reset_output_cmd + "\n" + update_output_cmd + "\n" + "The bot will now exit.", message)
    exit()

def get_timeout(guild_id):
    if client.markov_timeout.get(guild_id) != None:
        return client.markov_timeout.get(guild_id)
    else:
        return 0

def is_admin(author):
    try:
        if author.guild_permissions.administrator:
            return True
    except Exception:
        log_error("error in is_admin")
    return False

def get_channel_type(channel_id, guild_id):
    try:
        with open(f"internal/{guild_id}/whitelisted_channels_channel.makarov") as f:
            channel = json.load(f)
            if channel_id in channel:
                return "channel"
        with open(f"internal/{guild_id}/whitelisted_channels_common.makarov") as f:
            common = json.load(f)
            if channel_id in common:
                return "common"
        with open(f"internal/{guild_id}/whitelisted_channels_private.makarov") as f:
            private = json.load(f)
            if channel_id in private:
                return "private"
    except Exception:
        #log_error("Failed to get the channel type!")
        #not very important error, we can just ignore it 
        return None

def get_whitelist(typee, guild_id):
    try:
        with open(f"internal/{guild_id}/whitelisted_channels_{typee}.makarov") as f:
            return json.load(f)
    except Exception:
        log_error("Failed to get the whitelist!")
        return []

async def add_to_whitelist(message, typee):
    ''' Adds a discord channel to whitelist if the executor has admin rights and it isn't already whitelisted under a different category '''
    if not is_admin(message.author):
        await message.reply("You have no rights, comrade. Ask an admin to do this command.")
        return

    channel_type = get_channel_type(message.channel.id, message.guild.id)
    if channel_type and typee != channel_type:
        await message.reply(f"Can't have one channel being two different types at the same time! Remove it from **{channel_type}**!")
        return

    whitelist = get_whitelist(typee, message.guild.id)

    msg = ""
    if message.channel.id in whitelist:
        whitelist.remove(message.channel.id)
        msg = F"Removed this channel from the **{typee}** whitelist. ({message.channel.id})"
    else:
        whitelist.append(message.channel.id)
        msg = F"Added this channel to the **{typee}** whitelist. ({message.channel.id})"

    try:
        create_dir(f"internal/{message.guild.id}/")
        with open(f"internal/{message.guild.id}/whitelisted_channels_{typee}.makarov", "w+") as f:
            json.dump(whitelist, f)
    except Exception as e:
        log_error("Failed to write to the whitelist!")
        return

    await message.reply(msg)

@async_wrap
def markov_log_message(message):
    ''' Logs discord messages to be used later '''
    try:
        if not message.channel:
            return
        channel_type = get_channel_type(message.channel.id, message.guild.id)
        if not channel_type:
            return
        if message.channel.id not in get_whitelist(channel_type, message.guild.id):
            return

        output = ""
        
        if message.content:
            output += message.content + "\n"
        for attachment in message.attachments:
            output += attachment.url + "\n"

        if channel_type != "channel":
            with open(f"internal/{message.guild.id}/{channel_type}_msg_logs.makarov", "a+") as f:
                f.write(output)
        elif channel_type == "channel":
            with open(f"internal/{message.guild.id}/{message.channel.id}_msg_logs.makarov", "a+") as f:
                f.write(output)            
    except Exception:
        log_error("error in markov_log_message")

def markov_generate(dirr):
    ''' Used for text generation based on any file you input. Each separate message separated by a newline'''
    order = 1
    word_amount = int(random()*10)
    with open(dirr, errors="ignore", encoding="utf-8") as f:
        text = f.read()
        text_model = markovify.NewlineText(text, state_size=cfg["randomness"])
        output = text_model.make_short_sentence(word_amount, tries=100)
        if not output:
            return text_model.make_sentence(test_output=False) # fallback if we dont have enough text
        return output

@async_wrap
def markov_choose(message, automatic, prepend=""):
    ''' Used for server based text generation'''
    if automatic and message.content.startswith(cfg["command_prefix"]):
        return
    if automatic and random() < 1-cfg["chance"]/100:
        return
    channel_type = get_channel_type(message.channel.id, message.guild.id)
    if not channel_type:
        return
    whitelist = get_whitelist(channel_type, message.guild.id)

    if (channel_type == "private" or channel_type == "common") and message.channel.id in whitelist:
        prepend += markov_generate(dirr=f"internal/{message.guild.id}/{channel_type}_msg_logs.makarov")
    elif channel_type == "channel" and message.channel.id in whitelist:
        prepend += markov_generate(dirr=f"internal/{message.guild.id}/{message.channel.id}_msg_logs.makarov")
    return prepend

async def markov_main(message, automatic, prepend=""):
    ''' Used for server based text generation'''
    if automatic and get_timeout(message.guild.id) > 0:
        return

    markov_msg = await markov_choose(message, automatic, prepend)
    if not markov_msg:
        return

    async with message.channel.typing():
        await asyncio.sleep(1 + random()*1.25)
        if automatic:
            await message.channel.send(markov_msg)
        else:
            await message.reply(markov_msg)
        client.markov_timeout[message.guild.id] = cfg["timeout"]

@tasks.loop(seconds=1)
async def timer_decrement():
    for guild in client.markov_timeout:
        guild = max(guild - 1, 0)

@tasks.loop(seconds=30)
async def custom_status():
    with open("configs/status_messages.txt", encoding='UTF-8') as f:
        chosen_text = choice(f.read().rstrip().splitlines())
        chosen_text = chosen_text.replace(".id.", client.user.name)
        await client.change_presence(activity=discord.Game(name=chosen_text))

@client.event
async def on_ready():
    client.markov_timeout = {}
    timer_decrement.start()
    if cfg["custom_status"]:
        custom_status.start()
    logging.info(f'We have logged in as {client.user}')

@client.event
async def on_message(message):
    if message.author == client.user or message.author.bot or not message.channel:
        return

    try:
        await markov_log_message(message)
        await markov_main(message, automatic=True)
    except Exception:
        log_error("markov error")

    if client.user.mentioned_in(message):
        match message.content.split()[1:]:
            case ["allow_common", *args]:
                await add_to_whitelist(message=message, typee="common")
            case ["allow_private", *args]:
                await add_to_whitelist(message=message, typee="private")
            case ["allow_channel", *args]:
                await add_to_whitelist(message=message, typee="channel")
            case ["randomness", *args]:
                if not is_admin(message.author):
                    await message.reply("You have no rights, comrade. Ask an admin to do this command.")
                    return
                global cfg
                cfg["randomness"] = int(args[0])
                await message.reply(f"Set the randomness value to {int(args[0])}.\nIt'll be active only for the current bot session. To change it permanently update the config!")                
            case ["update", *args]:
                if not is_admin(message.author):
                    await message.reply("You have no rights, comrade. Ask an admin to do this command.")
                    return
                await update_bot(message)
            case ["help", *args]:
                await message.reply(f"```I have several commands that you can ping me with:\n" \
                                    f"\t- allow_private - Allow logging a channel that's considered private. Will generate text using using only private logs and post it only in private channels that have been whitelisted.\n" \
                                    f"\t- allow_common - Allow logging a public channel. Will generate text using only public logs and post it only in public channels that have been whitelisted.\n" \
                                    f"\t- allow_channel - Allow logging a certain channel. Will generate text using only logs from the specific whitelisted channel and post it only there.\n" \
                                    f"\t- teejay hvh linus damianluck tomscott - Generate text with text gathered from these people/topics.\n" \
                                    f"Don't input any command to generate server-based text.```\n")
            case ["damian", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = markov_generate(dirr="internal/damianluck.txt")
                    await message.reply(output)
            case ["hvh", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = markov_generate(dirr="internal/hvh.txt")
                    output = output.split()
                    random_shit = ["(◣_◢)", "♕", "🙂", "(◣︵◢)"]
                    actual_output = []
                    for word in output:
                        actual_output.append(word)
                        if random() > 0.8:
                            actual_output.append(choice(random_shit))
                    await message.reply(" ".join(actual_output))
            case ["tomscott", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = markov_generate(dirr="internal/tomscott.txt")
                    await message.reply(output)
            case ["ltt", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = markov_generate(dirr="internal/linus.txt")
                    await message.reply(output)
            case ["teejay", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = markov_generate(dirr="internal/teejayx6.txt")
                    await message.reply(output)
            case _:
                await markov_main(message, automatic=False)
                
if __name__ == '__main__':
    with open("configs/1.json") as f:
        cfg = json.load(f)
    client.run(cfg["token"])