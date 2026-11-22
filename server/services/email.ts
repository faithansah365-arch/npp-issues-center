import nodemailer, { type Transporter } from 'nodemailer';
import { config, isSmtpConfigured } from '../config.ts';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: {
        user: config.smtp.user,
        pass: config.smtp.pass,
      },
    });
  }
  return transporter;
}

export interface EmailSendResult {
  sent: boolean;
  reason: string;
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  text: string;
}): Promise<EmailSendResult> {
  const tx = getTransporter();
  if (!tx) {
    return {
      sent: false,
      reason: 'SMTP provider is not configured on the server.',
    };
  }

  try {
    await tx.sendMail({
      from: config.smtp.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });
    return {
      sent: true,
      reason: 'Delivered to SMTP transport.',
    };
  } catch (err) {
    console.error('[email] SMTP send error:', (err as Error).message);
    return {
      sent: false,
      reason: `SMTP delivery failed: ${(err as Error).message}`,
    };
  }
}
