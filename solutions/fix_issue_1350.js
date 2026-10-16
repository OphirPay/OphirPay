// Solution for issue #1350
// Generated automatically by Baobot

// node_modules/oophirpay/lib/payment.js

class Payment {
  constructor(apiClient, userId) {
    this.apiClient = apiClient;
    this.userId = userId;
  }

  async createStream(minDuration, maxDuration) {
    if (minDuration > maxDuration) {
      throw new Error("Minimum duration cannot be greater than maximum duration");
    }

    const response = await this.apiClient.createStream({
      userId: this.userId,
      minDuration: minDuration,
      maxDuration: maxDuration,
    });

    if (!response.success) {
      throw new Error(`Payment stream creation failed: ${response.message}`);
    }

    return response.stream;
  }
}

module.exports = Payment;


This code snippet defines a `Payment` class with a `createStream` method that enforces the minimum and maximum duration bounds. It also includes error handling for invalid duration configurations and failed API responses.