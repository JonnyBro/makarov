import discord
from discord.ext import tasks
from makarovimg import gen_impact, gen_lobster, gen_egh, gen_crazy_doxxer
from util import create_dir, send_wrapped_text, shell_exec, log_error, async_wrap
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

intents = discord.Intents.default()
intents.message_content = True
client = discord.Client(intents=intents)

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
        log_error("error in GuildUtil.is_admin")
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
        #Util.log_error("Failed to get the channel type!")
        #not very important error, we can just ignore it 
        return None

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

@async_wrap
def log_message(message):
    ''' Logs discord messages to be used later '''
    try:
        if client.user.mentioned_in(message):
            return
        if not message.channel:
            return
        channel_type = get_channel_type(message.channel.id, message.guild.id)
        if not channel_type:
            return
        if message.channel.id not in whitelist_get(channel_type, message.guild.id):
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
        Util.log_error("error in Makarov.log_message")

def generate_markov_text_internal(dirr):
    ''' Used for text generation based on any file you input. Each separate message separated by a newline'''
    order = 1
    word_amount = int(random()*10)
    with open(dirr, errors="ignore", encoding="utf-8") as f:
        text = f.read()
        text_model = markovify.NewlineText(text, state_size=cfg["randomness"])
        output = text_model.make_sentence()
        if not output:
            return text_model.make_sentence(test_output=False) # fallback if we dont have enough text
        return output

@async_wrap
def generate_markov_text(message, automatic, prepend=""):
    ''' Used for server based text generation'''
    if automatic and random() < cfg["chance"]/100:
        return

    channel_type = get_channel_type(message.channel.id, message.guild.id)
    if not channel_type:
        return

    whitelist = whitelist_get(channel_type, message.guild.id)

    if (channel_type == "private" or channel_type == "common") and message.channel.id in whitelist:
        prepend += " " + generate_markov_text_internal(dirr=f"internal/{message.guild.id}/{channel_type}_msg_logs.makarov")
    elif channel_type == "channel" and message.channel.id in whitelist:
        prepend += " " + generate_markov_text_internal(dirr=f"internal/{message.guild.id}/{message.channel.id}_msg_logs.makarov")
    return prepend

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

async def automatic_markov_generation(message, automatic, prepend=""):
    ''' Used for server based text generation'''
    if automatic and get_timeout(message.guild.id) > 0:
        return

    markov_msg = await generate_markov_text(message, automatic, prepend)
    if not markov_msg:
        return

    async with message.channel.typing():
        await asyncio.sleep(1 + random()*1.25)
        if automatic:
            await message.channel.send(markov_msg)
        else:
            await message.reply(markov_msg)
        client.markov_timeout[message.guild.id] = cfg["timeout"]

async def generate_markov_image(typee, message):
    async with message.channel.typing():
        path = None
        match typee:
            case "impact":
                urls = await logs_find(message, r"\/\/cdn\.discordapp\.com\/.{1,}\/.{1,}\/.{1,}\/.{1,}\..{1,6}")
                url = choice(urls).strip()
                text1 = await generate_markov_text(message, False)
                text2 = await generate_markov_text(message, False)
                if not text1 or not text2:
                    return
                gravity = []
                texts = []
                texts.append(text1)
                gravity.append("north")
                if random() > 0.5:
                    texts.append(text2)
                    gravity.append("south")
                path = await gen_impact(typee="link", inputt=url, texts=texts, gravity=gravity)
            case "lobster":
                urls = await logs_find(message, r"\/\/cdn\.discordapp\.com\/.{1,}\/.{1,}\/.{1,}\/.{1,}\..{1,6}")
                url = choice(urls).strip()
                text1 = await generate_markov_text(message, False)
                if not text1:
                    return
                path = await gen_lobster(typee="link", inputt=url, text=text1)
            case "egh":
                path = await gen_egh()
            case "7pul":
                path = await gen_crazy_doxxer()

        await message.reply(file=discord.File(path))
        os.remove(path)

@tasks.loop(seconds=1)
async def timer_decrement():
    for key, item in client.markov_timeout.items():
        client.markov_timeout[key] -= 1 

@tasks.loop(seconds=30)
async def custom_status():
    with open("configs/status_messages.txt", encoding='UTF-8') as f:
        chosen_text = choice(f.read().rstrip().splitlines())
        chosen_text = chosen_text.replace(".id.", client.user.name)
        await client.change_presence(activity=discord.Game(name=chosen_text))

@client.event
async def on_ready():
    client.markov_timeout = {}
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
        await automatic_markov_generation(message, automatic=True)
    except Exception:
        log_error("markov error")

    if client.user.mentioned_in(message):
        match message.content.split()[1:]:
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
            case ["impact", *args]:
                await generate_markov_image(typee="impact", message=message)
            case ["lobster", *args]:
                await generate_markov_image(typee="lobster", message=message)
            case ["egh", *args]:
                await generate_markov_image(typee="egh", message=message)
            case ["7pul", *args]:
                await generate_markov_image(typee="7pul", message=message)
            case ["gen", *args]:
                await automatic_markov_generation(message, automatic=False, prepend=" ".join(args))
            case _:
                await automatic_markov_generation(message, automatic=False)
                
if __name__ == '__main__':
    with open("configs/1.json") as f:
        cfg = json.load(f)
    client.run(cfg["token"])