const app = require('./app');
const pino = require('pino');
require('dotenv').config();

// Use a process-level logger for startup events that happen outside a request.
const logger = pino();

// Default to 3000 so the service can run locally without a PORT env var.
const PORT = process.env.PORT || 3000;

// Start listening only from this entrypoint to keep app.js import-safe for tests.
app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Server listening');
});
