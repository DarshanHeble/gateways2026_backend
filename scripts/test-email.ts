import { emailService } from '../src/services/email.service.js';

async function testSmtp() {
  const recipient = process.argv[2];
  if (!recipient) {
    console.error('❌ Please provide a target email address to test.');
    console.error('Usage: npx tsx scripts/test-email.ts <your-email@example.com>');
    process.exit(1);
  }

  console.log(`🚀 Sending test email to: ${recipient}...`);
  try {
    const result = await emailService.sendVerificationEmail({
      to: recipient,
      verificationToken: 'TEST-VERIFY-123456',
    });
    console.log('✅ Email sent successfully!');
    console.log('Provider used:', result.provider);
  } catch (err) {
    console.error('❌ Failed to send email:', err);
  }
}

testSmtp();
