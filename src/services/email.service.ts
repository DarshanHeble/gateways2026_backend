import nodemailer, { Transporter } from 'nodemailer';
import { loadConfig, AppConfig } from '../config/env.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailVerificationOptions {
  to: string;
  verificationToken: string;
  verificationUrl?: string;
}

class EmailService {
  private primaryTransporter: Transporter | null = null;
  private fallbackTransporter: Transporter | null = null;
  private config: AppConfig;

  constructor() {
    this.config = loadConfig();
    this.initTransporters();
  }

  private initTransporters(): void {
    // Helper to create transport config from URL or host/port/auth params
    const createTransportConfig = (
      url?: string,
      host?: string,
      port?: number,
      user?: string,
      pass?: string,
      secure?: boolean
    ) => {
      if (url) {
        return url;
      }
      if (host) {
        return {
          host,
          port: port || 587,
          secure: secure ?? (port === 465),
          auth: user ? { user, pass } : undefined,
        };
      }
      return null;
    };

    // Primary transporter setup
    const primaryConfig = createTransportConfig(
      this.config.SMTP_URL,
      this.config.SMTP_HOST,
      this.config.SMTP_PORT,
      this.config.SMTP_USER,
      this.config.SMTP_PASS,
      this.config.SMTP_SECURE
    );

    if (primaryConfig) {
      this.primaryTransporter = nodemailer.createTransport(primaryConfig as any);
    }

    // Fallback transporter setup
    const fallbackConfig = createTransportConfig(
      this.config.SMTP_FALLBACK_URL,
      this.config.SMTP_FALLBACK_HOST,
      this.config.SMTP_FALLBACK_PORT,
      this.config.SMTP_FALLBACK_USER,
      this.config.SMTP_FALLBACK_PASS,
      this.config.SMTP_FALLBACK_SECURE
    );

    if (fallbackConfig) {
      this.fallbackTransporter = nodemailer.createTransport(fallbackConfig as any);
    }
  }

  public async sendEmail(options: EmailOptions): Promise<{ success: boolean; provider: 'primary' | 'fallback' | 'dev_log' }> {
    const primaryFrom = this.config.SMTP_FROM || this.config.SMTP_USER || 'noreply@gateways2026.com';
    const fallbackFrom = this.config.SMTP_FALLBACK_FROM || this.config.SMTP_FALLBACK_USER || primaryFrom;

    // 1. Try Primary SMTP
    if (this.primaryTransporter) {
      try {
        await this.primaryTransporter.sendMail({
          from: primaryFrom,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        });
        return { success: true, provider: 'primary' };
      } catch (primaryErr) {
        console.warn('⚠️ Primary SMTP failed or rate-limited. Retrying with Fallback SMTP...', primaryErr);
      }
    }

    // 2. Try Fallback SMTP
    if (this.fallbackTransporter) {
      try {
        await this.fallbackTransporter.sendMail({
          from: fallbackFrom,
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text,
        });
        return { success: true, provider: 'fallback' };
      } catch (fallbackErr) {
        console.error('❌ Fallback SMTP also failed:', fallbackErr);
        throw fallbackErr;
      }
    }

    // 3. If no SMTP configured, log in development
    if (this.config.NODE_ENV === 'development' || this.config.NODE_ENV === 'test') {
      console.log(`[DEV EMAIL LOG] To: ${options.to} | Subject: ${options.subject}`);
      console.log(`[DEV EMAIL HTML] ${options.html}`);
      return { success: true, provider: 'dev_log' };
    }

    throw new Error('No SMTP transporter configured or all SMTP services failed.');
  }

  public async sendVerificationEmail(options: EmailVerificationOptions): Promise<{ success: boolean; provider: string }> {
    // Verification is a 6-digit OTP submitted via POST /api/v1/auth/verify-email —
    // there is no GET link the user can click. This previously defaulted to a
    // fabricated `?token=` URL against that POST-only route, so the "Verify Email"
    // button 404'd for every user who clicked it.
    //
    // A button is rendered only when a caller supplies a real FRONTEND url (which
    // is the frontend's own verification page, not an API endpoint). Otherwise the
    // email leads with the code, which is the thing that actually works.
    const verifyUrl = options.verificationUrl;

    const ctaBlock = verifyUrl
      ? `
        <p>Thank you for registering! Use the button below, or enter the code manually.</p>
        <div style="margin: 24px 0; text-align: center;">
          <a href="${verifyUrl}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verify Email</a>
        </div>
        <p style="color: #666; font-size: 14px;">Or enter this verification code:</p>`
      : `
        <p>Thank you for registering! Enter this verification code to confirm your email address:</p>`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #4f46e5;">Verify Your Email - PARALLAX Gateways 2026</h2>${ctaBlock}
        <code style="background-color: #f3f4f6; padding: 8px 12px; display: inline-block; border-radius: 4px; font-family: monospace; font-size: 20px; letter-spacing: 3px;">${options.verificationToken}</code>
        <p style="color: #666; font-size: 14px;">This code expires in 15 minutes.</p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #e0e0e0;" />
        <p style="color: #999; font-size: 12px;">If you did not request this, please ignore this email.</p>
      </div>
    `;

    const text = verifyUrl
      ? `Verify your email for Gateways 2026 at ${verifyUrl} — or enter this code: ${options.verificationToken} (expires in 15 minutes).`
      : `Your Gateways 2026 verification code is ${options.verificationToken} (expires in 15 minutes).`;

    return this.sendEmail({
      to: options.to,
      subject: 'Verify your email for Gateways 2026',
      html,
      text,
    });
  }
}

export const emailService = new EmailService();
