import nodemailer, { Transporter } from 'nodemailer';
import { EMAIL_TEMPLATES } from './templates';
import { logger } from './logger';

const {
  EMAIL_HOST,
  EMAIL_PORT,
  EMAIL_USER,
  EMAIL_PASS,
  EMAIL_FROM,
  EMAIL_RETRY_COUNT = '3',
  EMAIL_RETRY_DELAY_MS = '1000',
} = process.env;

if (!EMAIL_HOST || !EMAIL_PORT || !EMAIL_USER || !EMAIL_PASS || !EMAIL_FROM) {
  // In production we want to fail fast. The startup validation will also catch this,
  // but we guard here to avoid silent failures if sendEmail is called before startup.
  throw new Error(
    'Missing required email configuration. Please set EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, and EMAIL_FROM.',
  );
}

const transporter: Transporter = nodemailer.createTransport({
  host: EMAIL_HOST,
  port: Number(EMAIL_PORT),
  secure: Number(EMAIL_PORT) === 465, // true for 465, false for other ports
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

export interface EmailOptions {
  to: string;
  subject: string;
  template: keyof typeof EMAIL_TEMPLATES;
  data: Record<string, unknown>;
}

/**
 * Send an email using the configured SMTP provider.
 *
 * @param options EmailOptions
 * @returns Promise<boolean> - true if the provider accepted the message, false otherwise
 */
export async function sendEmail(options: EmailOptions): Promise<boolean> {
  const { to, subject, template, data } = options;
  const templateFn = EMAIL_TEMPLATES[template];
  if (!templateFn) {
    logger.warn(`Email template ${template} not found`);
    return false;
  }

  const { html, text } = templateFn(data);

  const mailOptions = {
    from: EMAIL_FROM,
    to,
    subject,
    text,
    html,
  };

  const retryCount = Number(EMAIL_RETRY_COUNT);
  const retryDelay = Number(EMAIL_RETRY_DELAY_MS);

  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      await transporter.sendMail(mailOptions);
      logger.info(`Email sent to ${to} (subject: ${subject})`);
      return true;
    } catch (err: any) {
      logger.error(
        `Attempt ${attempt} to send email to ${to} failed: ${err.message}`,
      );
      if (attempt < retryCount) {
        await new Promise((res) => setTimeout(res, retryDelay));
      } else {
        return false;
      }
    }
  }
  return false;
}
