import { db } from '@/lib/db';
import { success, error } from '@/lib/api-response';
import { updateSettingsSchema } from '@/lib/validations';

export async function GET() {
  try {
    const settings = await db.setting.findMany({ orderBy: { group: 'asc' } });
    return success(settings);
  } catch (e: any) {
    return error(e.message || 'Failed to fetch settings', 500);
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const validated = updateSettingsSchema.parse(body);

    const results = await Promise.all(
      validated.settings.map((item) =>
        db.setting.upsert({
          where: { key: item.key },
          update: { value: item.value, type: item.type, group: item.group },
          create: { key: item.key, value: item.value, type: item.type, group: item.group },
        })
      )
    );

    return success(results);
  } catch (e: any) {
    if (e.name === 'ZodError') return error('Validation failed: ' + JSON.stringify(e.issues), 422);
    return error(e.message || 'Update failed', 500);
  }
}