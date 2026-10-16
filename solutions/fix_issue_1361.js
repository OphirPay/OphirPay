// Solution for issue #1361
// Generated automatically by Baobot

const rp = require('request-promise-native'); // For testing, replace with axios or fetch in production

async function getAuditLogs(page = 1, pageSize = 10, sortBy = 'created_at', sortOrder = 'desc') {
  const url = 'https://api.example.com/api/audit-log'; // Replace with actual API endpoint
  const options = {
    uri: `${url}?page=${page}&pageSize=${pageSize}&sortBy=${sortBy}&sortOrder=${sortOrder}`,
    json: true, // Automatically parses JSON responses
  };

  try {
    const response = await rp(options);
    return response;
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    throw error;
  }
}

// Example usage:
(async function fetchAuditLogs() {
  try {
    const logs = await getAuditLogs(1, 10, 'created_at', 'desc');
    console.log(logs);
  } catch (error) {
    console.error(error);
  }
})();


This script defines an asynchronous function `getAuditLogs` that fetches audit logs from a hypothetical API endpoint using the `request-promise-native` library. The function allows for pagination (`page`, `pageSize`), sorting (`sortBy`, `sortOrder`), and error handling. Replace the API endpoint URL with the actual URL of the `/api/audit-log` route in the GitHub issue.