// Solution for issue #1373
// Generated automatically by Baobot

Certainly! Below is a self-contained Node.js JavaScript script that you can run as a server to serve a simple HTML page with a live network transaction fee estimator widget. This script assumes that the transaction fee data is provided in a JSON format for simplicity.

First, ensure you have a JSON file containing the transaction fee data. For this example, let's assume we have a `transactionFees.json` file:

on
[
    {
        "network": "mainnet",
        "fee": 0.0005
    },
    {
        "network": "testnet",
        "fee": 0.0002
    }
]


Here is the Node.js script:


const express = require('express');
const fs = require('fs');
const axios = require('axios');
const app = express();
const port = 3000;

// Load transaction fees from JSON file
let transactionFees;
try {
    transactionFees = JSON.parse(fs.readFileSync('transactionFees.json', 'utf-8'));
} catch (error) {
    console.error("Error reading transactionFees.json:", error);
}

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

// Endpoint to get transaction fees
app.get('/api/transaction-fees', (req, res) => {
    res.json(transactionFees);
});

// HTML file to serve
const publicDir = __dirname + '/public';
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}
fs.writeFileSync(publicDir + '/index.html', `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transaction Fee Estimator</title>
    <script>
        async function getFee() {
            const response = await fetch('/api/transaction-fees');
            const data = await response.json();
            const networks = Object.values(data);
            const dropdown = document.getElementById('network');
            networks.forEach(network => {
                const option = document.createElement('option');
                option.value = network.network;
                option.textContent = network.network;
                dropdown.appendChild(option);
            });
        }

        window.onload = getFee;
    </script>
</head>
<body>
    <h1>Transaction Fee Estimator</h1>
    <p>Choose your network:</p>
    <select id="network"></select>
</body>
</html>
`);


To run the server, save the above script in a file named `server.js`, then run:

sh
node server.js


This will start a server on `http://localhost:3000/`. The `index.html` file served by the server includes a dropdown menu to select the network, and a fetch request to `/api/transaction-fees` to get the available networks and populate the dropdown. You can then use this server in your GitHub Actions workflow to serve the transaction fee estimator widget.