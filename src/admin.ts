import readline from "node:readline/promises";
import { Client, GatewayIntentBits } from "discord.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("clientReady", async c => {
	console.log(`Logged in as ${c.user.tag}`);
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

	for (;;) {
		console.log("-----------------------");
		console.log("- list - List guilds");
		console.log("- leave (id) - Leave a guild");
		console.log("- exit - Quit");
		console.log("-----------------------");
		const [option, id] = (await rl.question("What do you need to do?: ")).trim().toLowerCase().split(/\s+/);

		if (option === "list")
			for (const guild of c.guilds.cache.values()) console.log(`${guild.name}  -  ${guild.id}`);
		else if (option === "leave" && id) {
			const guild = c.guilds.cache.get(id);
			if (guild) {
				await guild.leave();
				console.log(`Left ${guild.name}`);
			} else console.log("No such guild");
		} else if (option === "exit") {
			rl.close();
			await client.destroy();
			return;
		}
	}
});

client.login(cfg.token);
