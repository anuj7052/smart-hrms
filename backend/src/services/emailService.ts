import nodemailer from 'nodemailer';

async function createTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    // Auto-create a real Ethereal test account for dev
    const testAccount = await nodemailer.createTestAccount();
    return nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
  }

  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    auth: { user, pass },
  });
}

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: MailOptions): Promise<void> {
  const from = process.env.SMTP_FROM || '"HRMS" <no-reply@hrms.app>';
  const transporter = await createTransporter();

  const info = await transporter.sendMail({ from, to, subject, html });
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Email] Preview URL:', nodemailer.getTestMessageUrl(info));
  }
}
