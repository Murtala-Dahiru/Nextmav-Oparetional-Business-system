import assert from 'node:assert/strict';
import { connect, readEnv } from './db-connect.mjs';

const { client } = await connect(readEnv('DIRECT_URL') || readEnv('DATABASE_URL'));
try {
  assert.equal(client.connection.stream.authorized, true);
  assert.equal((await client.query('select 1 as value')).rows[0].value, 1);
  console.log('PASS database connection validates the certificate and hostname before query');
} finally {
  await client.end();
}
