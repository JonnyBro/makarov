# Makarov

"Simple" discord bot written in TypeScript using discord.js that generates gibberish using markov chains and whatever you talk about in your server.

The markov chain is a port of [markovify](https://github.com/jsvine/markovify), so text generated from old logs behaves the same as in the original Python version. Internal configurations and logs are stored as files and not in a database. The model for a log file is built once and then only the newly appended lines are added, so only the first generation after a restart is slow on big logs.

## Commands

To use these you have to ping the bot. The bot will generate text if it's pinged and no command is supplied

**allow_private** - Allow logging a channel that's considered private. Will generate text using only private logs and post it only in private channels that have been whitelisted.

**allow_common** - Allow logging a public channel. Will generate text using only public logs and post it only in public channels that have been whitelisted.

**allow_channel** - Allow logging a certain channel. Will generate text using only logs from the specific whitelisted channel and post it only there

**log_history** - Will look at the channel history and log everything. Only works if you already set the channel type.

**randomness / max_overlap / chance** `<value>` - Change generation settings for the current session (admin only).

**impact** - Generate impact meme-styled images using the text generation.

**lobster** - Generate oldschool vk subtitled images using the text generation.

**gen** - Generate text and prepend input

**urlgen** - Get a random link from chat history and post it.

**attgen** - Get a random file from chat history and post it.

## How to use

1. Install Node.js 20.11+ and [pnpm](https://pnpm.io).
2. `pnpm install && pnpm build`
3. Copy `makarov/configs/example (rename me to 1.json later).json` to `makarov/configs/1.json` and put your token there.
4. `pnpm start`, allow a few channels to be logged and enjoy.

`pnpm admin` starts a small console tool to list and leave guilds.

All data lives in `makarov/` (`configs/`, `internal/<guild_id>/`, `logs/`). The format is the same as in the Python version, so you can just drop your old `internal/` folder there. Set `MAKAROV_DIR` to use a different data folder and `MAKAROV_CONFIG` to use a config other than `1.json`.

## TO-DO

- Copy a bunch of stuff from GenAI (bruh, bugurt, demotivator, dialog, ~~impact~~, jacque, ~~lobster~~, comics, ~~string~~)
