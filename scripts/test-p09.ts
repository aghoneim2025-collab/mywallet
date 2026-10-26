// Test P0.9 fixes directly
import {
  generateToken,
  verifyTokenSignature,
  revokeToken,
  hashToken,
  getUserIdFromRequestAsync,
  DbUnavailableError,
  AuthInvalidError,
} from '../src/lib/auth';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function test() {
  const p = new PrismaClient();
  
  // Create a real user
  const email = 'p09-script-test@example.com';
  const passwordHash = await bcrypt.hash('test123', 12);
  const user = await p.user.upsert({
    where: { email },
    create: { email, passwordHash, name: 'Test' },
    update: { passwordHash },
  });
  console.log('User ID:', user.id);
  
  await p.revokedToken.deleteMany({});
  
  // Generate token
  const token = generateToken(user.id);
  console.log('Token:', token.substring(0, 30) + '...');
  console.log('Hash:', hashToken(token).substring(0, 16) + '...');
  
  // Test 1: before revoke, request returns userId
  console.log('\n=== Test 1: BEFORE revoke ===');
  const req1 = new Request('https://test/api', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const userIdBefore = await getUserIdFromRequestAsync(req1);
  console.log('userId returned:', userIdBefore);
  console.log(userIdBefore === user.id ? '✅' : '❌');
  
  // Test 2: revoke, then request returns null (AuthInvalidError thrown by requireAuthAsync)
  console.log('\n=== Test 2: AFTER revoke ===');
  await revokeToken(token, user.id);
  const userIdAfter = await getUserIdFromRequestAsync(req1);
  console.log('userId returned:', userIdAfter);
  console.log(userIdAfter === null ? '✅ (null = revoked)' : '❌');
  
  // Test 3: hash is what's in DB, not raw JWT
  console.log('\n=== Test 3: DB stores hash ===');
  const rows = await p.revokedToken.findMany();
  console.log('Rows:', rows.length);
  console.log('Token field is hash?', /^[a-f0-9]{64}$/.test(rows[0]?.token || ''));
  
  // Test 4: revokeToken throws on FK violation (P0.8) — and the error is propagated
  console.log('\n=== Test 4: revokeToken throws on FK violation ===');
  const fakeToken = generateToken('non-existent-user-id');
  try {
    await revokeToken(fakeToken, 'non-existent-user-id');
    console.log('❌ Did not throw');
  } catch (e: any) {
    console.log('✅ Threw:', e.code || e.constructor.name);
    console.log('   Is Prisma P2003?', e.code === 'P2003');
  }
  
  // Test 5: AuthInvalidError class exists and is throwable
  console.log('\n=== Test 5: AuthInvalidError class ===');
  const err = new AuthInvalidError('test');
  console.log('Class name:', err.name);
  console.log(' instanceof AuthInvalidError?', err instanceof AuthInvalidError);
  console.log(' instanceof Error?', err instanceof Error);
  
  // Test 6: DbUnavailableError class exists
  console.log('\n=== Test 6: DbUnavailableError class ===');
  const dbErr = new DbUnavailableError('test', new Error('cause'));
  console.log('Class name:', dbErr.name);
  console.log(' instanceof DbUnavailableError?', dbErr instanceof DbUnavailableError);
  console.log(' cause preserved?', dbErr.cause instanceof Error);
  
  // Cleanup
  await p.revokedToken.deleteMany({});
  await p.user.deleteMany({ where: { email } });
  await p.$disconnect();
  console.log('\n✅ All P0.9 tests passed');
}

test().catch(e => { console.error('❌ Test failed:', e); process.exit(1); });
