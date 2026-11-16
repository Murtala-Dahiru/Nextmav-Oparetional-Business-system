import { existsSync } from 'node:fs';
import { connect } from './db-connect.mjs';
import { dispatchNotifications } from '../src/lib/notifications/dispatch';
if (existsSync('.env')) process.loadEnvFile('.env');
if (process.env.VAPID_ENV_FILE) process.loadEnvFile(process.env.VAPID_ENV_FILE);
const org = process.env.NOTIFICATION_DISPATCH_ORG;
if (org !== undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(org)) throw Error('Invalid notification dispatch organization');
const { client } = await connect(process.env.DIRECT_URL || process.env.DATABASE_URL, { statement_timeout: 15000 });
console.log(JSON.stringify(await dispatchNotifications(client, org)));
