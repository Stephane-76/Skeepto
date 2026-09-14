// ============================================================================
// SkLogin Login of application
// Author Stéphane ALLEZ le 01/03/2025
// ============================================================================
import bcrypt  from 'bcrypt'
import jwt  from 'jsonwebtoken'
import { createHash, randomInt, timingSafeEqual } from 'node:crypto'
import { ensureUserHomeDirectory } from '../SkVirtualDisk/SkUserHome.mjs'
import { sendMail } from './SkMail.mjs'

// Use a more secure secret key
export const JWT_SECRET = process.env.JWT_SECRET || 'sker-app-secure-jwt-secret-key-2025';

// Bootstrap admin (no DB row required). Override in production via .env.
const SKER_ADMIN_EMAIL = process.env.SKER_ADMIN_EMAIL || 'admin@sker.com'
const SKER_ADMIN_PASSWORD = process.env.SKER_ADMIN_PASSWORD || 'Il fait beau a rouen'

const SKER_DEFAULT_USER_GROUP = process.env.SKER_DEFAULT_USER_GROUP || 'user'
const SKER_REGISTRATION_ENABLED =
  process.env.SKER_REGISTRATION_ENABLED !== '0' &&
  process.env.SKER_REGISTRATION_ENABLED !== 'false'

const EMAIL_RE = /^[\w-.]+@([\w-]+\.)+[\w-]{2,}$/i
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/

const LOGIN_MAX_FAILED_ATTEMPTS = 3
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000
const EMAIL_VERIFY_TTL_MS = 15 * 60 * 1000
const EMAIL_VERIFY_MAX_ATTEMPTS = 5
const EMAIL_RESEND_MIN_MS = 60 * 1000

/** In-memory failed-login tracker: email -> { failedCount, lockedUntil, lastFailedAt } */
const loginAttempts = new Map()

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function formatLockoutWait(remainingMs) {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes > 0 && seconds > 0) {
    return `${minutes} min ${seconds} s`
  }
  if (minutes > 0) {
    return `${minutes} min`
  }
  return `${seconds} s`
}

function pruneLoginAttempts(now = Date.now()) {
  for (const [key, state] of loginAttempts) {
    const lockExpired = state.lockedUntil && state.lockedUntil <= now
    const staleFails =
      !state.lockedUntil &&
      state.lastFailedAt &&
      now - state.lastFailedAt > LOGIN_LOCKOUT_MS
    if (lockExpired || staleFails) {
      loginAttempts.delete(key)
    }
  }
}

function getLoginLock(email) {
  const now = Date.now()
  pruneLoginAttempts(now)
  const state = loginAttempts.get(email)
  if (!state?.lockedUntil) {
    return { locked: false }
  }
  const remainingMs = state.lockedUntil - now
  if (remainingMs <= 0) {
    loginAttempts.delete(email)
    return { locked: false }
  }
  return {
    locked: true,
    remainingMs,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
  }
}

function recordFailedLogin(email) {
  const now = Date.now()
  pruneLoginAttempts(now)
  const state = loginAttempts.get(email) || {
    failedCount: 0,
    lockedUntil: 0,
    lastFailedAt: 0,
  }
  if (state.lockedUntil && state.lockedUntil > now) {
    return state
  }
  if (state.lockedUntil && state.lockedUntil <= now) {
    state.failedCount = 0
    state.lockedUntil = 0
  }
  state.failedCount += 1
  state.lastFailedAt = now
  if (state.failedCount >= LOGIN_MAX_FAILED_ATTEMPTS) {
    state.lockedUntil = now + LOGIN_LOCKOUT_MS
  }
  loginAttempts.set(email, state)
  return state
}

function clearLoginAttempts(email) {
  loginAttempts.delete(email)
}

function isEmailVerified(user) {
  return user?.EmailVerified !== false
}

function generateVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function hashVerificationCode(code) {
  return createHash('sha256').update(String(code || '').trim()).digest('hex')
}

function verificationCodeMatches(storedHash, code) {
  if (!storedHash || typeof storedHash !== 'string' || storedHash.length !== 64) {
    return false
  }
  const expected = Buffer.from(storedHash, 'hex')
  const actual = Buffer.from(hashVerificationCode(code), 'hex')
  if (expected.length !== actual.length) {
    return false
  }
  return timingSafeEqual(expected, actual)
}

function buildVerificationEmail({ firstName, code }) {
  const greeting = firstName ? `Hello ${firstName},` : 'Hello,'
  return {
    subject: 'Your Skeepto verification code',
    text:
      `${greeting}\n\n` +
      `Your verification code is:\n\n` +
      `${code}\n\n` +
      `It expires in 15 minutes.\n\n` +
      `If you did not create this account, you can ignore this email.\n`,
  }
}

async function issueVerificationCode(userCollection, email, extraFields = {}) {
  const code = generateVerificationCode()
  const now = Date.now()
  await userCollection.updateOne(
    { Email: email },
    {
      $set: {
        ...extraFields,
        EmailVerified: false,
        EmailVerifyCodeHash: hashVerificationCode(code),
        EmailVerifyExpires: now + EMAIL_VERIFY_TTL_MS,
        EmailVerifyAttempts: 0,
        EmailVerifySentAt: now,
      },
    }
  )
  return code
}

async function sendVerificationEmail({ firstName, email, code }) {
  const mail = buildVerificationEmail({ firstName, code })
  await sendMail({
    to: email,
    subject: mail.subject,
    text: mail.text,
  })
}

function isBcryptHash(value) {
  return typeof value === 'string' && (value.startsWith('$2b$') || value.startsWith('$2a$'))
}

function storedPasswordHash(user) {
  const password = user?.Password
  const passWord = user?.PassWord
  // Prefer bcrypt hash; form updates write PassWord while legacy seed uses Password.
  if (isBcryptHash(passWord) && !isBcryptHash(password)) {
    return passWord
  }
  if (isBcryptHash(password)) {
    return password
  }
  if (isBcryptHash(passWord)) {
    return passWord
  }
  return password ?? passWord ?? ''
}

// JWT options for better security
const JWT_OPTIONS = {
  expiresIn: '1h',
  algorithm: 'HS256',
  issuer: 'sker-app',
  audience: 'sker-app-client'
};

export async function SkLogin(fastify,opts) {
  
  // Function to hash password
  async function hashPassword(password) {
    // Generate a salt with 10 rounds
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  }

  // Function to verify password
  async function verifyPassword(sEmail, sPassword) {
    try {
      let wUser={}
      wUser.Email=sEmail
      
      // Bootstrap admin for app init (matches SKER_ADMIN_* in .env)
      if (sEmail === SKER_ADMIN_EMAIL && sPassword === SKER_ADMIN_PASSWORD) {
        wUser._id = 1
        wUser.FirstName = 'Super'
        wUser.Name = 'Admin'
        wUser.Email = SKER_ADMIN_EMAIL
        wUser.Group="admin"
        // Hash the password for the test user
        wUser.Password = await hashPassword(sPassword);
        return { isValid: true, message: 'Authentication successful', user: wUser };
      }

      // Get users collection
      const wCollection = fastify.mongo.db.collection('User');
      
      // Search user by email
      wUser = await wCollection.findOne({ Email: normalizeEmail(sEmail) });
      
      if (!wUser) {
        return { isValid: false, message: 'User not found' };
      }

      const stored = storedPasswordHash(wUser);
      if (!stored) {
        return { isValid: false, message: 'Incorrect password' };
      }

      let isMatch = false;
      if (isBcryptHash(stored)) {
        isMatch = await bcrypt.compare(sPassword, stored);
      } else if (isBcryptHash(sPassword)) {
        isMatch = sPassword === stored;
      } else {
        // Legacy plain-text passwords (seed data)
        isMatch = sPassword === stored;
      }
      if (!isMatch) {
        return { isValid: false, message: 'Incorrect password' };
      }

      return { isValid: true, message: 'Authentication successful', user:wUser };
    } catch (error) {
      console.error('Error during password verification:', error);
      return { isValid: false, message: 'Verification error' };
    }
  }

  // Public self-service registration (login page)
  fastify.post('/register', { config: { compress: false } }, async function (request, reply) {
    if (!SKER_REGISTRATION_ENABLED) {
      return reply.status(403).send({
        status: 'error',
        message: 'Registration is disabled',
      });
    }

    try {
      const body = request.body || {};
      const name = String(body.name ?? body.Name ?? '').trim();
      const firstName = String(body.firstName ?? body.FirstName ?? '').trim();
      const email = normalizeEmail(body.email ?? body.Email);
      const password = String(body.password ?? body.Password ?? '');

      if (!name || !firstName || !email || !password) {
        return reply.status(400).send({
          status: 'error',
          message: 'Last name, first name, email and password are required',
        });
      }
      if (name.length > 30 || firstName.length > 30) {
        return reply.status(400).send({
          status: 'error',
          message: 'Name fields must be 30 characters or less',
        });
      }
      if (email.length > 60 || !EMAIL_RE.test(email)) {
        return reply.status(400).send({
          status: 'error',
          message: 'Please enter a valid email address',
        });
      }
      if (!PASSWORD_RE.test(password)) {
        return reply.status(400).send({
          status: 'error',
          message:
            'Password must be at least 8 characters and include uppercase, lowercase and a number',
        });
      }

      const db = fastify.mongo.db;
      const groupDoc = await db.collection('Group').findOne({ Code: SKER_DEFAULT_USER_GROUP });
      if (!groupDoc) {
        return reply.status(503).send({
          status: 'error',
          message: `Default group "${SKER_DEFAULT_USER_GROUP}" is not configured`,
        });
      }

      const userCollection = db.collection('User');
      const existing = await userCollection.findOne({ Email: email });
      if (existing && isEmailVerified(existing)) {
        return reply.status(409).send({
          status: 'error',
          message: 'An account with this email already exists',
        });
      }

      const now = Date.now();
      if (
        existing &&
        existing.EmailVerifySentAt &&
        now - existing.EmailVerifySentAt < EMAIL_RESEND_MIN_MS
      ) {
        const retryAfterSeconds = Math.ceil(
          (EMAIL_RESEND_MIN_MS - (now - existing.EmailVerifySentAt)) / 1000
        );
        reply.header('Retry-After', String(retryAfterSeconds));
        return reply.status(429).send({
          status: 'error',
          needsVerification: true,
          retryAfterSeconds,
          message: 'Please wait a minute before requesting a new verification code',
        });
      }

      const hashedPassword = await hashPassword(password);
      const profile = {
        Name: name,
        FirstName: firstName,
        Email: email,
        Password: hashedPassword,
        Group: SKER_DEFAULT_USER_GROUP,
        Date: existing?.Date || now,
        EmailVerified: false,
      };

      if (existing) {
        await userCollection.updateOne({ Email: email }, { $set: profile });
      } else {
        await userCollection.insertOne(profile);
      }

      let emailSent = true;
      try {
        const code = await issueVerificationCode(userCollection, email);
        await sendVerificationEmail({ firstName, email, code });
      } catch (mailError) {
        emailSent = false;
        console.error('Verification email after register:', mailError);
      }

      return reply.status(201).send({
        status: 'success',
        needsVerification: true,
        emailSent,
        message: emailSent
          ? 'We sent a verification code to your email'
          : 'Account created but the verification email could not be sent. Use Resend.',
      });
    } catch (error) {
      console.error('Error during registration:', error);
      return reply.status(500).send({
        status: 'error',
        message: 'Error creating account',
      });
    }
  });

  // Confirm the 6-digit code sent at registration
  fastify.post('/register/verify', { config: { compress: false } }, async function (request, reply) {
    const email = normalizeEmail(request.body?.email);
    const code = String(request.body?.code ?? request.body?.verificationCode ?? '').trim();

    if (!email || !code) {
      return reply.status(400).send({
        status: 'error',
        message: 'Email and verification code are required',
      });
    }
    if (!/^\d{6}$/.test(code)) {
      return reply.status(400).send({
        status: 'error',
        message: 'The verification code must be 6 digits',
      });
    }

    const userCollection = fastify.mongo.db.collection('User');
    const user = await userCollection.findOne({ Email: email });
    if (!user) {
      return reply.status(404).send({
        status: 'error',
        message: 'No account found for this email',
      });
    }
    if (isEmailVerified(user)) {
      return reply.status(200).send({
        status: 'success',
        message: 'This account is already verified. You can sign in.',
      });
    }

    const attempts = Number(user.EmailVerifyAttempts) || 0;
    if (attempts >= EMAIL_VERIFY_MAX_ATTEMPTS) {
      return reply.status(429).send({
        status: 'error',
        needsVerification: true,
        message: 'Too many incorrect codes. Request a new verification code.',
      });
    }
    if (!user.EmailVerifyExpires || Date.now() > user.EmailVerifyExpires) {
      return reply.status(400).send({
        status: 'error',
        needsVerification: true,
        message: 'This verification code has expired. Request a new one.',
      });
    }
    if (!verificationCodeMatches(user.EmailVerifyCodeHash, code)) {
      await userCollection.updateOne(
        { Email: email },
        { $inc: { EmailVerifyAttempts: 1 } }
      );
      const remaining = EMAIL_VERIFY_MAX_ATTEMPTS - attempts - 1;
      return reply.status(400).send({
        status: 'error',
        needsVerification: true,
        message:
          remaining > 0
            ? `Invalid verification code. ${remaining} attempt(s) remaining.`
            : 'Too many incorrect codes. Request a new verification code.',
      });
    }

    await userCollection.updateOne(
      { Email: email },
      {
        $set: { EmailVerified: true },
        $unset: {
          EmailVerifyCodeHash: '',
          EmailVerifyExpires: '',
          EmailVerifyAttempts: '',
          EmailVerifySentAt: '',
        },
      }
    );

    try {
      await ensureUserHomeDirectory(fastify.mongo.db, {
        email,
        group: user.Group || SKER_DEFAULT_USER_GROUP,
      });
    } catch (homeError) {
      console.error('ensureUserHomeDirectory after email verify:', homeError);
      return reply.status(500).send({
        status: 'error',
        message: 'Email verified but home directory could not be initialized',
      });
    }

    return reply.send({
      status: 'success',
      message: 'Email verified. You can sign in now.',
    });
  });

  // Resend a new verification code
  fastify.post('/register/resend', { config: { compress: false } }, async function (request, reply) {
    const email = normalizeEmail(request.body?.email);
    if (!email) {
      return reply.status(400).send({
        status: 'error',
        message: 'Email is required',
      });
    }

    const userCollection = fastify.mongo.db.collection('User');
    const user = await userCollection.findOne({ Email: email });
    if (!user || isEmailVerified(user)) {
      return reply.send({
        status: 'success',
        message: 'If an unverified account exists, a new code has been sent.',
      });
    }

    const now = Date.now();
    if (user.EmailVerifySentAt && now - user.EmailVerifySentAt < EMAIL_RESEND_MIN_MS) {
      const retryAfterSeconds = Math.ceil(
        (EMAIL_RESEND_MIN_MS - (now - user.EmailVerifySentAt)) / 1000
      );
      reply.header('Retry-After', String(retryAfterSeconds));
      return reply.status(429).send({
        status: 'error',
        needsVerification: true,
        retryAfterSeconds,
        message: `Please wait ${retryAfterSeconds} s before requesting a new code`,
      });
    }

    try {
      const code = await issueVerificationCode(userCollection, email);
      await sendVerificationEmail({
        firstName: user.FirstName,
        email,
        code,
      });
    } catch (mailError) {
      console.error('Verification email resend:', mailError);
      return reply.status(500).send({
        status: 'error',
        message: 'Could not send the verification email',
      });
    }

    return reply.send({
      status: 'success',
      needsVerification: true,
      emailSent: true,
      message: 'We sent a new verification code to your email',
    });
  });

  // Route to create a new user with hashed password
  fastify.post('/users/create', async function(request, reply) {
    try {
      const { Email, Password } = request.body;
      
      // Hash the password before storing
      const hashedPassword = await hashPassword(Password);
      
      const wCollection = fastify.mongo.db.collection('User');
      const result = await wCollection.insertOne({
        Email,
        Password: hashedPassword,
        EmailVerified: true,
      });

      return { status: 'success', message: 'User created successfully' };
    } catch (error) {
      console.error('Error creating user:', error);
      return reply.status(500).send({ status: 'error', message: 'Error creating user' });
    }
  });

  // Login route
  fastify.post('/login', { config: { compress: false } }, async function(request, reply)  {
    const email = normalizeEmail(request.body?.email);
    const password = request.body?.password;

    if (!email || typeof password !== 'string') {
      return reply.status(400).send({
        status: 'error',
        message: 'Email and password are required',
      });
    }

    const lock = getLoginLock(email);
    if (lock.locked) {
      reply.header('Retry-After', String(lock.retryAfterSeconds));
      return reply.status(429).send({
        status: 'error',
        message: `Too many failed login attempts. Try again in ${formatLockoutWait(lock.remainingMs)}.`,
        retryAfterSeconds: lock.retryAfterSeconds,
      });
    }

    const verification = await verifyPassword(email, password);

    if (!verification.isValid) {
      const state = recordFailedLogin(email);
      if (state.lockedUntil && state.lockedUntil > Date.now()) {
        const remainingMs = state.lockedUntil - Date.now();
        const retryAfterSeconds = Math.ceil(remainingMs / 1000);
        reply.header('Retry-After', String(retryAfterSeconds));
        return reply.status(429).send({
          status: 'error',
          message: 'Too many failed login attempts. Please wait 5 minutes before trying again.',
          retryAfterSeconds,
        });
      }
      return reply.status(401).send({
        status: 'error',
        message: verification.message,
      });
    }

    if (!isEmailVerified(verification.user)) {
      return reply.status(403).send({
        status: 'error',
        needsVerification: true,
        message: 'Enter the verification code sent to your email to activate your account',
      });
    }

    clearLoginAttempts(email);

    // Generate JWT token with user information
    // Email unique identifier
    const wToken = jwt.sign({ 
      userEmail: verification.user.Email,
      userId: verification.user._id,
      group: verification.user.Group
    }, JWT_SECRET, JWT_OPTIONS);
    
    console.log("Generated token:", wToken);

    const { Password, PassWord, EmailVerifyCodeHash, EmailVerifyExpires, EmailVerifyAttempts, EmailVerifySentAt, ...safeUser } = verification.user
    reply.send({ status: 'success', message: 'Login successful', token: wToken, user: safeUser });
  });

  // Route to verify token
  fastify.get('/protected', (request, reply) => {
    const authHeader = request.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
  
    if (!token) {
      return reply.status(401).send({ status: 'error', message: 'Authorization token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return reply.status(403).send({ status: 'error', message: 'Invalid token' });
      }
      
      // If token is valid, provide access
      reply.send({ status: 'success', message: 'Protected data', user });
    });
  });

} // End of SkLogin