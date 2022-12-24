# Makarov

"Simple" discord bot written on python using discord.py and markovify that generates gibberish using markov chains and whatever you talk about in your server.

Since this bot was never designed with more than a few servers in mind the performance can be lacking. For example it takes quite some time to generate any text from a 16mb text database (around 600k messages). Internal configurations and logs are stored as files and not in a database.

### Commands:

To use these you have to ping the bot. The bot will generate text if it's pinged and no command is supplied

**allow_private** - Allow logging a channel that's considered private. Will generate text using using only private logs and post it only in private channels that have been whitelisted.

**allow_common** - Allow logging a public channel. Will generate text using only public logs and post it only in public channels that have been whitelisted.

**allow_channel** - Allow logging a certain channel. Will generate text using only logs from the specific whitelisted channel and post it only there

**log_history** - Will look at the channel history and log everything. Only works if you already set the channel type.

**teejay hvh linus damianluck tomscott** - Generate text with text gathered from these people/topics.

**impact** - Generate impact meme-styled images using the text generation.

**lobster** - Generate oldschool vk subtitled images using the text generation.

**egh** - Generate elder god heavy styled pictures (tf2 lore)

**7pul** - This one is pretty personal as the text came from a guy trying to dox me but I think this deserves a public cmd lol

**gen** - Generate text and prepend input
**imagegen** - Get a random image from chat history and post it.
**dog capybara cat frog** - Random image of the respective animal (unfiltered bing results that were scraped at least a year ago. I am NOT responsible for their content.)

### How to use:

Download the repository, install dependecies from requirements.txt, install imagemagick, configure the bot in makarov/configs/example.json, run main.py, allow a few channels to be logged and enjoy.

### TO-DO:

- Copy a bunch of stuff from GenAI (bruh, bugurt, demotivator, dialog, ~~impact~~, jacque, ~~lobster~~, comics, ~~string~~)

- Clean up the mess


