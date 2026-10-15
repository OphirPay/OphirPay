import { Request, Response } from 'express';
import { validateMemo } from '../utils/memoValidator'; // Assuming a utility function for memo validation

// Example payment route
app.post('/payments', async (req: Request, res: Response) => {
    const { address, amount, memo } = req.body;

    // Validate address and amount (not shown)

    // Validate memo if provided
    if (memo && !validateMemo(memo)) {
        return res.status(400).json({ error: 'Invalid memo format or length.' });
    }

    // Proceed with payment processing (not shown)
});

// Utility function for memo validation
export function validateMemo(memo: string): boolean {
    const utf8Bytes = Buffer.byteLength(memo, 'utf8');
    const hexRegex = /^[0-9a-fA-F]{64}$/;

    if (utf8Bytes > 28) {
        return false; // Memo exceeds 28 bytes
    }

    // Check if memo is a valid UTF-8 string
    try {
        decodeURIComponent(escape(memo)); // This will throw if memo is not valid UTF-8
    } catch (e) {
        return false; // Invalid UTF-8
    }

    // Check if memo is a valid Hash/Return type
    if (memo.length === 64 && hexRegex.test(memo)) {
        return true; // Valid Hash/Return type
    }

    return true; // Valid Text or Id type
}