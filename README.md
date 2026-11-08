# Makarov

"Simple" discord bot written in TypeScript using discord.js that generates gibberish using markov chains and whatever you talk about in your server.

Messages, whitelists, settings and images are stored in a SQLite database (`data/makarov.db`). The model for a channel is built once in a background thread (so the bot doesn't freeze even on huge logs) and then only new messages are added. The biggest models are built right after startup.

## How it talks

- **Random replies.** Every message in a logged channel has a `chance`% chance to get a reply (at most once per `timeout` seconds per server). If the message mentions the bot's name, the chance is tripled. Sometimes the bot posts a random link or file from the chat history instead (`mediaChance`).
- **Direct replies.** Ping the bot or reply to its message and it will answer using the rarest words of your message as the topic.
- **Mirror mode.** With `mirror` set to 100 the bot answers everyone with their own words: replies are built only from messages of the person it's talking to. Lower values mix it with normal replies. People with fewer than 20 logged sentences get normal replies.
- **Generation.** A markov chain with two words of context that sometimes falls back to one word (`coherence`), so phrases stay readable but get mixed between messages. Case and punctuation are ignored when matching words, so "Привет", "привет" and "привет)" are the same word for the chain. The bot builds a couple dozen candidates, throws away the ones that copy too much of a single message (`maxOverlap`) and picks the best one.

## Storage

- **Messages** are stored with their id, author and time. Running `log_history` again doesn't create duplicates. Edited messages are updated and deleted messages are removed from the database (the model is rebuilt in the background at most once every 10 minutes, so it forgets them a bit later).
- **Images** (jpg, png, webp, gif up to 10 MB) are downscaled to 1280px, stored once per unique file in `data/images/` and used by `attgen`, `impact` and `lobster`. Each server has a quota (`image_quota_mb` in the config, 500 MB by default); the oldest images are removed when it's full.
- **Other files** aren't downloaded. The bot remembers the message and gets a fresh link from Discord when it needs to post the file.
- **NSFW.** Links and files from NSFW channels are never posted in regular channels.

## Commands

All commands are slash commands. Admin-only commands are hidden from other members by default (you can change that in the server's Integrations settings).

**/allow** `type` - Toggle logging of the current channel (admin). Types:

- **common** - all common channels share one log, text from it is posted in any common channel;
- **private** - same, but for private channels;
- **channel** - the channel uses only its own log.

**/log_history** `[where]` - Log old messages of this channel or of every logged channel (`all`) (admin). Progress is posted in the channel every 30 seconds, random replies are paused until it's done. If the bot restarts in the middle, run it again: it continues where it stopped and also picks up messages sent while the bot was offline. Running it again later only fetches what's new.

**/gen** `[text]` `[user]` - Generate text, continuing yours if given. With `user` the bot talks like that person: only their messages from the same logs are used (so nothing leaks from private channels into common ones). It needs at least 20 of their sentences; messages imported from the old text logs have no author and don't count.

**/impact** `[words]` `[user]`, **/lobster** `[words]` `[user]` - Meme from a random image of this chat with generated captions, optionally in the style of a person.

**/urlgen**, **/attgen** - Random link or file from this chat.

**/forget** `[user]` - Delete everything the bot logged from you on this server. Admins can pick another user. Messages imported from the old text logs have no author, so they can't be forgotten this way.

**/settings** - Show this server's settings.

**/set** `setting` `value` - Change a setting for this server (admin): `chance`, `timeout`, `coherence`, `maxOverlap`, `mediaChance`, `mirror`.

**/help** - Short help.

## How to use

1. Install Node.js 20.11+ and [pnpm](https://pnpm.io).
2. `pnpm install && pnpm build`
3. Copy `config.example.json` to `config.json` and put your token there. Values from the config are defaults for servers that didn't change their settings; `statuses` are the bot's status texts (`.id.` is replaced with its name).
4. `pnpm start`, run `/allow` in a few channels, optionally `/log_history all`, and enjoy.

`pnpm admin` starts a small console tool to list and leave guilds.

### Project layout

```sh
assets/fonts/        fonts for /impact and /lobster
src/                 bot sources (pnpm build -> dist/)
config.json          your config (not in git), see config.example.json
data/                created by the bot (not in git)
  makarov.db         messages, whitelists, settings
  images/            stored images
  logs/              error logs
```

Set `MAKAROV_DATA` to keep the data folder somewhere else and `MAKAROV_CONFIG` to use another config file.

### Migrating from the old text logs

If the old channels still exist and the bot is still there, `/log_history all` is the better option: messages get their ids and authors (so `/forget` and deletions work), messages deleted in Discord don't come back, and nothing is skipped. Don't combine both: lines from the old logs can't be matched with messages from the history, so everything would be stored twice. Use the migration only if you need messages that are no longer in Discord.

Run `pnpm build && pnpm migrate path/to/old/internal`, where the folder contains the old `<guild_id>/` folders, then start the bot. The script imports whitelists, settings, logs and images into the database and doesn't touch the old files, so you can delete them yourself once everything works.

- Identical lines inside one log are imported once (pass `--keep-duplicates` to keep them).
- `channel_attachment_*` files are skipped: the old version saved them without the channel id, so it's unknown where they came from.
- Non-image attachments are skipped: without a message id the bot can't get a link to them.
- Each server is imported once; `--force` imports it again (and duplicates the data).
