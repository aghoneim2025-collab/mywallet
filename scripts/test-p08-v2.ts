import { generateToken, revokeToken } from '../src/lib/auth';
import { PrismaClient } from '@prisma/client';

async function test() {
  const p = new PrismaClient();
  await p.revokedToken.deleteMany({});
  
  console.log('=== Test: revokeToken should THROW on FK violation ===');
  // Generate a token for a non-existent user
  const fakeToken = generateToken('non-existent-user-id');
  console.log('Token (for non-existent user):', fakeToken.substring(0, 30) + '...');
  
  try {
    await revokeToken(fakeToken, 'non-existent-user-id');
    console.log('❌ Did NOT throw on FK violation (BAD)');
  } catch (e: any) {
    console.log('✅ Threw on FK violation as expected:', e.code || e.message.substring(0, 80));
    if (e.code === 'P2003') console.log('   (Prisma P2003 = foreign key constraint violated)');
  }
  
  await p.$disconnect();
}

test().catch(e => { console.error('Test error:', e); process.exit(1); });
