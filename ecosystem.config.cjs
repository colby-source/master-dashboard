module.exports = {
  apps: [{
    name: 'master-dashboard',
    script: 'node_modules/tsx/dist/cli.mjs',
    args: 'server/index.ts',
    cwd: 'C:\\Users\\colby\\Master Dashboard',
    interpreter: 'node',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production',
      ENABLE_TUNNEL: 'true',
    },
  }],
};
