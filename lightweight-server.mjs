import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STANDALONE_DIR = join(__dirname, '.next', 'standalone');
const STATIC_DIR = join(__dirname, '.next', 'static');
const PUBLIC_DIR = join(__dirname, 'public');
const DB_PATH = 'file:/home/z/my-project/db/custom.db';

const INDEX_HTML = readFileSync(join(STANDALONE_DIR, '.next', 'server', 'app', 'index.html'), 'utf-8');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// Route to Prisma query mapping
const ROUTE_MAP = {
  '/api/crm/leads': 'prisma.lead.findMany({orderBy:{createdAt:"desc"},include:{owner:{select:{id:true,firstName:true,lastName:true,email:true}}}})',
  '/api/crm/contacts': 'prisma.contact.findMany({orderBy:{createdAt:"desc"}})',
  '/api/crm/companies': 'prisma.company.findMany({orderBy:{createdAt:"desc"}})',
  '/api/crm/deals': 'prisma.deal.findMany({orderBy:{createdAt:"desc"},include:{owner:{select:{id:true,firstName:true,lastName:true,email:true}}}})',
  '/api/projects/projects': 'prisma.project.findMany({orderBy:{createdAt:"desc"},include:{owner:{select:{id:true,firstName:true,lastName:true}}},include:{tasks:{orderBy:{sortOrder:"asc"}}}})',
  '/api/projects/tasks': 'prisma.projectTask.findMany({orderBy:{sortOrder:"asc"},include:{assignee:{select:{id:true,firstName:true,lastName:true}}}})',
  '/api/hr/employees': 'prisma.user.findMany({orderBy:{firstName:"asc"}})',
  '/api/hr/leave': 'prisma.leaveRequest.findMany({orderBy:{createdAt:"desc"},include:{requester:{select:{id:true,firstName:true,lastName:true}}}})',
  '/api/finance/invoices': 'prisma.invoice.findMany({orderBy:{createdAt:"desc"},include:{owner:{select:{id:true,firstName:true,lastName:true,email:true}}}})',
  '/api/finance/expenses': 'prisma.expense.findMany({orderBy:{createdAt:"desc"},include:{owner:{select:{id:true,firstName:true,lastName:true,email:true}}}})',
  '/api/inventory/products': 'prisma.product.findMany({orderBy:{name:"asc"}})',
  '/api/inventory/warehouses': 'prisma.warehouse.findMany({orderBy:{name:"asc"}})',
  '/api/calendar/events': 'prisma.calendarEvent.findMany({orderBy:{startDate:"asc"}})',
  '/api/communication/channels': 'prisma.channel.findMany({orderBy:{createdAt:"desc"},include:{_count:{select:{messages:true}}}})',
  '/api/communication/messages': 'prisma.message.findMany({take:50,orderBy:{createdAt:"desc"},include:{sender:{select:{id:true,firstName:true,lastName:true,avatar:true}}}})',
  '/api/support/tickets': 'prisma.supportTicket.findMany({orderBy:{createdAt:"desc"},include:{assignee:{select:{id:true,firstName:true,lastName:true}}}})',
  '/api/workspace/pages': 'prisma.workspacePage.findMany({orderBy:{updatedAt:"desc"}})',
  '/api/admin/users': 'prisma.user.findMany({orderBy:{firstName:"asc"},include:{role:true}})',
  '/api/admin/roles': 'prisma.role.findMany({orderBy:{name:"asc"},include:{_count:{select:{users:true}}}})',
  '/api/admin/audit-log': 'prisma.auditLog.findMany({take:100,orderBy:{createdAt:"desc"}},include:{user:{select:{id:true,firstName:true,lastName:true}}})',
  '/api/admin/notifications': 'prisma.notification.findMany({take:50,orderBy:{createdAt:"desc"}})',
  '/api/admin/settings': 'prisma.setting.findMany({orderBy:{group:"asc",key:"asc"}})',
  '/api/dashboard': 'DASHBOARD_SCRIPT',
  '/api/activity-log': 'prisma.activityLog.findMany({take:50,orderBy:{createdAt:"desc"},include:{user:{select:{id:true,firstName:true,lastName:true}}}})',
  '/api/search': 'prisma.lead.findMany({take:5})',
  '/api/export': '{}',
};

// Dynamic [id] route patterns
const DYNAMIC_PATTERNS = [
  { regex: /^\/api\/crm\/leads\/([^/]+)$/, model: 'lead' },
  { regex: /^\/api\/crm\/contacts\/([^/]+)$/, model: 'contact' },
  { regex: /^\/api\/crm\/companies\/([^/]+)$/, model: 'company' },
  { regex: /^\/api\/crm\/deals\/([^/]+)$/, model: 'deal' },
  { regex: /^\/api\/projects\/projects\/([^/]+)$/, model: 'project' },
  { regex: /^\/api\/projects\/tasks\/([^/]+)$/, model: 'projectTask' },
  { regex: /^\/api\/hr\/employees\/([^/]+)$/, model: 'user' },
  { regex: /^\/api\/hr\/leave\/([^/]+)$/, model: 'leaveRequest' },
  { regex: /^\/api\/finance\/invoices\/([^/]+)$/, model: 'invoice' },
  { regex: /^\/api\/finance\/expenses\/([^/]+)$/, model: 'expense' },
  { regex: /^\/api\/inventory\/products\/([^/]+)$/, model: 'product' },
  { regex: /^\/api\/inventory\/warehouses\/([^/]+)$/, model: 'warehouse' },
  { regex: /^\/api\/calendar\/events\/([^/]+)$/, model: 'calendarEvent' },
  { regex: /^\/api\/communication\/channels\/([^/]+)$/, model: 'channel' },
  { regex: /^\/api\/communication\/messages\/([^/]+)$/, model: 'message' },
  { regex: /^\/api\/support\/tickets\/([^/]+)$/, model: 'supportTicket' },
  { regex: /^\/api\/workspace\/pages\/([^/]+)$/, model: 'workspacePage' },
  { regex: /^\/api\/admin\/users\/([^/]+)$/, model: 'user' },
  { regex: /^\/api\/admin\/roles\/([^/]+)$/, model: 'role' },
  { regex: /^\/api\/admin\/notifications\/([^/]+)$/, model: 'notification' },
];

function runQuery(scriptPath, callback) {
  exec(`node "${scriptPath}"`, { timeout: 12000, encoding: 'utf-8', env: { ...process.env } }, (err, stdout, stderr) => {
    const output = stdout || stderr || '{"error":"query failed"}';
    const lastLine = output.trim().split('\n').pop();
    try {
      JSON.parse(lastLine); // validate
      callback(null, lastLine);
    } catch {
      callback(null, output);
    }
  });
}

function runPrismaQuery(queryStr, callback) {
  const script = `
const { PrismaClient } = require('${STANDALONE_DIR}/node_modules/@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: '${DB_PATH}' } } });
(async () => {
  try {
    const result = await ${queryStr};
    const total = Array.isArray(result) ? result.length : 1;
    const data = Array.isArray(result) ? result : [result];
    console.log(JSON.stringify({ data, meta: { total, page: 1, pageSize: 20, totalPages: 1 } }));
  } catch(e) {
    console.error(JSON.stringify({ error: e.message }));
  }
  await prisma.$disconnect();
})();
`;
  const tmpFile = join(__dirname, '.tmp-api', `q_${Date.now()}.cjs`);
  mkdirSync(dirname(tmpFile), { recursive: true });
  writeFileSync(tmpFile, script);
  runQuery(tmpFile, callback);
}

function runPrismaById(model, id, callback) {
  // Sanitize id to prevent injection
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    return callback(null, '{"error":"Invalid ID"}');
  }
  const script = `
const { PrismaClient } = require('${STANDALONE_DIR}/node_modules/@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: '${DB_PATH}' } } });
(async () => {
  try {
    const result = await prisma.${model}.findUnique({ where: { id: '${id}' } });
    console.log(JSON.stringify(result || { error: 'Not found' }));
  } catch(e) { console.error(JSON.stringify({ error: e.message })); }
  await prisma.$disconnect();
})();
`;
  const tmpFile = join(__dirname, '.tmp-api', `q_${Date.now()}.cjs`);
  mkdirSync(dirname(tmpFile), { recursive: true });
  writeFileSync(tmpFile, script);
  runQuery(tmpFile, callback);
}

function handleApi(method, urlPath, res) {
  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Method not allowed (read-only preview)' }));
    return;
  }

  const sendJson = (body) => {
    try { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body); }
    catch { /* response already sent */ }
  };

  // Exact route match
  if (ROUTE_MAP[urlPath]) {
    if (ROUTE_MAP[urlPath] === 'DASHBOARD_SCRIPT') {
      const dashScript = join(__dirname, '.tmp-api', 'dashboard-query.cjs');
      return runQuery(dashScript, (_, body) => sendJson(body));
    }
    return runPrismaQuery(ROUTE_MAP[urlPath], (_, body) => sendJson(body));
  }

  // Dynamic [id] routes
  for (const pattern of DYNAMIC_PATTERNS) {
    const match = urlPath.match(pattern.regex);
    if (match) {
      return runPrismaById(pattern.model, match[1], (_, body) => sendJson(body));
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'Route not found' }));
}

function serveStaticFile(res, filePath, contentType, cacheControl) {
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl || 'public, max-age=31536000, immutable'
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer((req, res) => {
  let urlPath;
  try {
    urlPath = new URL(req.url, 'http://localhost').pathname;
  } catch {
    urlPath = req.url.split('?')[0];
  }

  // API routes
  if (urlPath.startsWith('/api/')) {
    handleApi(req.method, urlPath, res);
    return;
  }

  // _next/static/
  if (urlPath.startsWith('/_next/static/')) {
    const relativePath = urlPath.replace('/_next/static/', '');
    const filePath = join(STATIC_DIR, relativePath);
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    return serveStaticFile(res, filePath, MIME[ext] || 'application/octet-stream');
  }

  // Block access to dotfiles and sensitive paths
  if (urlPath.includes('/.') || urlPath.includes('..')) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  // Public files
  if (urlPath !== '/' && urlPath.includes('.')) {
    const publicPath = join(PUBLIC_DIR, urlPath);
    try {
      if (existsSync(publicPath) && require('fs').statSync(publicPath).isFile()) {
        const ext = publicPath.substring(publicPath.lastIndexOf('.'));
        return serveStaticFile(res, publicPath, MIME[ext] || 'application/octet-stream', 'no-cache');
      }
    } catch {}
  }

  // SPA fallback
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(INDEX_HTML);
});

const PORT = 3000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    setTimeout(() => { server.close(); server.listen(PORT, '0.0.0.0'); }, 1000);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`NexusCorp on :${PORT} (${Math.round(process.memoryUsage().rss/1024/1024)}MB)`);
});