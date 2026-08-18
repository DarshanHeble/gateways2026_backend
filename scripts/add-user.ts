import { getWriterDb } from '../src/db/index.js';
import { users } from '../src/db/schema/auth.js';
import bcrypt from 'bcryptjs';

async function main() {
  const db = getWriterDb();
  const passwordHash = await bcrypt.hash('password123', 10);
  
  await db.insert(users).values({
    id: 'user-darshan',
    email: 'darshanheble@gmail.com',
    passwordHash,
    status: 'ACTIVE',
    emailVerified: new Date(),
  }).onDuplicateKeyUpdate({
    set: { passwordHash }
  });
  
  console.log('User created! email: darshanheble@gmail.com, password: password123');
  process.exit(0);
}

main();
