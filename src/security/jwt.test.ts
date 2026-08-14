import { describe, expect, it } from 'vitest';
import {
  generatePasswordResetToken,
  hashPasswordResetToken,
} from './jwt.js';

describe('password reset token utilities', () => {
  it('creates opaque 256-bit tokens and deterministic digests', () => {
    const first = generatePasswordResetToken();
    const second = generatePasswordResetToken();

    expect(first).toHaveLength(64);
    expect(second).toHaveLength(64);
    expect(first).not.toBe(second);
    expect(hashPasswordResetToken(first)).toHaveLength(64);
    expect(hashPasswordResetToken(first)).toBe(hashPasswordResetToken(first));
    expect(hashPasswordResetToken(first)).not.toBe(first);
  });
});
