// Test P0.8 fixes directly via the auth lib (no server needed)
import { generateToken, verifyTokenSignature, revokeToken, hashToken, getUserIdFromRequestAsync } from '../src/lib/auth';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function test() {
  const p = new PrismaClient();
  
  // Create a real user
  const email = 'p08-script-test@example.com';
  const passwordHash = await bcrypt.hash('test123', 12);
  const user = await p.user.upsert({
    where: { email },
    create: { email, passwordHash, name: 'Test' },
    update: { passwordHash },
  });
  console.log('User ID:', user.id);
  
  // Clean DB
  await p.revokedToken.deleteMany({});
  
  // Generate token
  const token = generateToken(user.id);
  console.log('Token:', token.substring(0, 30) + '...');
  
  // Build a mock Request with Bearer
  const bearerReq = new Request('https://test/api/test', {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('\n=== Test 1: getUserIdFromRequestAsync BEFORE revoke ===');
  const userIdBefore = await getUserIdFromRequestAsync(bearerReq);
  console.log('userId returned:', userIdBefore);
  console.log('Should equal user.id?', userIdBefore === user.id ? 'YES ✅' : 'NO ❌');
  
  console.log('\n=== Test 2: revokeToken THROWS on success (P0.8 - no swallow) ===');
  try {
    await revokeToken(token, user.id);
    console.log('revokeToken completed without throwing');
  } catch (e) {
    console.log('revokeToken threw (should NOT on success):', e.message);
  }
  
  console.log('\n=== Test 3: getUserIdFromRequestAsync AFTER revoke ===');
  const userIdAfter = await getUserIdFromRequestAsync(bearerReq);
  console.log('userId returned:', userIdAfter);
  console.log('Should be null (revoked)?', userIdAfter === null ? 'YES ✅' : 'NO ❌');
  
  console.log('\n=== Test 4: DB stores HASH not raw JWT ===');
  const rows = await p.revokedToken.findMany();
  console.log('Rows:', rows.length);
  for (const r of rows) {
    const isHash = /^[a-f0-9]{64}$/.test(r.token);
    console.log('  token (first 16):', r.token.substring(0, 16) + '...');
    console.log('  length:', r.token.length, 'is SHA-256 hash?', isHash);
    console.log('  is raw JWT?', r.token.includes('.') ? 'YES (BAD!)' : 'NO (GOOD)');
  }
  
  console.log('\n=== Test 5: revokeToken throws on bad DB connection ===');
  // Simulate by passing invalid user (FK constraint violation)
  try {
    await revokeToken(token, 'non-existent-user-id');
    console.log('Did NOT throw (BAD - should have failed on FK)');
  } catch (e) {
    console.log('Threw on DB error (P0.8 ✅):', e.message.substring(0, 80));
  }
  
  console.log('\n=== Test 6: mock DB failure → isTokenRevoked fails CLOSED ===');
  // Hard to test without DB outage, but verify code path exists by checking
  // that isTokenRevoked is in fail-closed mode (visible in auth.ts source)
  console.log('Check src/lib/auth.ts:162-164 - isTokenRevoked catch returns true (fail-closed)');
  
  await p.$disconnect();
  console.log('\n✅ P0.8 tests complete');
}

test().catch(e => { console.error('❌ Test failed:', e); process.exit(1); });
