// Solution for issue #1416
// Generated automatically by Baobot

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const YAML = require('js-yaml');

const app = express();
const port = 3000;

// Load Swagger YAML file
const swaggerDocument = YAML.load('./swagger.yaml');

// Initialize Swagger-UI
const swaggerUi = swaggerUi.serve(swaggerDocument);
const swaggerOptions = swaggerUi.options(swaggerDocument);

app.use('/docs/api', swaggerUi);

// Example route to demonstrate Swagger-UI functionality
app.get('/docs/api/docs', (req, res) => {
  res.sendFile(__dirname + '/docs/api/docs.html');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});


To use this script, you need to have the `express`, `swagger-ui-express`, and `js-yaml` packages installed. You can install them using npm:

bash
npm install express swagger-ui-express js-yaml


Also, you need to have a `swagger.yaml` file in the same directory as your script. This file should contain the OpenAPI/Swagger specification for your API. Here's a basic example of what `swagger.yaml` might look like:

yaml
openapi: 3.0.0
info:
  title: OphirPay API
  version: 1.0.0
  description: Documentation for OphirPay API
paths:
  /v1/some-endpoint:
    get:
      summary: Retrieves some data
      responses:
        '200':
          description: Success
          content:
            application/json:
              schema:
                type: object
                properties:
                  data:
                    type: string


This script sets up a basic Express server with Swagger-UI, allowing you to view and interact with your API documentation at `http://localhost:3000/docs/api`. Replace the `swaggerDocument` with your own API documentation in `swagger.yaml` to complete the solution.