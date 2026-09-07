const { start, shutdown } = require('./app');

start().catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});

process.on('SIGTERM', () => shutdown('SIGTERM').catch(() => process.exit(1)));
process.on('SIGINT', () => shutdown('SIGINT').catch(() => process.exit(1)));
