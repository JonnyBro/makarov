# Makarov

"Simple" discord bot written on python and discord.py that
 generates gibberish using markov chains and whatever you talk about in 
your server.

### Commands:

**m.allow_private** - Allow logging a channel that's considered private. Will generate text using using only private logs and post it only in private channels that have been whitelisted.

**m.allow_common** - Allow logging a public channel. Will generate text using only public logs and post it only in public channels that have been whitelisted.

**m.allow_channel** - Allow logging a certain channel. Will generate text using only logs from the specific whitelisted channel and post it only there

**m.gen** - Trigger random text generation manually based on the channel it's executed in.


### How to use:

Download the repository, install dependecies from requirements.txt, configure the bot in makarov/configs/example.json, run main.py, allow a few channels to be logged and enjoy.

### TO-DO:

- Generate images that don't make sense using the same text generation
  
- Clean up the mess
  

### Credits:

- JamesBrill - [GitHub - JamesBrill/Markov-Chain-Text-Generator: Script that generates random text based on a source text using a Markov chain.](https://github.com/JamesBrill/Markov-Chain-Text-Generator)
