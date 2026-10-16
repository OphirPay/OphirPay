// Solution for issue #1416
// Generated automatically by Baobot

// This script assumes that you have a Node.js environment set up with OphirPay/OphirPay repository cloned locally.

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const yaml = YAML.load('./doc/api.yaml'); // Assuming OpenAPI documentation is in a YAML file named doc/api.yaml

const app = express();

// Swagger configuration
app.use('/docs/api', swaggerUi.serve, swaggerUi.setup(yaml));

// Route to serve the Swagger UI documentation at /docs/api
app.get('/docs/api', (req, res) => {
  res.sendFile(__dirname + '/doc/api.html'); // Assuming the Swagger UI documentation is served from a file named api.html
});

// Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});


This script sets up an Express server to serve Swagger UI for OpenAPI documentation at the `/docs/api` endpoint. It assumes the OpenAPI documentation is provided in a YAML file named `doc/api.yaml`. Adjust the file paths and server port as needed for your environment.