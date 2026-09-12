import { createOutcomeService, createMemoryOutcomeStore, type OutcomeServiceOptions, type HistoryPage } from '@tangleai/outcomes';
import { createOutcomeContract, createOutcomeHandlers } from '@tangleai/outcomes/contract';
import { createDirectionDeltaAdapter } from '@tangleai/outcomes/adapters/direction-delta';
import { createExactMatchAdapter } from '@tangleai/outcomes/adapters/exact-match';
import type { CreateCommand, ScoreResult, ReflectInput } from '@tangleai/outcomes/contracts';
import schema from '@tangleai/outcomes/schemas/outcomes' with { type: 'json' };
import contract from '@tangleai/outcomes/schemas/contract' with { type: 'json' };
declare const host: OutcomeServiceOptions;
const service = await createOutcomeService({ ...host, store: createMemoryOutcomeStore(), principal: undefined });
createOutcomeHandlers({ resolveHost: () => ({ service, allowScope: id => id === service.scopeId }) });
createOutcomeContract(); await createDirectionDeltaAdapter(); await createExactMatchAdapter();
declare const command: CreateCommand;
await service.create(command);
declare const result: ScoreResult;
if (result.ok) { const id: string = result.value.projectionIntentId; void id; }
declare const history: HistoryPage;
const upper: number = history.upper; void upper;
// @ts-expect-error the mode is a closed canonical enum
const mode: ReflectInput['mode'] = 'activate';
void [schema, contract, mode];
