import {
  lateMinutesFor, statusForCheckIn, workedMinutesBetween, summarise,
  workingDaysBetween, formatDuration, workingDayOf, isWorkingDay,
} from '../src/lib/attendance';

let pass=0, fail=0;
const eq=(a,b,m)=>{const ok=JSON.stringify(a)===JSON.stringify(b);ok?pass++:fail++;
  console.log(`  ${ok?'PASS':'FAIL'} | ${m}${ok?'':`  (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);};
const at=(h,m)=>{const d=new Date(2026,6,24);d.setHours(h,m,0,0);return d;};

console.log('LATENESS (start 09:00, grace 10m)');
eq(lateMinutesFor(at(8,45)),0,'08:45 early -> 0');
eq(lateMinutesFor(at(9,0)),0,'09:00 on time -> 0');
eq(lateMinutesFor(at(9,10)),0,'09:10 within grace -> 0');
eq(lateMinutesFor(at(9,11)),1,'09:11 just past grace -> 1');
eq(lateMinutesFor(at(9,45)),35,'09:45 -> 35');

console.log('\nSTATUS');
eq(statusForCheckIn(at(9,0)),'present','on time -> present');
eq(statusForCheckIn(at(9,30)),'late','late -> late');
eq(statusForCheckIn(at(9,30),{remote:true}),'remote','remote wins over late');

console.log('\nWORKED MINUTES (30m unpaid break, only on long shifts)');
eq(workedMinutesBetween(at(9,0),at(17,30)),480,'09:00-17:30 -> 8h00 (510 less 30m break)');
eq(workedMinutesBetween(at(9,0),at(9,45)),45,'45m shift -> no break deducted');
eq(workedMinutesBetween(at(9,0),at(10,30)),60,'90m shift -> break deducted');
eq(workedMinutesBetween(at(17,0),at(9,0)),0,'inverted times -> 0, never negative');
eq(workedMinutesBetween(at(9,0),at(9,0)),0,'zero-length -> 0');

console.log('\nFORMATTING');
eq(formatDuration(480),'8h 00m','480 -> 8h 00m');
eq(formatDuration(95),'1h 35m','95 -> 1h 35m');
eq(formatDuration(0),'0h 00m','0 -> 0h 00m');
eq(formatDuration(-5),'0h 00m','negative -> 0h 00m');

console.log('\nWORKING DAYS (Mon-Fri)');
eq(isWorkingDay(new Date(2026,6,25)),false,'Saturday is not a working day');
eq(isWorkingDay(new Date(2026,6,27)),true,'Monday is');
eq(workingDaysBetween(new Date(2026,6,20),new Date(2026,6,24)),5,'Mon-Fri -> 5');
eq(workingDaysBetween(new Date(2026,6,20),new Date(2026,6,26)),5,'full week incl weekend -> 5');

console.log('\nSUMMARY');
const recs=[
  {status:'present',workedMinutes:480,lateMinutes:0},
  {status:'present',workedMinutes:470,lateMinutes:0},
  {status:'late',workedMinutes:450,lateMinutes:25},
  {status:'remote',workedMinutes:490,lateMinutes:0},
  {status:'on_leave',workedMinutes:0,lateMinutes:0},
];
const s=summarise(recs,5);
eq(s.present,2,'present count');
eq(s.late,1,'late count');
eq(s.onLeave,1,'on-leave count');
eq(s.totalMinutes,1890,'total minutes');
eq(s.totalLateMinutes,25,'total late minutes');
eq(s.attendanceRate,80,'4 attended of 5 expected -> 80%');
eq(s.punctualityRate,75,'3 punctual of 4 attended -> 75% (leave does not count against it)');
eq(summarise([],5).attendanceRate,0,'no records -> 0%, not NaN');
eq(summarise(recs,0).attendanceRate,0,'0 expected days -> 0%, no divide-by-zero');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
