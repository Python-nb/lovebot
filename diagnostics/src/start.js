const http = require('node:http');
const { createHandler } = require('./ingest');
const enabled = process.env.DIAGNOSTICS_INGEST_ENABLED === 'true';
http.createServer(createHandler({ enabled })).listen(8080, '0.0.0.0', () => {
  process.stdout.write(`BLE diagnostic ingest listening on 8080; enabled=${enabled}\n`);
});
