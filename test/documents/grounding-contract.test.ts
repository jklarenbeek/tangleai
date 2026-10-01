import {it} from 'node:test';
import assert from 'node:assert/strict';
import {GROUNDED_ANSWER_SCHEMA,generateGroundedAnswer,renderGroundedAnswer,suppliedReferenceGate} from '@tangleai/documents/grounding';
import * as desktop from '../../apps/desktop/src/grounding.ts';
import {answerSchemaRevision} from '../../benchmark/lib/grounding.ts';
import {lightRagSchema} from '@tangleai/lightrag';
it('the shared grounded answer owner preserves the measured schema and every desktop re-export',async()=>{
    assert.equal(await answerSchemaRevision(),'2b651fadfd44e57b15e12c65edbd10d48896a8e3aabe5360b27d39d807329a8e');
    for(const [name,value]of Object.entries({GROUNDED_ANSWER_SCHEMA,generateGroundedAnswer,renderGroundedAnswer,suppliedReferenceGate}))assert.equal(desktop[name as keyof typeof desktop],value);
    const {$id:owner,...schema}=GROUNDED_ANSWER_SCHEMA,{$comment:derived,...actual}=lightRagSchema.$defs.lightRagGroundedAnswer;assert.deepEqual(actual,schema);assert.ok(derived.includes(owner));
});
it('the lifted gate preserves reply-local ids and the measured allowance for uncited unresolved claims',()=>{
    const gate=suppliedReferenceGate(new Set(['chunk']));assert.equal(gate({disposition:'answer',claims:[{id:'c1',text:'Declared but unresolved.',citations:[]}]}),true);
    const invented=gate({disposition:'answer',claims:[{id:'c1',text:'Wrong address.',citations:['entity-id']}]});assert.notEqual(invented,true);
    if(invented!==true)assert.equal(invented.errors[0].instancePath,'/claims/0/citations/0');
});
