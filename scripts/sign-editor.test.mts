import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceHistory,
  proportionalResize,
  makeFields,
  recipientsForTool,
  toolLabels,
  transformField,
  type Tool,
} from '../src/lib/sign/editor';
import {
  fieldSchema, savedDraftSchema, draftSchema, signValidationMessage,
  type Recipient,
  validateFieldAssignments,
} from '../src/lib/sign/model';

const signer: Recipient = {
  id: crypto.randomUUID(),
  role: 'signer',
  order: 1,
  verification: 'possession',
  name: 'Signer',
  email: '',
  generation: 0,
};
const witness: Recipient = {
  ...signer,
  id: crypto.randomUUID(),
  role: 'witness',
  order: 2,
  name: 'Witness',
};
const parties = [signer, witness];
for (const tool of Object.keys(toolLabels) as Tool[]) {
  test(
    tool +
      ' stays on the chosen page with a valid assignment at its bottom edge',
    () => {
      const owners = recipientsForTool(tool, parties, signer.id);
      const fields = makeFields(tool, owners, 2, 1, 1);
      assert.ok(fields.length);
      for (const field of fields) {
        fieldSchema.parse(field);
        assert.equal(field.page, 2);
        if (tool.startsWith('witness_'))
          assert.equal(field.recipientId, witness.id);
      }
      validateFieldAssignments(fields, parties, 2);
      if (tool === 'signature') assert.equal(fields.length, 1);
    },
  );
}
test('witness tools require an actual witness', () => {
  assert.deepEqual(recipientsForTool('witness_name', [signer]), []);
});
test('move and corner resize stay inside the page at any scale', () => {
  const [field] = makeFields('signature', [signer], 1, 0.2, 0.3);
  for (const corner of ['nw', 'ne', 'sw', 'se', '']) {
    for (const delta of [-2, 2])
      fieldSchema.parse(transformField(field, delta, delta, corner));
  }
  assert.equal(transformField(field, 0.016, 0.016, '', true).x, 0.22);
});

test('undo and redo keep document snapshots and a new edit drops the redo branch', () => {
  const empty = { past: [], future: [] };
  const one = makeFields('text', [signer], 1, 0.2, 0.3);
  const changed = one.map((field) => ({ ...field, required: false }));
  const added = advanceHistory(empty, { type: 'edit', fields: [] });
  const edited = advanceHistory(added, { type: 'edit', fields: one });
  assert.deepEqual(edited.past.at(-1), one);
  const undone = advanceHistory(edited, { type: 'undo', fields: changed });
  assert.deepEqual(undone.future.at(-1), changed);
  assert.deepEqual(
    advanceHistory(undone, { type: 'redo', fields: one }),
    edited,
  );
  assert.deepEqual(
    advanceHistory(undone, { type: 'edit', fields: one }).future,
    [],
  );
  assert.equal(advanceHistory(empty, { type: 'undo', fields: [] }), empty);
});

test('proportional resize keeps aspect ratio at all four page boundaries', () => {
  const [field] = makeFields('signature', [signer], 1, 0.3, 0.4);
  for (const corner of ['nw', 'ne', 'sw', 'se']) {
    const resized = proportionalResize(field, 2, 2, corner);
    fieldSchema.parse(resized);
    assert.ok(
      Math.abs(resized.width / resized.height - field.width / field.height) <
        0.00001,
    );
  }
});

test('an unnamed third recipient can be saved but cannot be issued',()=>{
 const data={title:'Draft',sequential:false,expiresAt:new Date(Date.now()+86400000).toISOString(),recipients:[signer,witness,{...signer,id:crypto.randomUUID(),name:'   '}],fields:[]};
 assert.equal(savedDraftSchema.parse(data).recipients[2].name,'');
 const issued=draftSchema.safeParse(data);
 assert.equal(issued.success,false);
 if(!issued.success)assert.equal(signValidationMessage(issued.error),'Recipient 3 needs a name. Enter their full name or remove this recipient before enabling signing.');
 data.recipients[2].name='Third Person';
 assert.equal(draftSchema.safeParse(data).success,true);
});
