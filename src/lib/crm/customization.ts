import { z } from 'zod';

export const crmObjectSchema = z.enum(['leads', 'contacts', 'companies', 'deals']);
export type CrmObject = z.infer<typeof crmObjectSchema>;
export const fieldTypes = ['text', 'multiline', 'number', 'currency', 'percentage', 'date', 'datetime', 'dropdown', 'multiselect', 'checkbox', 'email', 'phone', 'url', 'member', 'company', 'contact'] as const;
export const customValuesSchema = z.record(z.uuid(), z.union([z.string().max(12000), z.number().finite(), z.boolean(), z.array(z.string().max(100)).max(100), z.null()])).refine(v => Object.keys(v).length <= 100, 'At most 100 custom values');
export type CustomValues = z.infer<typeof customValuesSchema>;
export const fieldDefinitionSchema = z.object({
  id: z.uuid().nullable(), version: z.number().int().min(0), object: crmObjectSchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/), label: z.string().trim().min(1).max(100),
  type: z.enum(fieldTypes), required: z.boolean(), archived: z.boolean(),
  options: z.array(z.string().trim().min(1).max(100)).max(100).refine(a => new Set(a).size === a.length, 'Options must be unique'),
  validation: z.object({min:z.number().finite().min(-1e15).max(1e15).optional(),max:z.number().finite().min(-1e15).max(1e15).optional(),maxLength:z.number().int().min(1).max(12000).optional()}).strict().optional(),
  defaultValue: z.union([z.string().max(12000),z.number().finite(),z.boolean(),z.array(z.string().max(100)).max(100),z.null()]).optional(),
  position: z.number().int().min(0).max(100),
}).strict().refine(f => !['dropdown', 'multiselect'].includes(f.type) || f.options.length > 0, 'Add at least one option');
export type FieldDefinition = Omit<z.infer<typeof fieldDefinitionSchema>, 'id'> & { id: string };

export const standardLayoutFields = ['Email','Phone','Company','Job title','Source','Campaign','Estimated value','Recorded score','Owner','Added','Notes','Status','Value','Weighted','Won on','Lost on','Expected close','Age','Industry','Website'] as const;
export function standardLayoutId(label:string) { return 'standard:'+label.toLowerCase().replaceAll(' ','_'); }
export const objectLayoutFields: Record<CrmObject, readonly string[]> = {
  leads: ['Email','Phone','Company','Job title','Source','Campaign','Estimated value','Recorded score','Owner','Added','Notes'],
  contacts: ['Email','Phone','Company','Job title','Source','Status','Added','Notes'],
  companies: ['Company','Industry','Email','Phone','Website','Notes'],
  deals: ['Value','Weighted','Won on','Lost on','Expected close','Owner','Age','Notes'],
};
const layoutField = z.union([z.uuid(),z.string().refine(value=>standardLayoutFields.some(label=>standardLayoutId(label)===value),'Unknown standard field')]);
export const layoutSchema = z.array(z.object({
  id: z.uuid(), title: z.string().trim().min(1).max(100), columns: z.union([z.literal(1), z.literal(2)]),
  collapsed: z.boolean(), fields: z.array(layoutField).max(100),
}).strict()).max(10).refine(sections => {
  const ids = sections.flatMap(s => s.fields);
  return ids.length <= 100 && new Set(ids).size === ids.length && new Set(sections.map(s => s.id)).size === sections.length;
}, 'Each section and field can appear only once');
export type RecordLayout = z.infer<typeof layoutSchema>;
export const layoutSaveSchema = z.object({ object: crmObjectSchema, version: z.number().int().min(0), action: z.enum(['draft', 'publish', 'revert']), sections: layoutSchema }).strict();

export const presentationSchema = z.object({
  hidden: z.array(z.string().min(1).max(140)).max(140),
  order: z.array(z.string().min(1).max(140)).max(140),
  density: z.enum(['comfortable','compact']),
}).strict();
export type ListPresentation = z.infer<typeof presentationSchema>;
