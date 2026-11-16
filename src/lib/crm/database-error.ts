import {pgError} from '@/lib/auth-context';
import {error} from '@/lib/api-response';

/** Missing CRM schema is a deployment dependency, not an empty business result. */
export function crmDatabaseError(failure:{code?:string;message?:string;details?:string}) {
 if (failure.code==='22023') return error(failure.message??'Invalid CRM input',422,'CRM_INVALID_INPUT');
 if (['PT409','40001'].includes(failure.code??'')) return error('This record changed. Reload its current revision before saving.',409,'CRM_RECORD_CONFLICT');
 if (['42P01','42703','42883','PGRST202','PGRST204','PGRST205'].includes(failure.code??'')) {
  return error('This feature is awaiting the CRM database update. Please contact your administrator.',503,'CRM_SCHEMA_REQUIRED');
 }
 return pgError(failure);
}
