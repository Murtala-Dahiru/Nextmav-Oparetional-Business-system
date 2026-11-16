'use client';

import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Head } from '@/components/shared/readout/primitives';
import { money, tickStyle } from '@/components/shared/readout/viz';
import { formatNumber } from '@/lib/format';
import { ChartEmpty, CommandTooltip, DistributionRing, useCommandPalette } from './chart-system';
import { expenseDistribution, projectBand, type ProjectBand } from './visual-model';
import type { DashboardData, DashboardFinance, DashboardProjects, DashboardSupport, DashboardCrm } from './types';

export function ExecutiveBriefing({ data }: { data: DashboardData }) {
  const facts: { title: string; detail: string }[] = [];
  const months = data.finance?.revenueByMonth.filter(m => !m.current) ?? [];
  const latest = months.at(-1), previous = months.at(-2);
  if (latest && previous && previous.revenue > 0) {
    const delta = (latest.revenue - previous.revenue) / previous.revenue * 100;
    facts.push({ title: `${Math.abs(delta).toFixed(1)}% ${delta >= 0 ? 'increase' : 'decrease'} in collections`, detail: `${latest.month} versus ${previous.month}. Both months are complete.` });
  }
  if (data.finance?.receivables.overdueValue) facts.push({title:`${money(data.finance.receivables.overdueValue)} awaiting collection`,detail:`${data.finance.receivables.overdueCount} invoices are past their due date. Review the receivables list.`});
  if (data.projects?.delayed) facts.push({title:`${data.projects.delayed} projects past deadline`,detail:'Active projects with an end date before today. Review delivery priorities.'});
  if (facts.length < 3 && data.support?.critical) facts.push({title:`${data.support.critical} critical support cases`,detail:'Unresolved cases with critical priority. Review the support queue.'});
  return <section className="cc-briefing" aria-label="Executive briefing"><div className="cc-briefing-heading"><span className="command-eyebrow">EXECUTIVE BRIEFING</span><span>Recorded facts. Clear next steps.</span></div><div className="cc-briefing-facts">{facts.length ? facts.slice(0,3).map((f,i)=><article key={f.title}><span className="cc-briefing-number">0{i+1}</span><h3>{f.title}</h3><p>{f.detail}</p></article>) : <p className="command-chart-note">No briefing statements can be derived from the available records. Review the source metrics above.</p>}</div></section>;
}

export function ExpenseDistribution({ finance, range }: { finance: DashboardFinance; range: number }) {
  const v=useCommandPalette();
  const expenses=expenseDistribution(finance,range);
  const colors=[v.cost,'#566c88','#a6b4c7','#c4cfdb','#dce2ea'];
  return <section className="nm-analytics-panel cc-expenses"><Head title="Expense mix" note="Approved & reimbursed"/><p className="command-chart-note">Selected {range} months · {finance.currency} · expense date</p><DistributionRing items={expenses.map((e,i)=>({...e,color:colors[i]}))} label="Approved cost" currency/><p className="cc-footnote">Top categories by recorded expense. Remaining categories are grouped together.</p></section>;
}

export function ProjectDistribution({ projects, selected, onSelect }: { projects: DashboardProjects; selected: ProjectBand | null; onSelect: (band: ProjectBand | null)=>void }) {
  const v=useCommandPalette();
  const bands: ProjectBand[]=['On track','At risk','Delayed'];
  const colors=[v.good,v.warn,v.bad];
  return <section className="nm-analytics-panel"><Head title="Delivery health" note="Active projects · current snapshot"/><DistributionRing items={bands.map((name,i)=>({name,value:projects.progress.filter(p=>projectBand(p)===name).length,color:colors[i]}))} label="Active projects" selected={selected ?? undefined} onSelect={name=>onSelect(selected === name ? null : name as ProjectBand)}/><p className="cc-footnote">Select a category to filter the project list. Delayed: past the end date. At risk: recorded health flag, excluding delayed projects.</p></section>;
}

export function SalesOutcomes({ crm }: { crm: DashboardCrm }) {
  const v=useCommandPalette();
  const won=crm.dealsByStage.find(s=>s.stage==='closed_won')?.count ?? 0;
  const lost=crm.dealsByStage.find(s=>s.stage==='closed_lost')?.count ?? 0;
  return <section className="nm-analytics-panel"><Head title="Sales outcomes" note="All recorded closed deals"/><DistributionRing label="Closed deals" items={[{name:'Won',value:won,color:v.good},{name:'Lost',value:lost,color:v.cost}]}/><div className="cc-mini-metrics"><div><strong>{formatNumber(crm.newLeads)}</strong><span>New leads this month</span></div><div><strong>{formatNumber(crm.qualifiedLeads)}</strong><span>Currently qualified</span></div></div><p className="cc-footnote">Win rate uses won ÷ all closed deals. Lead counts are separate populations, not a conversion funnel.</p></section>;
}

export function ServiceTrend({ support }: { support: DashboardSupport }) {
  const v=useCommandPalette();
  const trend=support.trend?.slice(-6).map(t=>({...t,month:new Date(`${t.month}T00:00:00Z`).toLocaleDateString('en',{month:'short',year:'2-digit',timeZone:'UTC'})})) ?? [];
  return <section className="nm-analytics-panel"><Head title="Service demand & resolution" note="Six calendar months"/><div className="cc-chart-intro"><p>New requests and resolved cases over time</p><div className="cc-legend"><span><i style={{background:v.claim}}/>Opened</span><span><i style={{background:v.good}}/>Resolved</span></div></div>{trend.some(t=>t.opened||t.resolved) ? <><div className="cc-service-chart" role="img" aria-label="Monthly tickets opened and resolved; exact values in the data table below"><ResponsiveContainer width="100%" height="100%"><LineChart data={trend} margin={{left:0,right:15,top:20,bottom:10}}><CartesianGrid vertical={false} stroke={v.border} strokeDasharray="2 5"/><XAxis dataKey="month" tick={tickStyle(v)} axisLine={false} tickLine={false} minTickGap={24}/><YAxis domain={[0,'auto']} allowDecimals={false} width={36} tick={tickStyle(v)} axisLine={false} tickLine={false}/><Tooltip content={<CommandTooltip/>} cursor={{stroke:v.axis,strokeDasharray:'3 3'}}/><Line type="linear" dataKey="opened" name="Opened" stroke={v.claim} strokeWidth={2.5} dot={{r:3,strokeWidth:2,fill:v.surface}} activeDot={{r:5}} isAnimationActive={false}/><Line type="linear" dataKey="resolved" name="Resolved" stroke={v.good} strokeWidth={2.5} dot={{r:3,strokeWidth:2,fill:v.surface}} activeDot={{r:5}} isAnimationActive={false}/></LineChart></ResponsiveContainer></div><details className="command-data"><summary>View monthly ticket counts</summary><table><caption className="sr-only">Service activity</caption><thead><tr><th>Month</th><th>Opened</th><th>Resolved</th></tr></thead><tbody>{trend.map(t=><tr key={t.month}><th>{t.month}</th><td>{t.opened}</td><td>{t.resolved}</td></tr>)}</tbody></table></details></> : <ChartEmpty title="No ticket activity yet" detail="Monthly trends appear as support requests are opened and resolved."/>}<p className="cc-footnote">Current month is incomplete. Resolved cases may have been opened in earlier months.</p></section>;
}

export function SupportPriorities({ support }: { support: DashboardSupport }) {
  const v=useCommandPalette();
  const priorities=support.byPriority.map(p=>({...p,label:p.priority.charAt(0).toUpperCase()+p.priority.slice(1)}));
  const colors: Record<string,string>={critical:v.bad,high:v.warn,medium:v.claim,low:v.cost};
  return <section className="nm-analytics-panel"><Head title="Support priorities" note="Open cases · current snapshot"/><div className="cc-priority-total"><strong>{formatNumber(support.open)}</strong><span>cases in the queue</span></div>{support.open ? <><div className="cc-priority-stack" role="img" aria-label={priorities.map(p=>`${p.label}: ${p.count}`).join(', ')}>{priorities.filter(p=>p.count>0).map(p=><span key={p.priority} style={{flex:p.count,background:colors[p.priority] ?? v.cost}} title={`${p.label}: ${p.count}`}/>)}</div><ul className="cc-distribution-key">{priorities.map(p=><li key={p.priority}><div><span className="cc-dot" style={{background:colors[p.priority] ?? v.cost}}/><span>{p.label}</span><strong>{formatNumber(p.count)}</strong></div></li>)}</ul></> : <ChartEmpty title="No open cases" detail="The support queue is clear."/>}<p className="cc-footnote">{support.breached} past their recorded deadline · {support.withoutDeadline ?? 0} without a deadline. Missing deadlines do not imply SLA compliance.</p></section>;
}

export function WorkforceSummary({ data }: { data: DashboardData }) {
  if (!data.hr) return null;
  return <section className="nm-analytics-panel cc-workforce"><div><h3>Workforce at a glance</h3><p>Authorized organization totals · current snapshot</p></div><div><strong>{formatNumber(data.hr.headcount)}</strong><span>Active people</span></div><div><strong>{formatNumber(data.hr.departments)}</strong><span>Departments</span></div><p>Headcount is not a measure of capacity or utilization.</p></section>;
}
