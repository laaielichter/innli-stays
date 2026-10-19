import { createTransport } from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  /** Whether mail actually leaves the server (SMTP configured). */
  readonly enabled: boolean;
  send(mail: Mail): Promise<void>;
}

/**
 * SMTP mailer for request notifications. Most B&B owners can use the SMTP
 * details of their own mailbox (e.g. smtps://info%40mijnbnb.nl:wachtwoord@mail.provider.nl:465).
 * Without SMTP, requests still arrive in the dashboard.
 */
export function createMailer(smtpUrl: string | undefined, from: string | undefined): Mailer {
  if (!smtpUrl) return { enabled: false, send: async () => {} };
  const transport = createTransport(smtpUrl);
  const smtpUser = decodeURIComponent(new URL(smtpUrl).username) || undefined;
  return {
    enabled: true,
    async send(mail) {
      try {
        await transport.sendMail({ from: from ?? smtpUser, ...mail });
      } catch (err) {
        // A failing mailbox must never lose a request: it is already stored.
        console.error(`E-mail aan ${mail.to} niet verstuurd: ${(err as Error).message}`);
      }
    },
  };
}

/** For tests and local development: keeps sent mail in memory. */
export class MemoryMailer implements Mailer {
  readonly enabled = true;
  sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
}
