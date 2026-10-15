// Solution for issue #1416
// Generated automatically by Baobot

const express = require('express');
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "OphirPay API",
      version: "1.0.0",
      description: "API documentation for OphirPay",
    },
    servers: [
      {
        url: "http://localhost:3000",
      },
    ],
  },
  apis: ["./routes/*.js"], // Adjust the path to your API routes
};

const swaggerSpec = swaggerJSDoc(options);
const app = express();

app.use('/docs/api', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/docs/api', (req, res) => {
  res.status(200).send(swaggerSpec);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});


This script sets up a simple Express server with an interactive Swagger UI at `/docs/api`, which can be used to document and test the API routes. Adjust the `"./routes/*.js"` path to point to the actual routes in your project. Make sure to install the required packages (`express`, `swagger-jsdoc`, and `swagger-ui-express`) before running this script:
bash
npm install express swagger-jsdoc swagger-ui-express