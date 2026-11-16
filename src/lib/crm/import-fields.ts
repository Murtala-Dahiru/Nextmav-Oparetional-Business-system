import { z } from 'zod';
import type { CustomValues, FieldDefinition } from './customization';

export function mapImportFields(row: string[], mapping: Record<string, number | undefined>, fields: FieldDefinition[], creating: boolean) {
  const values: CustomValues = {};
  for (const field of fields.filter(f => !f.archived)) {
    const column = mapping[`custom:${field.id}`];
    const text = column === undefined ? '' : (row[column] ?? '').trim();
    if (!text) {
      if (creating && field.required && field.defaultValue == null) throw new Error(`${field.label} is required`);
      continue;
    }
    const invalid = () => { throw new Error(`Invalid ${field.label}`); };
    let value: CustomValues[string] = text;
    switch (field.type) {
      case 'number': case 'currency': case 'percentage':
        value = Number(text);
        if (!Number.isFinite(value) || Math.abs(value) > 1e15 || (field.type === 'percentage' && (value < 0 || value > 100))) invalid();
        break;
      case 'checkbox':
        if (!/^(true|false|yes|no|1|0)$/i.test(text)) invalid();
        value = /^(true|yes|1)$/i.test(text); break;
      case 'multiselect':
        try { value = z.array(z.string()).max(100).parse(JSON.parse(text)); } catch { value = text.split('|').map(s => s.trim()); }
        if (new Set(value).size !== value.length || value.some(v => !field.options.includes(v))) invalid(); break;
      case 'dropdown': if (!field.options.includes(text)) invalid(); break;
      case 'company': case 'contact': case 'member': if (!z.uuid().safeParse(text).success) invalid(); break;
      case 'email': if (!z.email().safeParse(text).success) invalid(); break;
      case 'date': if (!z.iso.date().safeParse(text).success) invalid(); break;
      case 'datetime': if (!z.iso.datetime({ offset: true }).safeParse(text).success) invalid(); break;
      case 'phone': if (!/^\+?[0-9 ()#.*-]{3,80}$/.test(text)) invalid(); break;
      case 'url': if (!/^https?:\/\/[^\s/]+[^\s]*$/.test(text)) invalid(); break;
    }
    if (typeof value === 'string' && value.length > (field.type === 'multiline' ? 12000 : 1000)) invalid();
    if(typeof value==='number' && ((field.validation?.min!==undefined && value<field.validation.min)||(field.validation?.max!==undefined && value>field.validation.max))) invalid();
    if(typeof value==='string' && field.validation?.maxLength && value.length>field.validation.maxLength) invalid();
    values[field.id] = value;
  }
  return values;
}
