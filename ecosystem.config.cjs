// PM2 process definition for the ProofPass dashboard.
// Usage: pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "proofpass-dashboard",
      script: "dist/index.js",
      cwd: "/home/mdlog/Project-MDlabs/Akindo/Midnight/proofpass-dashboard",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: 3010,
      },
    },
  ],
};
