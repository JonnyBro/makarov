# Makarov

"Simple" discord bot written on python and discord.py that generates gibberish using markov chains and whatever you talk about in  your server.

### Commands:

To use these you have to ping the bot. The bot will generate text if it's pinged and no command is supplied

**allow_private** - Allow logging a channel that's considered private. Will generate text using using only private logs and post it only in private channels that have been whitelisted.

**allow_common** - Allow logging a public channel. Will generate text using only public logs and post it only in public channels that have been whitelisted.

**allow_channel** - Allow logging a certain channel. Will generate text using only logs from the specific whitelisted channel and post it only there

**update** - Pull from the repository and restart the bot. (explanation in "How to use")


### How to use:

Download the repository, install dependecies from requirements.txt, configure the bot in makarov/configs/example.json, run main.py, allow a few channels to be logged and enjoy.

If you wish to do so, you can setup updating from a remote repository:

- Either create a repository or pull this one (if you wish to create a private fork you'll need authentication keys to pull it)

- Run the bot in the repo directory, so that it restarts everytime it exits (through daemons/services)

- Use m.update to pull an update from the repo and restart the bot.

### TO-DO:

- Generate images that don't make sense using the same text generation
  
- Clean up the mess
  

### Credits:

- JamesBrill - [GitHub - JamesBrill/Markov-Chain-Text-Generator: Script that generates random text based on a source text using a Markov chain.](https://github.com/JamesBrill/Markov-Chain-Text-Generator)

