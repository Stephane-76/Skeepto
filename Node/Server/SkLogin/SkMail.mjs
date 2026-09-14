// ============================================================================
// SkMail — send mail via SMTP (.env) or the system msmtp relay
// ============================================================================
import { spawn } from 'node:child_process'

function envFlag(name) {
  const value = String(process.env[name] || '').trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function buildRawMessage({ from, to, subject, text }) {
  const lines = []
  if (from) {
    lines.push(`From: ${from}`)
  }
  lines.push(`To: ${to}`)
  lines.push(`Subject: ${subject}`)
  lines.push('Content-Type: text/plain; charset=UTF-8')
  lines.push('')
  lines.push(text)
  if (!text.endsWith('\n')) {
    lines.push('')
  }
  return lines.join('\n')
}

async function sendViaSmtp({ from, to, subject, text }) {
  const nodemailer = await import('nodemailer')
  const port = Number(process.env.SMTP_PORT) || 465
  const secure = process.env.SMTP_SECURE
    ? envFlag('SMTP_SECURE')
    : port === 465
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || '',
        }
      : undefined,
  })
  await transporter.sendMail({
    from: from || process.env.SMTP_USER,
    to,
    subject,
    text,
  })
}

function sendViaMsmtp({ from, to, subject, text }) {
  const raw = buildRawMessage({ from, to, subject, text })
  return new Promise((resolve, reject) => {
    const child = spawn('msmtp', ['--', to], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      reject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(stderr.trim() || `msmtp exited with code ${code}`))
    })
    child.stdin.write(raw)
    child.stdin.end()
  })
}

/**
 * Send a plain-text email.
 * Uses SMTP_* env when SMTP_HOST is set, otherwise the system msmtp config
 * (Linux VPS relay to mail.skeema.fr).
 */
export async function sendMail({ to, subject, text, from }) {
  const recipient = String(to || '').trim()
  if (!recipient) {
    throw new Error('Missing mail recipient')
  }
  const sender = (from || process.env.SMTP_FROM || '').trim()
  const payload = {
    from: sender,
    to: recipient,
    subject: String(subject || '').trim() || 'Skeepto',
    text: String(text || ''),
  }
  if (process.env.SMTP_HOST?.trim()) {
    await sendViaSmtp(payload)
    return
  }
  await sendViaMsmtp(payload)
}
