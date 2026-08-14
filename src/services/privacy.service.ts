import { eq } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../db/schema/index.js';
import { accounts, sessions, users, verificationTokens } from '../db/schema/auth.js';
import { characters } from '../db/schema/characters.js';
import { consoleHandoffs } from '../db/schema/console.js';
import { userRoles, profiles } from '../db/schema/identity.js';
import { paymentReceipts } from '../db/schema/payments.js';
import { createDataError } from '../errors/DataError.js';
import { insertAuditLogEntry } from '../repositories/audit-log.repository.js';
import { withDeadlockRetry, withTransaction } from '../db/transaction.js';
import { cloudinaryStorage } from '../storage/cloudinary.storage.js';

type Db = MySql2Database<typeof schema>;

const STAFF_ROLES = new Set(['ADMIN', 'ORGANIZER', 'SCANNER']);
const ERASED_EMAIL_PREFIX = 'erased-';
const ERASED_RECEIPT_PREFIX = 'erased-';

export interface EraseParticipantResult {
  alreadyErased: boolean;
  receiptCount: number;
}

function erasedParticipantCode(userId: string): string {
  return `ERASED-${userId.replaceAll('-', '').slice(0, 8).toUpperCase()}`;
}

function erasedCharacterName(userId: string): string {
  return `erased_${userId.replaceAll('-', '').slice(0, 8)}`;
}

/**
 * Permanently removes personal identifiers while keeping the rows required to
 * preserve the festival's financial, registration, capacity, and audit trail.
 *
 * This intentionally runs behind the ADMIN-only route. The user row remains as
 * a stable pseudonymous subject because registrations, teams, payment receipts,
 * and XP/attendance history reference it. All active credentials are revoked.
 * Receipt files are deleted before the database redaction is committed; if
 * storage deletion fails, the transaction is aborted so an admin can retry.
 */
export async function eraseParticipantPersonalData(
  db: Db,
  params: {
    participantId: string;
    actorUserId: string;
    reason?: string | null;
    correlationId?: string | null;
  },
): Promise<EraseParticipantResult> {
  const reason = params.reason?.trim() || 'Verified participant erasure request';

  return withDeadlockRetry(() =>
    withTransaction(db, async (tx) => {
      const userRows = await tx
        .select({ id: users.id, email: users.email, status: users.status })
        .from(users)
        .where(eq(users.id, params.participantId))
        .for('update')
        .limit(1);
      const user = userRows[0];
      if (!user) throw createDataError('NOT_FOUND', 'Participant not found.');

      const roles = await tx
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, params.participantId));
      if (roles.some(({ role }) => STAFF_ROLES.has(role))) {
        throw createDataError('FORBIDDEN', 'Staff accounts must be removed through staff management.');
      }

      const profileRows = await tx
        .select()
        .from(profiles)
        .where(eq(profiles.userId, params.participantId))
        .for('update')
        .limit(1);
      const profile = profileRows[0] ?? null;

      const receiptRows = await tx
        .select()
        .from(paymentReceipts)
        .where(eq(paymentReceipts.userId, params.participantId))
        .for('update');

      const alreadyErased =
        user.email.startsWith(ERASED_EMAIL_PREFIX) &&
        user.status === 'INACTIVE' &&
        profile?.fullName === '[erased]';
      if (alreadyErased) {
        return { alreadyErased: true, receiptCount: receiptRows.length };
      }

      // A receipt PDF can contain names, account numbers, and other personal
      // information. Do this before committing the database redaction.
      for (const receipt of receiptRows) {
        if (!receipt.cloudinaryPublicId.startsWith(ERASED_RECEIPT_PREFIX)) {
          await cloudinaryStorage.deleteFile(receipt.cloudinaryPublicId);
        }
      }

      const newEmail = `${ERASED_EMAIL_PREFIX}${params.participantId}@erased.invalid`;
      await tx
        .update(users)
        .set({
          email: newEmail,
          passwordHash: null,
          status: 'INACTIVE',
          emailVerified: null,
          mustChangePassword: false,
        })
        .where(eq(users.id, params.participantId));

      if (profile) {
        await tx
          .update(profiles)
          .set({
            participantCode: erasedParticipantCode(params.participantId),
            fullName: '[erased]',
            phone: null,
            collegeId: null,
            departmentId: null,
            yearOfStudy: null,
            gender: null,
            dateOfBirth: null,
            category: null,
            tshirtSize: null,
            emergencyName: null,
            emergencyPhone: null,
            dietaryPref: null,
            bio: null,
            avatarUrl: null,
            isBanned: false,
          })
          .where(eq(profiles.userId, params.participantId));
      }

      await tx
        .update(characters)
        .set({
          playerName: erasedCharacterName(params.participantId),
          avatarAssetId: null,
          collegeId: null,
          departmentId: null,
          yearOfStudy: null,
          bio: null,
        })
        .where(eq(characters.userId, params.participantId));

      for (const receipt of receiptRows) {
        await tx
          .update(paymentReceipts)
          .set({
            cloudinaryPublicId: `${ERASED_RECEIPT_PREFIX}${receipt.id}`,
            fileUrl: 'about:blank',
            fileName: 'erased-receipt',
            fileSizeBytes: 0,
            transactionReference: null,
            rejectionReason: null,
          })
          .where(eq(paymentReceipts.id, receipt.id));
      }

      // Remove every credential or pending handoff that could re-enter the
      // account. Historical registrations and audit rows remain intact.
      await tx.delete(accounts).where(eq(accounts.userId, params.participantId));
      await tx.delete(sessions).where(eq(sessions.userId, params.participantId));
      await tx
        .delete(verificationTokens)
        .where(eq(verificationTokens.identifier, user.email));
      await tx.delete(consoleHandoffs).where(eq(consoleHandoffs.userId, params.participantId));
      await tx.delete(userRoles).where(eq(userRoles.userId, params.participantId));

      await insertAuditLogEntry(tx, {
        actorUserId: params.actorUserId,
        action: 'participant_personal_data_erased',
        targetType: 'participant',
        targetId: params.participantId,
        correlationId: params.correlationId ?? null,
        metadata: {
          reason,
          redactionVersion: 1,
          receiptCount: receiptRows.length,
          preserved: ['registrations', 'teams', 'payment status and amount', 'audit trail'],
        },
      });

      return { alreadyErased: false, receiptCount: receiptRows.length };
    }),
  );
}
