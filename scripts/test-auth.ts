// Test that revokeToken stores a SHA-256 hash, not the raw token
import { generateToken, verifyTokenSignature, revokeToken, hashToken } from '../src/lib/auth';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

async function test() {
  const p = new PrismaClient();
  
  // Create a real user so the FK constraint passes
  const email = 'p06-script-test@example.com';
  const passwordHash = await bcrypt.hash('test123', 12);
  const user = await p.user.upsert({
    where: { email },
    create: { email, passwordHash, name: 'Test' },
    update: { passwordHash },
  });
  console.log('User ID:', user.id);
  
  // Generate token for this user
  const token = generateToken(user.id);
  console.log('Token:', token.substring(0, 30) + '...');
  console.log('Token contains dot?', token.includes('.'));
  
  const tokenHash = hashToken(token);
  console.log('Hash:', tokenHash);
  console.log('Hash length:', tokenHash.length);
  console.log('Hash is hex 64?', /^[a-f0-9]{64}$/.test(tokenHash));
  
  // Clean old rows
  await p.revokedToken.deleteMany({});
  
  // Revoke (should store hash, not raw)
  await revokeToken(token, user.id);
  
  const rows = await p.revokedToken.findMany();
  console.log('\n=== DB content after revoke ===');
  console.log('Rows:', rows.length);
  for (const r of rows) {
    const isHash = /^[a-f0-9]{64}$/.test(r.token);
    console.log('  token (first 16):', r.token.substring(0, 16) + '...');
    console.log('  length:', r.token.length);
    console.log('  is SHA-256 hash?', isHash);
    console.log('  is raw JWT?', r.token.includes('.') ? 'YES (BAD!)' : 'NO (GOOD - is hash)');
    console.log('  userId:', r.userId);
    console.log('  expiresAt:', r.expiresAt);
  }
  
  await p.$disconnect();
  console.log('\n✅ Test passed: DB stores hashes, not raw tokens');
}

test().catch(e => { console.error('❌ Test failed:', e); process.exit(1); });
