module.exports = {
  apps: [
    {
      name: "phone-market-bot",
      script: "src/index.js",
      cwd: __dirname,
      instances: 1, // must stay 1: one userbot session, one polling bot
      autorestart: true,
      max_memory_restart: "400M",
      env: { NODE_ENV: "production" },
    },
  ],
};
