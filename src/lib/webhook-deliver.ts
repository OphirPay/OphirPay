import crypto from 'crypto';

/**
 * Verifies the HMAC signature in a timing-safe manner.
 * @param {string} signature - The signature from the webhook.
 * @param {string} payload - The payload that was sent.
 * @param {string} secret - The secret key used for HMAC.
 * @returns {boolean} - Returns true if the signature is valid, false otherwise.
 */
function verifyHmacSignature(signature, payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(payload).digest('hex');

    // Use a timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(digest, 'hex'));
}

// Example usage in the webhook handler
export function handleWebhook(req, res) {
    const signature = req.headers['x-signature'];
    const payload = JSON.stringify(req.body);
    const secret = process.env.WEBHOOK_SECRET;

    if (!verifyHmacSignature(signature, payload, secret)) {
        return res.status(403).send('Invalid signature');
    }

    // Process the webhook payload
    // ...
    res.status(200).send('Webhook received');
}