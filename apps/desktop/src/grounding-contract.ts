/** Relocate the existing schema resources into the self-contained desktop contract. */
import { groundingSchema } from '@tangleai/grounding';
import { runIdentitySchema } from '@tangleai/config';
import {contractSchemaResource} from './schema-resources.ts';
export const GROUNDING_DEFINITIONS = { grounding: contractSchemaResource(groundingSchema,'#/$defs/grounding',{[runIdentitySchema.$id]:'#/$defs/config'}), config: contractSchemaResource(runIdentitySchema,'#/$defs/config',{[runIdentitySchema.$id]:'#/$defs/config','#runIdentity':'#/$defs/config'}) };
const ref = (name: string) => ({ $ref: '#/$defs/grounding/$defs/' + name });
const text = { type: 'string', minLength: 1, maxLength: 256 };
const session = { type: 'object', additionalProperties: false, required: ['sessionId'], properties: { sessionId: text } };
const errors = { 'not-found': { status: 404 }, 'grounding-refused': { status: 422 }, 'execution-conflict': { status: 409 } };
export const GROUNDING_OPERATIONS = {
  'grounding.start': { kind: 'command', input: { type: 'object', additionalProperties: false, required: ['text'], properties: {
    text: { type: 'string', minLength: 1, maxLength: 16000 }, profileId: text } }, output: ref('groundingReply'), errors, http: { method: 'POST', path: '/api/grounding/start' } },
  'grounding.reply': { kind: 'command', input: { ...session, required: ['sessionId', 'interactionId', 'response'], properties: {
    ...session.properties, interactionId: text, response: { type: 'object' } } }, output: ref('groundingReply'), errors, http: { method: 'POST', path: '/api/grounding/reply' } },
  'grounding.refresh': { kind: 'command', input: { ...session, required: ['sessionId', 'reason'], properties: {
    ...session.properties, reason: { type: 'string', minLength: 1, maxLength: 1000 } } }, output: ref('groundingReply'), errors, http: { method: 'POST', path: '/api/grounding/refresh' } },
  'grounding.get': { kind: 'read', input: session, output: ref('groundingReply'), errors, http: { method: 'GET', path: '/api/grounding/get' } },
  'grounding.list': { kind: 'read', input: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } },
    output: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sessionId', 'disposition', 'turn', 'at'], properties: {
      sessionId: text, disposition: groundingSchema.$defs.groundingReply.properties.disposition, turn: { type: 'integer', minimum: 0 }, at: { type: 'string' } } } }, errors, http: { method: 'GET', path: '/api/grounding/list' } },
  'grounding.evidence': { kind: 'read', input: session, output: ref('groundingEvidenceView'), errors, http: { method: 'GET', path: '/api/grounding/evidence' } },
  'grounding.conflicts': { kind: 'read', input: session, output: { type: 'array', items: ref('evidenceConflict') }, errors, http: { method: 'GET', path: '/api/grounding/conflicts' } },
} as const;
