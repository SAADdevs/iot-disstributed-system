require('dotenv').config({ quiet: true });

const app = require('./app');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`REST API running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Arrêt propre (Docker kayb3t SIGTERM melli tdir docker compose down)
function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);
  server.close(() => process.exit(0));
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));