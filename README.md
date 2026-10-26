# VAC-Bot

A Node.js bot for virtual-airline community operations.

## Requirements
- Node.js 18.18 or newer
- npm

## Run locally
```bash
git clone https://github.com/Gurnoor1-dev/VAC-Bot.git
cd VAC-Bot
npm install
```

Create a local `.env` file for required bot tokens, IDs, and configuration. Use the variable names read by `index.js`; never commit secrets. Start the bot:

```bash
npm start
```

## Deploy from a terminal
On a persistent Node.js host, install Node.js, clone the repository, run `npm install`, configure environment variables, and run `npm start`. Use a process manager or managed worker service to keep it online.

## Deploy on Vercel
Discord bots typically need a persistent WebSocket connection, so Vercel Functions are not suitable for running this bot continuously. Deploy the bot on a persistent Node.js host. Vercel can host a separate web dashboard or webhook endpoint if the code is adapted for serverless execution.

## Security
Keep bot tokens out of source control. Rotate any token that has been exposed and store production values in the hosting provider's secret settings.