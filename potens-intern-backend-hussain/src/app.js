const express = require('express');
const pinoHttp = require('pino-http');
require('dotenv').config();

// Create the app in its own module so tests can import it without opening a port.
const app = express();

// Attach structured request logs early so every route gets request metadata.
app.use(pinoHttp());

// Parse JSON request bodies for API endpoints that will be added later.
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

module.exports = app;
