import type { CrmActivity } from './types';

export function ActivityDetails({ activity }: { activity: CrmActivity }) {
  const d = activity.engagementDetails;
  if (!d || !Object.keys(d).length) return null;
  const safeLink = d.videoUrl?.startsWith('https://') ? d.videoUrl : undefined;
  return <dl className="mt-2 space-y-1 text-xs leading-5 text-slate-500">
    {d.priority && d.priority !== 'normal' && <div><dt className="inline font-medium">Priority: </dt><dd className="inline capitalize">{d.priority}</dd></div>}
    {d.direction && <div><dt className="inline font-medium">Direction: </dt><dd className="inline">{d.direction}</dd></div>}
    {d.duration !== undefined && <div><dt className="inline font-medium">Duration: </dt><dd className="inline">{d.duration} minutes</dd></div>}
    {d.outcome && <div><dt className="inline font-medium">Outcome: </dt><dd className="inline">{d.outcome}</dd></div>}
    {d.timezone && <div><dt className="inline font-medium">Timezone: </dt><dd className="inline">{d.timezone}</dd></div>}
    {d.location && <div><dt className="inline font-medium">Location: </dt><dd className="inline">{d.location}</dd></div>}
    {d.participants?.length ? <div><dt className="inline font-medium">Participants: </dt><dd className="inline break-words">{d.participants.join(', ')}</dd></div> : null}
    {safeLink && <div><dt className="sr-only">Meeting link</dt><dd><a href={safeLink} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">Open video meeting</a></dd></div>}
  </dl>;
}
