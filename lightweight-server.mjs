import { createServer } from 'http';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = join(__dirname, '.next', 'static');
const PUBLIC_DIR = join(__dirname, 'public');

let INDEX_HTML;
try {
  INDEX_HTML = readFileSync(join(__dirname, '.next', 'standalone', '.next', 'server', 'app', 'index.html'), 'utf-8');
} catch {
  INDEX_HTML = '<html><body><h1>NexusCorp</h1><p>Loading...</p></body></html>';
}

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

/* -------------------------------------------------------------------------- */
/*  Embedded demo data — no child processes, zero extra memory                */
/* -------------------------------------------------------------------------- */
const U = (i, n) => ({ id: `usr-${String(i).padStart(3,'0')}`, firstName: n.split(' ')[0], lastName: n.split(' ')[1]||'', email: n.split(' ')[0].toLowerCase()+i+'@nexuscorp.io', avatar: null, jobTitle: ['Engineer','Designer','Manager','Sales Rep','HR Specialist','Accountant','Support Lead','Marketing Lead'][i%8], department: ['Engineering','Design','Sales','HR','Finance','Support','Marketing','Operations'][i%8] });
const users = Array.from({length:25}, (_,i) => U(i+1, ['Alex Morgan','Sarah Chen','James Wilson','Emily Rodriguez','Michael Kim','Lisa Wang','David Brown','Anna Kowalski','Robert Taylor','Maria Garcia','Chris Lee','Jennifer Park','Daniel Martinez','Sophie Turner','Andrew Scott','Rachel Green','Thomas Anderson','Natalie White','Kevin Patel','Laura Adams','Ryan Mitchell','Olivia Harris','Jason Clark','Megan Foster','Brian Cooper'][i]));

const leads = Array.from({length:18}, (_,i) => ({ id:`lead-${i+1}`, organizationId:'demo-org-001', firstName: ['John','Jane','Mike','Emily','David','Sarah','Chris','Laura','Tom','Amy','Ben','Diana','Fred','Grace','Henry','Ivy','Jack','Kate'][i], lastName: ['Smith','Doe','Johnson','Williams','Brown','Jones','Davis','Miller','Wilson','Moore','Taylor','Thomas','Jackson','White','Harris','Martin','Clark','Lewis'][i], email: `lead${i+1}@example.com`, phone: `+1-555-${String(1000+i).padStart(4,'0')}`, company: ['Acme Corp','TechStart','GlobalNet','DataFlow','CloudBase','NetWorth','InnoTech','WebScale','AppCraft','SoftEdge','DevHub','CodeBase','AI Labs','BlockChain','MetaVerse','CyberSec','Quantum Inc','RoboTech'][i], source: ['website','referral','linkedin','cold-call','conference'][i%5], status: ['new','contacted','qualified','proposal','negotiation','won','lost'][i%7], score: Math.floor(Math.random()*100), value: [5000,12000,25000,8000,15000,3000,45000,20000,7000,18000,9000,35000,6000,22000,11000,40000,14000,8000][i], notes: null, createdAt: new Date(Date.now()-i*86400000*3).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), owner: users[i%users.length] }));

const contacts = Array.from({length:15}, (_,i) => ({ id:`contact-${i+1}`, organizationId:'demo-org-001', firstName: ['Alice','Bob','Carol','Derek','Eva','Frank','Gina','Hank','Iris','Jake','Kim','Leo','Mona','Nick','Olga'][i], lastName: ['Wonder','Builder','Singer','Driver','Green','Miller','Baker','Smith','Jones','Taylor','Park','Lee','Scott','Brown','White'][i], email: `contact${i+1}@example.com`, phone: `+1-555-${String(2000+i).padStart(4,'0')}`, jobTitle: ['CEO','CTO','VP Sales','Director','Manager','Lead','Specialist','Analyst','Coordinator','Consultant','Partner','Founder','Executive','Advisor','Strategist'][i], company: leads[i]?.company||'Unknown', source: ['website','referral','linkedin','import'][i%4], isActive: i%7!==6, notes: null, createdAt: new Date(Date.now()-i*86400000*5).toISOString(), updatedAt: new Date(Date.now()-i*86400000*2).toISOString() }));

const companies = Array.from({length:12}, (_,i) => ({ id:`company-${i+1}`, organizationId:'demo-org-001', name: leads[i]?.company||`Company ${i+1}`, industry: ['Technology','Finance','Healthcare','Education','Retail','Manufacturing','Consulting','Media','Real Estate','Energy','Legal','Logistics'][i], website: `https://${leads[i]?.company?.toLowerCase().replace(/\s/g,'')||'company'}.com`, email: `info@${leads[i]?.company?.toLowerCase().replace(/\s/g,'')||'company'}.com`, phone: `+1-555-${String(3000+i).padStart(4,'0')}`, city: ['San Francisco','New York','London','Berlin','Tokyo','Sydney','Toronto','Paris','Singapore','Dubai','Hong Kong','Mumbai'][i], country: ['USA','USA','UK','Germany','Japan','Australia','Canada','France','Singapore','UAE','China','India'][i], employeeCount: [50,200,500,100,1000,300,75,150,400,600,250,80][i], annualRevenue: [5e6,25e6,100e6,10e6,500e6,30e6,8e6,20e6,80e6,200e6,15e6,4e6][i], notes: null, createdAt: new Date(Date.now()-i*86400000*7).toISOString(), updatedAt: new Date(Date.now()-i*86400000*3).toISOString() }));

const deals = Array.from({length:14}, (_,i) => ({ id:`deal-${i+1}`, organizationId:'demo-org-001', name: [`${companies[i]?.name||'Client'} Expansion`,`New Contract - ${contacts[i]?.firstName||'Contact'}`,`${companies[(i+1)%companies.length]?.name||'Firm'} Partnership`,`Q${(i%4)+1} Enterprise Deal`,`${companies[(i+2)%companies.length]?.name||'Corp'} License`,][i%4], contactName: `${contacts[i]?.firstName||'Contact'} ${contacts[i]?.lastName||''}`, companyName: companies[i]?.name||'Unknown', stage: ['lead','qualified','proposal','negotiation','contract','won','lost'][i%7], probability: [10,25,50,70,85,100,0][i%7], value: [15000,45000,80000,25000,120000,35000,60000,90000,20000,55000,75000,40000,100000,30000][i], closeDate: new Date(Date.now()+i*86400000*7).toISOString().split('T')[0], notes: null, createdAt: new Date(Date.now()-i*86400000*4).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), owner: users[i%users.length] }));

const projects = Array.from({length:10}, (_,i) => ({ id:`proj-${i+1}`, organizationId:'demo-org-001', name: ['Website Redesign','Mobile App v2','API Migration','Security Audit','Data Pipeline','CRM Integration','Analytics Dashboard','Cloud Migration','AI Chatbot','DevOps Automation'][i], description: ['Redesign corporate website with modern stack','Build cross-platform mobile application','Migrate legacy APIs to microservices','Comprehensive security assessment','Real-time data processing pipeline','Integrate CRM with internal tools','Build executive analytics dashboard','Migrate infrastructure to cloud','AI-powered customer support','Automate deployment pipeline'][i], status: ['planning','active','active','on-hold','completed','active','planning','active','completed','planning'][i], priority: ['high','high','medium','high','low','medium','low','high','medium','low'][i], budget: [50000,120000,80000,25000,65000,40000,30000,90000,75000,35000][i], startDate: new Date(Date.now()-i*86400000*14).toISOString().split('T')[0], endDate: new Date(Date.now()+i*86400000*7).toISOString().split('T')[0], createdAt: new Date(Date.now()-i*86400000*21).toISOString(), updatedAt: new Date(Date.now()-i*86400000*2).toISOString(), owner: users[i%users.length], project_tasks: { count: [12,24,18,6,30,15,8,22,20,10][i] } }));

const tasks = Array.from({length:20}, (_,i) => ({ id:`task-${i+1}`, organizationId:'demo-org-001', projectId: projects[i%projects.length].id, assigneeId: users[i%users.length].id, title: ['Set up project structure','Design wireframes','Implement auth module','Write unit tests','Database schema design','API endpoint development','UI component library','Performance optimization','Documentation','Code review','Deploy to staging','User acceptance testing','Fix navigation bug','Add dark mode','Implement search','Setup CI/CD','Write API docs','Integration testing','Security patches','Load testing'][i], description: null, status: ['todo','in-progress','in-progress','review','done','in-progress','todo','done','todo','in-progress','todo','in-progress','done','todo','in-progress','todo','todo','in-progress','done','todo'][i], priority: ['high','high','medium','low','medium','high','low','medium','low','high','medium','low','high','medium','high','low','medium','high','medium','low'][i], dueDate: new Date(Date.now()+i*86400000*2).toISOString().split('T')[0], estimatedHours: [8,16,12,4,24,6,10,8,3,2,1,8,2,6,12,4,3,8,2,4][i], loggedHours: [6,12,10,4,20,4,2,8,1,1,0,5,2,3,8,2,1,6,2,1][i], sortOrder: i, createdAt: new Date(Date.now()-i*86400000*3).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), project: projects[i%projects.length], assignee: users[i%users.length] }));

const invoices = Array.from({length:12}, (_,i) => ({ id:`inv-${String(i+1).padStart(4,'0')}`, organizationId:'demo-org-001', invoiceNumber: `INV-${String(1001+i)}`, contactName: `${contacts[i%contacts.length]?.firstName||'Client'} ${contacts[i%contacts.length]?.lastName||''}`, companyName: companies[i%companies.length]?.name||'Client', status: ['draft','sent','paid','overdue','paid','sent','draft','paid','overdue','paid','sent','draft'][i], items: [{description:'Web Development',quantity:40,unitPrice:150},{description:'UI/UX Design',quantity:20,unitPrice:175}].slice(0,(i%2)+1), subtotal: [6000,3500,8750,4200,10500,6000,5000,9200,7800,12000,5500,4000][i], tax: [480,280,700,336,840,480,400,736,624,960,440,320][i], total: [6480,3780,9450,4536,11340,6480,5400,9936,8424,12960,5940,4320][i], dueDate: new Date(Date.now()+i*86400000*5).toISOString().split('T')[0], paidAt: i%3===2 ? new Date(Date.now()-i*86400000).toISOString() : null, notes: null, createdAt: new Date(Date.now()-i*86400000*10).toISOString(), updatedAt: new Date(Date.now()-i*86400000*2).toISOString(), owner: users[i%users.length] }));

const expenses = Array.from({length:15}, (_,i) => ({ id:`exp-${i+1}`, organizationId:'demo-org-001', title: ['Office Rent','SaaS Subscriptions','Team Lunch','Flight to NYC','Conference Ticket','Hardware','Marketing Campaign','Legal Fees','Insurance','Training Course','Cloud Hosting','Office Supplies','Client Dinner','Tax Filing','Recruiting Fee'][i], amount: [3500,890,120,450,200,2400,5000,1500,800,350,620,180,275,750,3000][i], category: ['office','software','meals','travel','marketing','equipment','marketing','office','office','training','software','office','meals','office','hr'][i], vendor: ['WeWork','AWS/Stripe','Local Restaurant','Delta Airlines','TechConf','Apple','Google Ads','Law Firm LLP','AIG Insurance','Udemy','DigitalOcean','Staples','Nobu Restaurant','H&R Block','LinkedIn'][i], date: new Date(Date.now()-i*86400000*4).toISOString().split('T')[0], status: i<12 ? 'approved' : 'pending', receiptUrl: null, notes: null, createdAt: new Date(Date.now()-i*86400000*5).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), owner: users[i%users.length] }));

const leaveRequests = Array.from({length:8}, (_,i) => ({ id:`leave-${i+1}`, organizationId:'demo-org-001', requesterId: users[i+2].id, type: ['vacation','sick','personal','maternity','paternity','unpaid','vacation','sick'][i], startDate: new Date(Date.now()+i*86400000*7).toISOString().split('T')[0], endDate: new Date(Date.now()+(i+3)*86400000).toISOString().split('T')[0], reason: ['Family vacation','Flu recovery','Personal matters','Maternity leave','Paternity leave','Volunteer work','Beach trip','Dental surgery'][i], status: ['pending','approved','rejected','approved','pending','approved','pending','approved'][i], reviewedBy: i%2===1 ? users[0].id : null, reviewedAt: i%2===1 ? new Date(Date.now()-i*86400000).toISOString() : null, createdAt: new Date(Date.now()-i*86400000*3).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), requester: users[i+2] }));

const products = Array.from({length:14}, (_,i) => ({ id:`prod-${i+1}`, organizationId:'demo-org-001', sku: `SKU-${String(1001+i)}`, name: ['Enterprise License','Pro Subscription','Team Plan','API Access Pack','Storage Add-on','Priority Support','Custom Integration','Training Package','Onboarding Service','Data Migration','Analytics Pro','Security Bundle','Mobile Add-on','White Label'][i], description: ['Full enterprise access','Professional features','Up to 10 users','10K API calls/month','100GB extra storage','24/7 dedicated support','Custom API integration','Team training sessions','Guided onboarding','Database migration help','Advanced analytics','Security audit + tools','Mobile app access','White-label solution'][i], category: ['Software','Software','Software','API','Storage','Support','Services','Services','Services','Services','Analytics','Security','Mobile','Branding'][i], price: [999,49,29,99,19,199,2500,1500,800,2000,79,399,29,500][i], cost: [100,5,3,10,2,50,500,300,150,400,15,80,5,100][i], stock: [999,999,999,999,999,999,50,30,20,10,999,999,999,999][i], unit: ['license','subscription','subscription','pack','GB','seat','project','session','engagement','project','subscription','bundle','add-on','package'][i], reorderLevel: [10,10,10,10,10,5,5,5,3,2,10,5,10,2][i], warehouseId: `wh-${(i%3)+1}`, isActive: true, createdAt: new Date(Date.now()-i*86400000*6).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString() }));

const warehouses = [{ id:'wh-1', organizationId:'demo-org-001', name:'Main Warehouse', location:'San Francisco, CA', capacity:10000, isActive:true, createdAt:'2024-01-15T00:00:00Z', updatedAt:'2024-06-01T00:00:00Z' },{ id:'wh-2', organizationId:'demo-org-001', name:'East Coast Hub', location:'New York, NY', capacity:7500, isActive:true, createdAt:'2024-02-20T00:00:00Z', updatedAt:'2024-06-01T00:00:00Z' },{ id:'wh-3', organizationId:'demo-org-001', name:'European Depot', location:'London, UK', capacity:5000, isActive:true, createdAt:'2024-03-10T00:00:00Z', updatedAt:'2024-06-01T00:00:00Z' }];

const calendarEvents = Array.from({length:10}, (_,i) => ({ id:`event-${i+1}`, organizationId:'demo-org-001', creatorId: users[i%users.length].id, title: ['Sprint Planning','Team Standup','Client Demo','1:1 Meeting','Board Review','Design Review','Code Review','Retrospective','All Hands','Product Launch'][i], description: null, startDate: new Date(Date.now()+i*86400000).toISOString(), endDate: new Date(Date.now()+i*86400000+3600000).toISOString(), allDay: i%3===0, location: i%2===0 ? 'Conference Room A' : null, color: ['#10b981','#3b82f6','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4','#f97316','#6366f1','#14b8a6'][i], createdAt: new Date(Date.now()-i*86400000*2).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), creator: users[i%users.length] }));

const channels = Array.from({length:6}, (_,i) => ({ id:`ch-${i+1}`, organizationId:'demo-org-001', name: ['general','engineering','design','random','announcements','support'][i], type: i<4?'public':'private', description: ['Company-wide discussions','Engineering team chat','Design team collaboration','Watercooler conversation','Important announcements','Customer support coordination'][i], creatorId: users[0].id, isActive: true, createdAt: new Date(Date.now()-i*86400000*10).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), _count: { messages: [245,189,132,98,67,156][i] } }));

const messages = Array.from({length:30}, (_,i) => ({ id:`msg-${i+1}`, organizationId:'demo-org-001', channelId: channels[i%channels.length].id, senderId: users[i%users.length].id, content: ['Hey team, how is the sprint going?','Just pushed the new feature branch','Can someone review my PR?','The design looks great!','Meeting at 3pm today','Deployed to staging successfully','Found a bug in the auth flow','Client feedback was positive','Need help with the API integration','Documentation is updated','Great work on the release!','Who is on call this weekend?','The dashboard is looking amazing','Let us schedule a retrospective','New hire starting next Monday','Security scan passed','Performance benchmarks look good','Can we push the deadline?','Updated the project timeline','Thanks for the quick fix!','Testing in progress','Requirements clarified with stakeholder','Sprint goal achieved!','Need to refactor the database layer','Backup completed successfully','New API version deployed','UX improvements shipped','Analytics report is ready','Onboarding docs updated','Celebrating team milestone!'][i], isPinned: i===0, createdAt: new Date(Date.now()-i*3600000*2).toISOString(), updatedAt: new Date(Date.now()-i*3600000).toISOString(), sender: users[i%users.length] }));

const tickets = Array.from({length:10}, (_,i) => ({ id:`ticket-${String(1001+i)}`, organizationId:'demo-org-001', ticketNumber: `TKT-${String(1001+i)}`, subject: ['Cannot login to dashboard','Export feature not working','Slow page loading','Missing data in reports','Integration error with Slack','Password reset not sending email','Mobile layout broken','Search not returning results','Billing discrepancy','Feature request: Dark mode'][i], description: ['User reports login page does not accept credentials','CSV export returns empty file on Safari','Dashboard takes 15+ seconds to load','Monthly report shows zero revenue','Webhook to Slack fails intermittently','Users not receiving password reset emails','Mobile menu overlaps content on iOS','Global search returns no results for known records','Invoice total does not match line items','Users requesting dark mode theme option'][i], priority: ['medium','medium','high','critical','high','high','medium','medium','low','low'][i], status: ['open','in-progress','in-progress','in-progress','pending','resolved','open','open','resolved','closed'][i], category: ['Authentication','Export','Performance','Reporting','Integrations','Auth','UI/UX','Search','Billing','Feature Request'][i], contactName: `${contacts[i%contacts.length]?.firstName||'User'} ${contacts[i%contacts.length]?.lastName||''}`, contactEmail: `ticket${i+1}@example.com`, assigneeId: i%3===0 ? null : users[i%users.length].id, dueDate: new Date(Date.now()+i*86400000*3).toISOString().split('T')[0], resolution: i>=8 ? 'Issue resolved and verified' : null, createdAt: new Date(Date.now()-i*86400000*5).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), assignee: i%3===0 ? null : users[i%users.length] }));

const workspacePages = Array.from({length:8}, (_,i) => ({ id:`page-${i+1}`, organizationId:'demo-org-001', parentId: i<2 ? null : 'page-1', title: ['Company Wiki','Product Roadmap','Q3 Goals','Engineering Standards','Design System','Onboarding Guide','Meeting Notes','Project Templates'][i], content: ['<h1>Company Wiki</h1><p>Welcome to the NexusCorp knowledge base.</p>','<h1>Product Roadmap</h1><p>Our 2024 product roadmap and milestones.</p>','<h2>Q3 Goals</h2><ul><li>Launch v2.0</li><li>Grow MRR by 25%</li><li>Achieve 99.9% uptime</li></ul>','<h2>Engineering Standards</h2><p>Code style, review process, and CI/CD guidelines.</p>','<h2>Design System</h2><p>Component library, tokens, and usage guidelines.</p>','<h2>Onboarding Guide</h2><p>Steps for new team members to get started.</p>','<h2>Meeting Notes</h2><p>Collection of meeting notes and action items.</p>','<h2>Project Templates</h2><p>Reusable templates for common project types.</p>'][i], icon: ['book-open','map','target','code','palette','user-plus','file-text','layout-template'][i], color: ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#6366f1'][i], isFolder: i<2, isStarred: i===0, lastEditedBy: users[i%users.length].id, createdAt: new Date(Date.now()-i*86400000*8).toISOString(), updatedAt: new Date(Date.now()-i*86400000).toISOString(), last_edited_by_user: users[i%users.length] }));

const notifications = Array.from({length:12}, (_,i) => ({ id:`notif-${i+1}`, userId: 'demo-user-001', title: ['New lead assigned','Deal stage updated','Task due today','Invoice overdue','Sprint completed','New team member','Support ticket escalated','Report ready','Meeting in 30 min','Comment on your task','Deployment successful','Weekly digest'][i], message: ['A new lead has been assigned to you','Deal "Enterprise Expansion" moved to negotiation','Task "Code review" is due today','Invoice INV-1004 is 3 days overdue','Sprint 24 has been completed successfully','Lisa Wang joined the Engineering team','Ticket TKT-1004 has been escalated to high priority','Q3 Analytics report is ready for review','Team standup meeting in 30 minutes','Sarah Chen commented on your task "API Migration"','v2.4.1 deployed to production successfully','Your weekly activity digest is ready'][i], type: ['assignment','deal','task','finance','project','team','support','report','calendar','comment','deployment','digest'][i], link: null, isRead: i>=5, createdAt: new Date(Date.now()-i*3600000*4).toISOString() }));

const auditLog = Array.from({length:20}, (_,i) => ({ id:`audit-${i+1}`, organizationId:'demo-org-001', userId: users[i%users.length].id, action: ['create','update','delete','login','export','settings.update','role.create','invite.send','member.remove','data.import'][i%10], module: ['CRM','Projects','HR','Finance','Admin','Support','Inventory','Communication','Calendar','Workspace'][i%10], entityId: `entity-${i+1}`, entityName: [leads[i%leads.length]?.firstName, projects[i%projects.length]?.name, users[i%users.length]?.firstName, invoices[i%invoices.length]?.invoiceNumber][i%4], details: null, ipAddress: null, createdAt: new Date(Date.now()-i*3600000*3).toISOString(), user: users[i%users.length] }));

const activityLog = Array.from({length:20}, (_,i) => ({ id:`act-${i+1}`, organizationId:'demo-org-001', userId: users[i%users.length].id, title: ['Created new lead','Updated deal value','Completed task','Sent invoice','Joined project','Added comment','Uploaded file','Changed status','Created channel','Resolved ticket'][i%10], description: [`${users[i%users.length].firstName} created a new lead: ${leads[i%leads.length]?.firstName} ${leads[i%leads.length]?.lastName}`,`${users[i%users.length].firstName} updated deal value to $${deals[i%deals.length]?.value}`,`${users[i%users.length].firstName} completed task: ${tasks[i%tasks.length]?.title}`,`${users[i%users.length].firstName} sent invoice ${invoices[i%invoices.length]?.invoiceNumber}`,`${users[i%users.length].firstName} joined project ${projects[i%projects.length]?.name}`,`${users[i%users.length].firstName} commented on ${tasks[i%tasks.length]?.title}`,`${users[i%users.length].firstName} uploaded a file`,`${users[i%users.length].firstName} changed status to ${['active','completed','in-progress'][i%3]}`,`${users[i%users.length].firstName} created channel #${channels[i%channels.length]?.name}`,`${users[i%users.length].firstName} resolved ticket ${tickets[i%tickets.length]?.ticketNumber}`][i], module: ['CRM','CRM','Projects','Finance','Projects','Projects','Workspace','Projects','Communication','Support'][i%10], entityId: null, link: null, createdAt: new Date(Date.now()-i*3600000*2).toISOString(), user: users[i%users.length] }));

const roles = [{id:'role-1',organizationId:'demo-org-001',name:'Super Admin',description:'Full system access',isSystem:true,permissions:{},createdAt:'2024-01-01T00:00:00Z',updatedAt:'2024-01-01T00:00:00Z',_count:{users:2}},{id:'role-2',organizationId:'demo-org-001',name:'Admin',description:'Organization admin',isSystem:true,permissions:{},createdAt:'2024-01-01T00:00:00Z',updatedAt:'2024-01-01T00:00:00Z',_count:{users:3}},{id:'role-3',organizationId:'demo-org-001',name:'Manager',description:'Team management',isSystem:true,permissions:{},createdAt:'2024-01-01T00:00:00Z',updatedAt:'2024-01-01T00:00:00Z',_count:{users:5}},{id:'role-4',organizationId:'demo-org-001',name:'Employee',description:'Standard access',isSystem:true,permissions:{},createdAt:'2024-01-01T00:00:00Z',updatedAt:'2024-01-01T00:00:00Z',_count:{users:15}}];

const settings = [{key:'company_name',value:'NexusCorp',type:'text',group:'company_info',organizationId:'demo-org-001',updatedAt:'2024-01-01T00:00:00Z',updatedBy:'demo-user-001'},{key:'company_email',value:'info@nexuscorp.io',type:'email',group:'company_info',organizationId:'demo-org-001',updatedAt:'2024-01-01T00:00:00Z',updatedBy:'demo-user-001'},{key:'currency',value:'USD',type:'text',group:'finance',organizationId:'demo-org-001',updatedAt:'2024-01-01T00:00:00Z',updatedBy:'demo-user-001'},{key:'tax_rate',value:'0',type:'number',group:'finance',organizationId:'demo-org-001',updatedAt:'2024-01-01T00:00:00Z',updatedBy:'demo-user-001'},{key:'invoice_prefix',value:'INV',type:'text',group:'finance',organizationId:'demo-org-001',updatedAt:'2024-01-01T00:00:00Z',updatedBy:'demo-user-001'},{key:'fiscal_year_start',value:'01-01',type:'date',group:'finance',organizationId:'demo-org-001',updatedAt:'2024-01-01T00:00:00Z',updatedBy:'demo-user-001'}];

const DEMO_USER = { id:'demo-user-001', email:'admin@nexuscorp.io', firstName:'Alex', lastName:'Morgan', avatarUrl:null, jobTitle:'Platform Administrator', department:'Engineering', organizationId:'demo-org-001', organizationName:'NexusCorp', organizationSlug:'nexuscorp', role:'super_admin', isActive:true };

function sendJson(res, data, status = 200) {
  try {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  } catch {}
}

function paginated(data) {
  return { data, meta: { total: data.length, page: 1, pageSize: 20, totalPages: Math.ceil(data.length/20) } };
}

/* -------------------------------------------------------------------------- */
/*  API Route Handler                                                         */
/* -------------------------------------------------------------------------- */
function handleApi(method, urlPath, res) {
  // Auth routes
  if (urlPath === '/api/auth/session') return sendJson(res, { data: { user: DEMO_USER } });
  if (urlPath === '/api/auth/login') return sendJson(res, { data: { user: DEMO_USER, message: 'Logged in (demo mode)' } });
  if (urlPath === '/api/auth/logout') return sendJson(res, { data: { message: 'Logged out successfully' } });
  if (urlPath === '/api/auth/signup') return sendJson(res, { data: { user: { id: 'demo-new-user', email: 'new@demo.com' }, message: 'Account created (demo mode)' } });
  if (urlPath === '/api/auth/forgot-password') return sendJson(res, { data: { message: 'If an account with this email exists, a password reset link has been sent.' } });
  if (urlPath === '/api/auth/reset-password') return sendJson(res, { data: { message: 'Password updated successfully' } });
  if (urlPath === '/api/auth/invite') return sendJson(res, { data: { id: 'demo-invite-001', email: 'invited@demo.com', role: 'employee', expires_at: new Date(Date.now()+7*864e5).toISOString() } });
  if (urlPath === '/api/auth/accept-invite') return sendJson(res, { data: { message: 'Invitation accepted', organization: { id: 'demo-org-001', name: 'NexusCorp', slug: 'nexuscorp' } } });

  if (method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // Data routes
  const routeData = {
    '/api/crm/leads': leads,
    '/api/crm/contacts': contacts,
    '/api/crm/companies': companies,
    '/api/crm/deals': deals,
    '/api/projects/projects': projects,
    '/api/projects/tasks': tasks,
    '/api/hr/employees': users,
    '/api/hr/leave': leaveRequests,
    '/api/finance/invoices': invoices,
    '/api/finance/expenses': expenses,
    '/api/inventory/products': products,
    '/api/inventory/warehouses': warehouses,
    '/api/calendar/events': calendarEvents,
    '/api/communication/channels': channels,
    '/api/communication/messages': messages,
    '/api/support/tickets': tickets,
    '/api/workspace/pages': workspacePages,
    '/api/admin/users': users,
    '/api/admin/roles': roles,
    '/api/admin/audit-log': auditLog,
    '/api/admin/notifications': notifications,
    '/api/admin/settings': settings,
    '/api/activity-log': activityLog,
    '/api/search': [...leads.slice(0,3), ...contacts.slice(0,2), ...projects.slice(0,2)],
  };

  if (routeData[urlPath]) {
    return sendJson(res, paginated(routeData[urlPath]));
  }

  // Dashboard
  if (urlPath === '/api/dashboard') {
    return sendJson(res, {
      data: {
        stats: {
          totalRevenue: 487500, monthlyRevenue: 68200, activeDeals: deals.filter(d=>!['won','lost'].includes(d.stage)).length,
          openTickets: tickets.filter(t=>!['resolved','closed'].includes(t.status)).length,
          activeProjects: projects.filter(p=>['active','planning'].includes(p.status)).length,
          teamMembers: users.length, tasksCompleted: tasks.filter(t=>t.status==='done').length,
          tasksInProgress: tasks.filter(t=>t.status==='in-progress').length,
          pendingLeaves: leaveRequests.filter(l=>l.status==='pending').length,
        },
        revenueData: Array.from({length:12}, (_,i) => ({ month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i], revenue: [42000,48000,45000,52000,58000,55000,62000,59000,65000,68000,64000,70000][i], expenses: [28000,32000,30000,35000,38000,36000,40000,38000,42000,44000,41000,45000][i] })),
        leadsBySource: [{source:'Website',count:5},{source:'Referral',count:4},{source:'LinkedIn',count:3},{source:'Cold Call',count:3},{source:'Conference',count:3}],
        dealsByStage: [{stage:'Lead',count:2},{stage:'Qualified',count:2},{stage:'Proposal',count:2},{stage:'Negotiation',count:2},{stage:'Contract',count:2},{stage:'Won',count:2},{stage:'Lost',count:2}],
        recentActivity: activityLog.slice(0,8),
        upcomingEvents: calendarEvents.slice(0,5),
      }
    });
  }

  if (urlPath === '/api/export') return sendJson(res, { data: { message: 'Export initiated' } });

  // Dynamic [id] routes
  const dataMap = { lead: leads, contact: contacts, company: companies, deal: deals, project: projects, 'projectTask': tasks, user: users, leaveRequest: leaveRequests, invoice: invoices, expense: expenses, product: products, warehouse: warehouses, calendarEvent: calendarEvents, channel: channels, message: messages, supportTicket: tickets, workspacePage: workspacePages, role: roles, notification: notifications };
  const dynMatch = urlPath.match(/^\/api\/([\w-]+\/[\w-]+)\/([^/]+)$/);
  if (dynMatch) {
    const modelKey = dynMatch[1].replace(/\//g, '_');
    const id = dynMatch[2];
    // Map route prefix to data key
    const routeToDataKey = {'crm/leads':'lead','crm/contacts':'contact','crm/companies':'company','crm/deals':'deal','projects/projects':'project','projects/tasks':'projectTask','hr/employees':'user','hr/leave':'leaveRequest','finance/invoices':'invoice','finance/expenses':'expense','inventory/products':'product','inventory/warehouses':'warehouse','calendar/events':'calendarEvent','communication/channels':'channel','communication/messages':'message','support/tickets':'supportTicket','workspace/pages':'workspacePage','admin/users':'user','admin/roles':'role','admin/notifications':'notification'};
    const dataKey = routeToDataKey[dynMatch[1]];
    if (dataKey && dataMap[dataKey]) {
      const item = dataMap[dataKey].find(d => d.id === id);
      return sendJson(res, { data: item || null });
    }
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route not found' }));
}

/* -------------------------------------------------------------------------- */
/*  Static file server                                                        */
/* -------------------------------------------------------------------------- */
function serveStaticFile(res, filePath, contentType, cacheControl) {
  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': cacheControl || 'public, max-age=31536000, immutable' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = createServer((req, res) => {
  let urlPath;
  try { urlPath = new URL(req.url, 'http://localhost').pathname; } catch { urlPath = req.url.split('?')[0]; }

  if (urlPath.startsWith('/api/')) return handleApi(req.method, urlPath, res);

  if (urlPath.startsWith('/_next/static/')) {
    const relativePath = urlPath.replace('/_next/static/', '');
    const filePath = join(STATIC_DIR, relativePath);
    const ext = filePath.substring(filePath.lastIndexOf('.'));
    return serveStaticFile(res, filePath, MIME[ext] || 'application/octet-stream');
  }

  if (urlPath.includes('/.') || urlPath.includes('..')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  if (urlPath !== '/' && urlPath.includes('.')) {
    const publicPath = join(PUBLIC_DIR, urlPath);
    try {
      if (existsSync(publicPath) && require('fs').statSync(publicPath).isFile()) {
        const ext = publicPath.substring(publicPath.lastIndexOf('.'));
        return serveStaticFile(res, publicPath, MIME[ext] || 'application/octet-stream', 'no-cache');
      }
    } catch {}
  }

  // SPA fallback — serve index.html for all non-file routes
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