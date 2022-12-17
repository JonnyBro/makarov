import os
import subprocess
import shlex
import logging
from time import time
from functools import wraps, partial
import traceback
import asyncio
from random import choice

logging.basicConfig(level=logging.ERROR, filename=f"logs/makarov_{round(time())}.log", filemode="w")

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

def create_dir(dirr):
    if not os.path.exists(dirr):
        os.mkdir(dirr)

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

@async_wrap
def get_random_line(file):
    with open(file, encoding='UTF-8') as f:
        links = f.read()
        return choice(links.rstrip().splitlines())