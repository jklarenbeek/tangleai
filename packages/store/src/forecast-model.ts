/** Physical ownership indexes only; forecasting contracts own payload validation. */
const id = { type: 'string', minLength: 1 };
const nullableId = { type: ['string','null'] };
const collection = {
  schema: { type: 'object', required: ['id','kind','questionId','scopeKey','checkpointId','ordinal','status','payload'],
    properties: { id, kind: id, questionId: nullableId, scopeKey: id, checkpointId: nullableId, ordinal: { type: ['integer','null'] }, status: nullableId, payload: { type: 'object' } } },
  key: '/id',
  indexes: [{ name: 'by_question',path: ['$.questionId'] }, { name: 'by_scope',path: ['$.scopeKey'] }, { name: 'by_checkpoint',path: ['$.checkpointId'] }],
};
const ordinal = { ...collection,indexes: [...collection.indexes,{ name: 'by_question_ordinal',path: ['$.questionId','$.ordinal'] }] };
export const FORECAST_COLLECTIONS = {
  forecast_questions: collection, forecast_schedules: ordinal, forecast_checkpoints: ordinal, forecast_evidence: collection,
  forecast_predictions: collection, forecast_notes: collection, forecast_traces: collection, forecast_harnesses: collection,
  forecast_revisions: collection, forecast_resolutions: collection, forecast_retrospectives: collection,
};
