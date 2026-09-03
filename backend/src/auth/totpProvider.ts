import crypto from 'node:crypto';
import type { AuthProvider, AuthResult, AuthUser, TotpAuthParams, UserRole, AuthConfig } from './types.ts';
import { signJwt, verifyJwt } from './jwt.ts';

interface StoredUserRecord {
  id: string;
  username: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  totpSecret: string;
  failedAttempts: number;
  lockedUntil: number | null;
}

export class TotpProvider implements AuthProvider {
  readonly providerType = 'totp' as const;
  private config: AuthConfig;
  private users: Map<string, StoredUserRecord> = new Map();

  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000;

  constructor(config: AuthConfig) {
    this.config = config;
    this.seedDefaultUsers();
  }

  public static generateTotp(secret: string, timestampMs: number = Date.now(), stepSeconds: number = 30): string {
    const epoch = Math.floor(timestampMs / 1000);
    const counter = Math.floor(epoch / stepSeconds);

    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));

    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex'));
    hmac.update(buf);
    const digest = hmac.digest();

    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  }

  public static verifyTotp(secret: string, code: string, timestampMs: number = Date.now()): boolean {
    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) return false;

    const stepSeconds = 30;
    const window = 1;

    for (let i = -window; i <= window; i++) {
      const checkTime = timestampMs + i * stepSeconds * 1000;
      const expectedCode = TotpProvider.generateTotp(secret, checkTime, stepSeconds);
      if (crypto.timingSafeEqual(Buffer.from(code), Buffer.from(expectedCode))) {
        return true;
      }
    }
    return false;
  }

  public static hashPassword(password: string, salt: string = crypto.randomBytes(16).toString('hex')): string {
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt}$${derivedKey.toString('hex')}`;
  }

  public static verifyPassword(password: string, storedHash: string): boolean {
    try {
      const [algo, salt, hash] = storedHash.split('$');
      if (algo !== 'scrypt' || !salt || !hash) return false;
      const derivedKey = crypto.scryptSync(password, salt, 64);
      const keyBuffer = Buffer.from(hash, 'hex');
      return crypto.timingSafeEqual(derivedKey, keyBuffer);
    } catch {
      return false;
    }
  }

  public async authenticate(params: TotpAuthParams): Promise<AuthResult> {
    const { username, passwordHash: passwordInput, totpCode } = params;
    const normUsername = (username || '').trim().toLowerCase();

    const userRecord = this.users.get(normUsername);
    const now = Date.now();

    if (!userRecord) {
      return {
        success: false,
        error: 'Invalid username or password.',
        errorCode: 'INVALID_CREDENTIALS',
      };
    }

    if (userRecord.lockedUntil && userRecord.lockedUntil > now) {
      const remainingMin = Math.ceil((userRecord.lockedUntil - now) / 60000);
      return {
        success: false,
        error: `Account is temporarily locked due to excessive failed attempts. Try again in ${remainingMin} minute(s).`,
        errorCode: 'ACCOUNT_LOCKED',
      };
    }

    const passwordValid = TotpProvider.verifyPassword(passwordInput, userRecord.passwordHash);
    if (!passwordValid) {
      this.recordFailedAttempt(userRecord);
      return {
        success: false,
        error: 'Invalid username or password.',
        errorCode: 'INVALID_CREDENTIALS',
      };
    }

    const totpValid = TotpProvider.verifyTotp(userRecord.totpSecret, totpCode);
    if (!totpValid) {
      this.recordFailedAttempt(userRecord);
      return {
        success: false,
        error: 'Invalid 2FA TOTP authentication code.',
        errorCode: 'MFA_REQUIRED',
      };
    }

    userRecord.failedAttempts = 0;
    userRecord.lockedUntil = null;

    const issuedAt = Math.floor(now / 1000);
    const user: AuthUser = {
      id: userRecord.id,
      email: userRecord.email,
      name: userRecord.name,
      role: userRecord.role,
      mfaVerified: true,
      provider: 'totp',
      issuedAt,
      expiresAt: issuedAt + this.config.accessTokenTtlSeconds,
    };

    const accessToken = signJwt(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mfaVerified: true,
        provider: 'totp',
        type: 'access',
      },
      this.config.jwtSecret,
      this.config.accessTokenTtlSeconds
    );

    const refreshToken = signJwt(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mfaVerified: true,
        provider: 'totp',
        type: 'refresh',
      },
      this.config.jwtSecret,
      this.config.refreshTokenTtlSeconds
    );

    return {
      success: true,
      user,
      accessToken,
      refreshToken,
    };
  }

  public async verifyToken(token: string): Promise<AuthUser | null> {
    const payload = verifyJwt(token, this.config.jwtSecret);
    if (!payload || payload.type !== 'access' || payload.provider !== 'totp' || !payload.mfaVerified) {
      return null;
    }

    return {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role as UserRole,
      mfaVerified: payload.mfaVerified,
      provider: 'totp',
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  }

  public async refreshToken(refreshToken: string): Promise<AuthResult> {
    const payload = verifyJwt(refreshToken, this.config.jwtSecret);
    if (!payload || payload.type !== 'refresh' || payload.provider !== 'totp' || !payload.mfaVerified) {
      return {
        success: false,
        error: 'Invalid or expired refresh token.',
        errorCode: 'TOKEN_EXPIRED',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const user: AuthUser = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role as UserRole,
      mfaVerified: true,
      provider: 'totp',
      issuedAt: now,
      expiresAt: now + this.config.accessTokenTtlSeconds,
    };

    const newAccessToken = signJwt(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mfaVerified: true,
        provider: 'totp',
        type: 'access',
      },
      this.config.jwtSecret,
      this.config.accessTokenTtlSeconds
    );

    return {
      success: true,
      user,
      accessToken: newAccessToken,
      refreshToken,
    };
  }

  private recordFailedAttempt(userRecord: StoredUserRecord): void {
    userRecord.failedAttempts++;
    if (userRecord.failedAttempts >= TotpProvider.MAX_FAILED_ATTEMPTS) {
      userRecord.lockedUntil = Date.now() + TotpProvider.LOCKOUT_DURATION_MS;
    }
  }

  public registerUser(user: {
    id: string;
    username: string;
    email: string;
    name: string;
    role: UserRole;
    passwordPlain: string;
    totpSecretHex: string;
  }): void {
    this.users.set(user.username.toLowerCase(), {
      id: user.id,
      username: user.username.toLowerCase(),
      email: user.email,
      name: user.name,
      role: user.role,
      passwordHash: TotpProvider.hashPassword(user.passwordPlain),
      totpSecret: user.totpSecretHex,
      failedAttempts: 0,
      lockedUntil: null,
    });
  }

  private seedDefaultUsers(): void {
    const defaultTotpSecret = '3132333435363738393031323334353637383930';

    this.registerUser({
      id: 'usr_adviser_1',
      username: 'adviser',
      email: 'adviser@caw.org.uk',
      name: 'CAW Staff Adviser',
      role: 'adviser',
      passwordPlain: 'AdviserPass2026!',
      totpSecretHex: defaultTotpSecret,
    });

    this.registerUser({
      id: 'usr_supervisor_1',
      username: 'supervisor',
      email: 'supervisor@caw.org.uk',
      name: 'CAW Lead Supervisor',
      role: 'supervisor',
      passwordPlain: 'SupervisorPass2026!',
      totpSecretHex: defaultTotpSecret,
    });

    this.registerUser({
      id: 'usr_admin_1',
      username: 'admin',
      email: 'admin@caw.org.uk',
      name: 'CAW System Administrator',
      role: 'administrator',
      passwordPlain: 'AdminPass2026!',
      totpSecretHex: defaultTotpSecret,
    });

    this.registerUser({
      id: 'usr_auditor_1',
      username: 'auditor',
      email: 'auditor@caw.org.uk',
      name: 'CAW Quality Auditor',
      role: 'auditor',
      passwordPlain: 'AuditorPass2026!',
      totpSecretHex: defaultTotpSecret,
    });
  }
}
