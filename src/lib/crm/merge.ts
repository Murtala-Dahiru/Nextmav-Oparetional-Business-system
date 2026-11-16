import {z} from 'zod';
export const mergeFields = ['first_name','last_name','email','phone','company_name','job_title','source','status','score','estimated_value','owner_id','qualification','territory','industry','service_interest','campaign'] as const;
const choice=z.enum(['source','target']);
export const leadMergeSchema=z.object({
  targetId:z.uuid(),sourceUpdated:z.iso.datetime({offset:true}),targetUpdated:z.iso.datetime({offset:true}),requestKey:z.uuid(),
  choices:z.object({first_name:choice,last_name:choice,email:choice,phone:choice,company_name:choice,job_title:choice,source:choice,status:choice,score:choice,estimated_value:choice,owner_id:choice,qualification:choice,territory:choice,industry:choice,service_interest:choice,campaign:choice}).strict(),
}).strict();
