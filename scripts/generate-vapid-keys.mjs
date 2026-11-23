// Generates a VAPID key pair for Web Push using only Node's built-in crypto. No install needed.
//   node scripts/generate-vapid-keys.mjs
// PUBLIC key  → js/config.js (vapidPublicKey) and the VAPID_PUBLIC_KEY secret
// PRIVATE key → ONLY the VAPID_PRIVATE_KEY Supabase secret. Never commit it, never put it in the app.
import { generateKeyPairSync } from 'node:crypto';
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' }), prv = privateKey.export({ format: 'jwk' });
const b64u = (b) => Buffer.from(b).toString('base64url');
const publicRaw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
console.log('VAPID_PUBLIC_KEY=' + b64u(publicRaw));
console.log('VAPID_PRIVATE_KEY=' + prv.d);
console.log('\nKeep the private key secret. Store it with: supabase secrets set VAPID_PRIVATE_KEY=...');
