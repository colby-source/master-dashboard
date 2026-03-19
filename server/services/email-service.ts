import { config } from '../config';
import { instantlyService } from './instantly-service';

class EmailService {
  get available(): boolean {
    return !!config.instantlyApiKey;
  }

  async sendMail(to: string | string[], subject: string, html: string, from?: string): Promise<void> {
    if (!this.available) {
      console.warn('[Email] Instantly API key not configured — skipping send');
      return;
    }

    const recipients = Array.isArray(to) ? to : [to];
    const sender = from || config.report.fromEmail;

    for (const recipient of recipients) {
      try {
        await instantlyService.sendTestEmail({
          from: sender,
          to: recipient,
          subject,
          body: html,
        });
        console.log(`[Email] Sent "${subject}" to ${recipient} via Instantly`);
      } catch (err) {
        console.error(`[Email] Failed to send to ${recipient}:`, err);
        throw err;
      }
    }
  }
}

export const emailService = new EmailService();
