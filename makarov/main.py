import discord
from discord.ext import tasks
from makarovimg import gen_impact, gen_lobster, gen_egh, gen_crazy_doxxer
from util import create_dir, send_wrapped_text, shell_exec, log_error, async_wrap, get_random_line
from random import randrange, choice, random
import traceback
import json
import logging
import asyncio
from time import sleep
import os
import markovify
import requests
from urllib.parse import urlparse
import re
from urllib.request import urlopen, Request

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

def get_timeout(guild_id):
    return client.markov_timeout.get(guild_id, 0)

def get_timeout_user(author_id):
    return client.user_markov_timeout.get(author_id, 0)

def is_admin(author):
    try:
        if author.guild_permissions.administrator:
            return True
    except Exception:
        log_error("error in GuildUtil.is_admin")
    return False

def is_channel_type(channel_id, guild_id, typee):
    try:
        with open(f"internal/{guild_id}/whitelisted_channels_{typee}.makarov") as f:
            channel = json.load(f)
            if channel_id in channel:
                return True
    except FileNotFoundError:
        pass
    return False

def get_channel_type(channel_id, guild_id):
    # brother this stinks!!.. too bad lol
    if is_channel_type(channel_id, guild_id, "channel"):
        return "channel"
    if is_channel_type(channel_id, guild_id, "common"):
        return "common"
    if is_channel_type(channel_id, guild_id, "private"):
        return "private"

def whitelist_get(typee, guild_id):
    try:
        with open(f"internal/{guild_id}/whitelisted_channels_{typee}.makarov") as f:
            return json.load(f)
    except Exception:
        log_error("Failed to get the whitelist!")
        return []

async def whitelist_toggle(message, typee):
    ''' Adds a discord channel to whitelist if the executor has admin rights and it isn't already whitelisted under a different category '''
    if not is_admin(message.author):
        await message.reply("You have no rights, comrade. Ask an admin to do this command.")
        return

    channel_type = get_channel_type(message.channel.id, message.guild.id)
    if channel_type and typee != channel_type:
        await message.reply(f"Can't have one channel being two different types at the same time! Remove it from **{channel_type}**!")
        return

    whitelist = whitelist_get(typee, message.guild.id)

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

async def log_message(message, rapid=False):
    ''' Logs discord messages to be used later '''
    try:
        if not message.channel or message.author == client.user or message.author.bot:
            return
        channel_type = get_channel_type(message.channel.id, message.guild.id)

        if not channel_type:
            return
        if message.channel.id not in whitelist_get(channel_type, message.guild.id):
            return

        output = ""
        
        if message.clean_content:
            if ". " in message.clean_content:
                for sentence in message.clean_content.split(". "):
                    output += sentence + "\n"
            else:
                output += message.clean_content + "\n"
        for attachment in message.attachments:
            output += attachment.url + "\n"

        dirr = ""
        if channel_type != "channel":
            dirr = f"internal/{message.guild.id}/{channel_type}_msg_logs.makarov"
        elif channel_type == "channel":
            dirr = f"internal/{message.guild.id}/{message.channel.id}_msg_logs.makarov"

        with open(dirr, "a+") as f:
            f.write(output)
    except Exception:
        log_error("error in Makarov.log_message")

async def log_message_rapid(message, rapid=False):
    ''' Logs discord messages to be used later '''
    try:
        if not message.channel or message.author == client.user or message.author.bot:
            return
        channel_type = get_channel_type(message.channel.id, message.guild.id)

        if not channel_type:
            return
        if message.channel.id not in whitelist_get(channel_type, message.guild.id):
            return

        output = ""
        
        async for message_log in message.channel.history(limit=None):
            if message_log.clean_content:
                if ". " in message_log.clean_content:
                    for sentence in message_log.clean_content.split(". "):
                        output += sentence + "\n"
                else:
                    output += message_log.clean_content + "\n"
            for attachment in message_log.attachments:
                output += attachment.url + "\n"

        dirr = ""
        if channel_type != "channel":
            dirr = f"internal/{message.guild.id}/{channel_type}_msg_logs.makarov"
        elif channel_type == "channel":
            dirr = f"internal/{message.guild.id}/{message.channel.id}_msg_logs.makarov"

        with open(dirr, "a+") as f:
            f.write(output)
    except Exception:
        log_error("error in Makarov.log_message")

def make_sentence(text_model, typee, prepend=None, strict=True, test_output=True):
    max_overlap_ratio = 0.65
    output = None
    if typee == "prepend":
        try:
            output = text_model.make_sentence_with_start(prepend, max_overlap_ratio=max_overlap_ratio, strict=strict)
        except Exception as e:
            log_error(str(e))
    elif typee == "normal":
        try:
            output = text_model.make_sentence(max_overlap_ratio=max_overlap_ratio, test_output=test_output)
        except Exception as e:
            log_error(str(e))
        if not output:
            output = text_model.make_sentence(max_overlap_ratio=max_overlap_ratio, test_output=False)
    return output

def make_prepended_sentence(text_model, init_state):
    # this is pretty ghetto but okay i guess lol
    strict = True
    forgotten_prepend = ""
    output = None

    output = make_sentence(text_model, "prepend", prepend=init_state, strict=strict)

    # If we couldn't generate a sentence with the full prepend text, get the last word of it and try again
    if not output:
        forgotten_prepend = " ".join(init_state.split(" ")[:-1])
        init_state = init_state.split(" ")[-1] # get the last word
    else:
        return output
    output = make_sentence(text_model, "prepend", prepend=init_state, strict=strict)

    # We still couldn't do it so allow it to be more relaxed in regards of inspiration from the prepend
    if not output:
        strict = False
    else:
        return forgotten_prepend + " " + output
    output = make_sentence(text_model, "prepend", prepend=forgotten_prepend+" "+init_state, strict=strict)

    # Nothing above worked so just prepend the text manually the dumb way.
    if not output:
        output = forgotten_prepend + " " + init_state + " " + make_sentence(text_model, "normal")
    else:
        return output

    return output

def generate_markov_text_internal(dirr, init_state=None):
    ''' Used for text generation based on any file you input. Each separate message separated by a newline'''
    text_model = None
    with open(dirr, errors="ignore", encoding="utf-8") as f:
        text = f.read()
        text_model = markovify.NewlineText(text, state_size=cfg["randomness"])
    output = None
    if init_state:
        output = make_prepended_sentence(text_model, init_state)
    else:
        output = make_sentence(text_model, "normal")

    return output

@async_wrap
def generate_markov_text(message, automatic=None, prepend=None):
    ''' Used for server based text generation'''
    channel_type = get_channel_type(message.channel.id, message.guild.id)
    if not channel_type:
        return

    whitelist = whitelist_get(channel_type, message.guild.id)
    output = ""
    if (channel_type == "private" or channel_type == "common") and message.channel.id in whitelist:
        output = generate_markov_text_internal(dirr=f"internal/{message.guild.id}/{channel_type}_msg_logs.makarov", init_state=prepend)
    elif channel_type == "channel" and message.channel.id in whitelist:
        output = generate_markov_text_internal(dirr=f"internal/{message.guild.id}/{message.channel.id}_msg_logs.makarov", init_state=prepend)
    return output

async def logs_find(message, query):
    ''' Used for server based text generation'''
    channel_type = get_channel_type(message.channel.id, message.guild.id)
    if not channel_type:
        return
    whitelist = whitelist_get(channel_type, message.guild.id)

    directory = ""
    if (channel_type == "private" or channel_type == "common") and message.channel.id in whitelist:
        directory = f"internal/{message.guild.id}/{channel_type}_msg_logs.makarov"
    elif channel_type == "channel" and message.channel.id in whitelist:
        directory = f"internal/{message.guild.id}/{message.channel.id}_msg_logs.makarov"

    output = []
    with open(directory, encoding="utf-8", errors="ignore") as f:
        for line in f.readlines():
            if re.search(query, line) and (".png" in line or ".jpg" in line):
                output.append(line)

    return output

async def random_url(message):
    urls = await logs_find(message, r"\/\/cdn\.discordapp\.com\/.{1,}\/.{1,}\/.{1,}\/.{1,}\..{1,6}")
    if not urls:
        return None
    for i in range(50):
        url = choice(urls).strip()
        try:
            req = Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/107.0.0.0 Safari/537.36'})
            response = urlopen(req)
            if response.code == 200:
                return url
        except Exception:
            pass

async def automatic_markov_generation(message, automatic, prepend=None):
    ''' Used for server based text generation'''
    if automatic and get_timeout(message.guild.id) > 0:
        return

    if automatic and random() < 1-cfg["chance"]/100:
        return

    if automatic:
        client.markov_timeout[message.guild.id] = cfg["timeout"]

    output = ""

    if not prepend and random() < 0.2:
        output = await random_url(message)
    else:
        output = await generate_markov_text(message, automatic, prepend)

    if not output:
        return

    async with message.channel.typing():
        await asyncio.sleep(1 + random()*1.25)
        if automatic:
            await message.channel.send(output, allowed_mentions=discord.AllowedMentions.none())
        else:
            await message.reply(output, allowed_mentions=discord.AllowedMentions.none())

async def generate_markov_image(typee, message):
    async with message.channel.typing():
        path = None
        match typee:
            case "impact":
                url = await random_url(message)
                gravity = []
                texts = []
                texts.append(await generate_markov_text(message, False))
                gravity.append("north")
                if random() > 0.5:
                    texts.append(await generate_markov_text(message, False))
                    gravity.append("south")
                for text in texts:
                    if not text:
                        return
                path = await gen_impact(typee="link", inputt=url, texts=texts, gravity=gravity)
            case "lobster":
                url = await random_url(message)
                text = await generate_markov_text(message, False)
                if not text:
                    return
                path = await gen_lobster(typee="link", inputt=url, text=text)
            case "egh":
                path = await gen_egh()
            case "7pul":
                path = await gen_crazy_doxxer()

        await message.reply(file=discord.File(path))
        os.remove(path)

@tasks.loop(seconds=1)
async def timer_decrement():
    for key, item in client.markov_timeout.items():
        client.markov_timeout[key] = max(client.markov_timeout[key] - 1, 0)
    for key, item in client.user_markov_timeout.items():
        client.user_markov_timeout[key] = max(client.user_markov_timeout[key] - 1, 0)

@tasks.loop(seconds=30)
async def custom_status():
    with open("configs/status_messages.txt", encoding='UTF-8') as f:
        chosen_text = choice(f.read().rstrip().splitlines())
        chosen_text = chosen_text.replace(".id.", client.user.name)
        await client.change_presence(activity=discord.Game(name=chosen_text))

@client.event
async def on_ready():
    client.markov_timeout = {}
    client.user_markov_timeout = {}
    client.user_penalty_counter = {}
    client.cached_models = {}

    logging.info(f'Starting timer decrement task...')
    timer_decrement.start()
    if cfg["custom_status"]:
        logging.info(f'Starting custom status task...')
        custom_status.start()

    logging.info(f'We have logged in as {client.user}')

@client.event
async def on_message(message):
    if message.author == client.user or message.author.bot or not message.channel:
        return

    global cfg

    try:
        await log_message(message)
    except Exception:
        log_error("markov error")

    if get_timeout_user(message.author.id) > 0:
        client.user_penalty_counter[message.author.id] = client.user_penalty_counter.get(message.author.id, 0) + 1
        if client.user_penalty_counter[message.author.id] == 5:
            client.user_markov_timeout[message.author.id] = 86400
            await message.reply("You have been penalized for spamming the bot. Behave yourself next time. (Timeout duration: 1 day)")
        return

    if client.user.mentioned_in(message):
        client.user_markov_timeout[message.author.id] = 10
        client.user_penalty_counter[message.author.id] = 0
        match message.content.split()[1:]:
            case ["log_history", *args]:
                if not is_admin(message.author):
                    await message.reply("You have no rights, comrade. Ask an admin to do this command.")
                    return
                async with message.channel.typing():
                    await message.reply("Logging the message history... (Depending on how much messages there are this might take a really long while.)")
                    try:
                        await log_message_rapid(message)
                    except Exception as e:
                        await message.reply(f"Exception occured during the logging process: ```{e}```")
                    await message.reply("Logged what we could. Enjoy, lol")
            case ["allow_common", *args]:
                await whitelist_toggle(message=message, typee="common")
            case ["allow_private", *args]:
                await whitelist_toggle(message=message, typee="private")
            case ["allow_channel", *args]:
                await whitelist_toggle(message=message, typee="channel")
            case ["randomness", *args]:
                if not is_admin(message.author):
                    await message.reply("You have no rights, comrade. Ask an admin to do this command.")
                    return
                cfg["randomness"] = int(args[0])
                await message.reply(f"Set the randomness value to {int(args[0])}.\nIt'll be active only for the current bot session. To change it permanently update the config!")
            case ["chance", *args]:
                if not is_admin(message.author):
                    await message.reply("You have no rights, comrade. Ask an admin to do this command.")
                    return
                #global cfg
                cfg["chance"] = int(args[0])
                await message.reply(f"Set the chance value to {int(args[0])}.\nIt'll be active only for the current bot session. To change it permanently update the config!")
            case ["help", *args]:
                await message.reply(f"```I have several commands that you can ping me with:\n" \
                                    f"\t- allow_private - Allow logging a channel that's considered private. Will generate text using using only private logs and post it only in private channels that have been whitelisted.\n" \
                                    f"\t- allow_common - Allow logging a public channel. Will generate text using only public logs and post it only in public channels that have been whitelisted.\n" \
                                    f"\t- allow_channel - Allow logging a certain channel. Will generate text using only logs from the specific whitelisted channel and post it only there.\n" \
                                    f"\t- teejay hvh linus damianluck tomscott - Generate text with text gathered from these people/topics.\n" \
                                    f"\t- impact - Generate impact meme-styled images using the text generation.\n" \
                                    f"\t- lobster - Generate oldschool vk subtitled images using the text generation.\n" \
                                    f"\t- egh 7pul - Generate images styled with these topics in mind.\n" \
                                    f"\t- gen - Generate text and prepend input\n" \
                                    f"\t- imagegen - Get a random image from chat history and post it.\n" \
                                    f"\t- dog capybara cat frog - Random image of the respective animal (unfiltered bing results that were scraped at least a year ago)\n" \
                                    f"Don't input any command to generate server-based text.```\n")
            case ["damian", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = generate_markov_text_internal(dirr="internal/damianluck.txt")
                    await message.reply(output)
            case ["hvh", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = generate_markov_text_internal(dirr="internal/hvh.txt")
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
                    output = generate_markov_text_internal(dirr="internal/tomscott.txt")
                    await message.reply(output)
            case ["ltt", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = generate_markov_text_internal(dirr="internal/linus.txt")
                    await message.reply(output)
            case ["teejay", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = generate_markov_text_internal(dirr="internal/teejayx6.txt")
                    await message.reply(output)
            case ["gugafoods", *args]:
                async with message.channel.typing():
                    await asyncio.sleep(1 + random()*1.25)
                    output = generate_markov_text_internal(dirr="internal/guga.txt")
                    await message.reply(output)
            case ["impact", *args]:
                await generate_markov_image(typee="impact", message=message)
            case ["lobster", *args]:
                await generate_markov_image(typee="lobster", message=message)
            case ["egh", *args]:
                await generate_markov_image(typee="egh", message=message)
            case ["7pul", *args]:
                await generate_markov_image(typee="7pul", message=message)
            case ["cat", *args]:
                image_link = await get_random_line("internal/cat.txt")
                await message.reply(image_link)
            case ["dog", *args]:
                image_link = await get_random_line("internal/dog.txt")
                await message.reply(image_link)
            case ["capybara", *args]:
                image_link = await get_random_line("internal/capy.txt")
                await message.reply(image_link)
            case ["frog", *args]:
                image_link = await get_random_line("internal/frog.txt")
                await message.reply(image_link)
            case ["gen", *args]:
                await automatic_markov_generation(message, automatic=False, prepend=" ".join(args))
            case ["imagegen", *args]:
                output = await random_url(message)
                if output:
                    await message.reply(output)
            case _:
                await automatic_markov_generation(message, automatic=False)
    else:
        await automatic_markov_generation(message, automatic=True)

if __name__ == '__main__':
    with open("configs/1.json") as f:
        cfg = json.load(f)
    client.run(cfg["token"])