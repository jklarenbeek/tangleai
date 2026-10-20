import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AiError } from '@tangleai/models/errors';
import { modelProfile, resolveToolBudget, TOOL_BUDGETS } from '@tangleai/models/profile';
import type { ToolTier } from '@tangleai/models/profile';

describe('models — per-model tool profiles', () => {
  it('reads the documented heuristic off a model id', () => {
    const table: Array<[string, ToolTier]> = [
      // a mixture of experts is classified by its ACTIVE parameters
      ['qwen/qwen3.6-35b-a3b', 'small'],
      ['qwen3-30b-a3b', 'small'],
      ['example/moe-48b-a4b', 'small'],
      ['example/moe-48b-a4.5b', 'medium'],
      ['example/moe-100b-a12b', 'medium'],
      ['qwen/qwen3-235b-a22b-2507', 'large'],
      // a dense model by its total parameters
      ['qwen3:4b', 'tiny'],
      ['deepseek-r1-distill-qwen-1.5b', 'tiny'],
      ['example/dense-7.9b', 'tiny'],
      ['meta-llama/llama-3.1-8b-instruct', 'small'],
      ['example/dense-19b', 'small'],
      ['example/dense-20b', 'medium'],
      ['qwen/qwen3.8-27b', 'medium'],
      ['google/gemma-3-27b-it', 'medium'],
      ['example/dense-39b', 'medium'],
      ['meta-llama/llama-3.3-70b-instruct', 'large'],
      // hosted frontier families carry no size tag
      ['anthropic/claude-sonnet-4.5', 'large'],
      ['openai/gpt-4o-mini', 'large'],
      ['openai/gpt-5', 'large'],
      ['google/gemini-2.5-flash', 'large'],
      // and anything else is unknown, which is medium
      ['z-ai/glm-5.3-flash', 'medium'],
      ['mixtral-8x7b', 'medium'],
    ];
    for (const [model, tier] of table) {
      assert.equal(modelProfile(model).tools.tier, tier, model);
      assert.equal(modelProfile(model).tools, TOOL_BUDGETS[tier], `${model} gets the tier's own budget`);
    }
  });

  it('reports what the id says about the model', () => {
    assert.deepEqual({ ...modelProfile('qwen/qwen3.6-35b-a3b'), tools: undefined }, {
      model: 'qwen/qwen3.6-35b-a3b', family: 'qwen3.6', params: 35, activeParams: 3, moe: true, tools: undefined,
    });
    assert.deepEqual({ ...modelProfile('qwen/qwen3.8-27b'), tools: undefined }, {
      model: 'qwen/qwen3.8-27b', family: 'qwen3.8', params: 27, activeParams: 27, moe: false, tools: undefined,
    }, 'every parameter of a dense model is active');
    const unknown = modelProfile('Anthropic/Claude-Sonnet-4.5');
    assert.equal(unknown.family, 'claude', 'the provider prefix is stripped and the id lowercased');
    assert.equal(unknown.params, null);
    assert.equal(unknown.activeParams, null);
    assert.equal(modelProfile('qwen3:4b').family, 'qwen3');
    assert.ok(Object.isFrozen(unknown));
  });

  it('carries the documented limits per tier', () => {
    assert.deepEqual(TOOL_BUDGETS, {
      tiny: { tier: 'tiny', maxArgumentChars: 300, maxItems: 2, catalog: true, maxSchemaChars: 800 },
      small: { tier: 'small', maxArgumentChars: 600, maxItems: 4, catalog: true, maxSchemaChars: 1500 },
      medium: { tier: 'medium', maxArgumentChars: 2400, maxItems: 12, catalog: false, maxSchemaChars: 4000 },
      large: { tier: 'large', maxArgumentChars: 12000, maxItems: 48, catalog: false, maxSchemaChars: 16000 },
      unlimited: { tier: 'unlimited', maxArgumentChars: Infinity, maxItems: Infinity, catalog: false, maxSchemaChars: Infinity },
    });
    assert.ok(Object.isFrozen(TOOL_BUDGETS) && Object.isFrozen(TOOL_BUDGETS.small));
  });

  it('lets overrides win over the heuristic', () => {
    assert.equal(modelProfile('qwen/qwen3.6-35b-a3b', { tier: 'medium' }).tools, TOOL_BUDGETS.medium);
    assert.deepEqual(modelProfile('qwen3:4b', { tools: { maxItems: 1 } }).tools,
      { ...TOOL_BUDGETS.tiny, maxItems: 1 }, 'a member replaces the tier\'s own');
    assert.deepEqual(modelProfile('qwen3:4b', { tier: 'large', tools: { catalog: true } }).tools,
      { ...TOOL_BUDGETS.large, catalog: true }, 'the tier first, then its members');
    assert.deepEqual(modelProfile('qwen3:4b', { tools: { tier: 'small', maxArgumentChars: 900 } }).tools,
      { ...TOOL_BUDGETS.small, maxArgumentChars: 900 }, 'a tier inside the partial picks its base');
    assert.equal(modelProfile('openai/gpt-5', { tools: { maxArgumentChars: Infinity } }).tools.maxArgumentChars, Infinity);
  });

  it('resolves a budget setting: auto, a tier or a partial', () => {
    assert.equal(resolveToolBudget('auto', 'qwen/qwen3.6-35b-a3b'), TOOL_BUDGETS.small);
    assert.equal(resolveToolBudget(undefined, 'qwen/qwen3.8-27b'), TOOL_BUDGETS.medium, 'nothing is auto');
    assert.equal(resolveToolBudget('small', 'openai/gpt-5'), TOOL_BUDGETS.small, 'a tier wins over the model');
    assert.equal(resolveToolBudget('unlimited', 'qwen3:4b'), TOOL_BUDGETS.unlimited);
    assert.deepEqual(resolveToolBudget({ maxItems: 2 }, 'qwen/qwen3.8-27b'),
      { ...TOOL_BUDGETS.medium, maxItems: 2 }, 'a partial completes the model\'s own budget');
    assert.deepEqual(resolveToolBudget({ tier: 'tiny', catalog: false }, ''),
      { ...TOOL_BUDGETS.tiny, catalog: false }, 'a partial naming its tier needs no model');
  });

  it('refuses misuse with AI0001', () => {
    const refused = (attempt: () => unknown, message: RegExp) => assert.throws(attempt,
      (error: unknown) => error instanceof AiError && error.code === 'AI0001' && message.test(error.message));
    refused(() => modelProfile(42 as unknown as string), /non-empty model id \(got number\)/);
    refused(() => modelProfile('  '), /non-empty model id/);
    refused(() => modelProfile('qwen/'), /names a provider but no model/);
    refused(() => modelProfile('qwen3:4b', { tier: 'huge' as ToolTier }), /unknown tool tier 'huge'/);
    refused(() => modelProfile('qwen3:4b', { teir: 'small' } as never), /unknown override 'teir'/);
    refused(() => modelProfile('qwen3:4b', { tools: { maxItems: -1 } }), /maxItems must be a positive integer/);
    refused(() => resolveToolBudget('huge' as ToolTier, 'qwen3:4b'), /unknown tool tier 'huge'/);
    refused(() => resolveToolBudget({ maxArgumentChars: 0 }, 'qwen3:4b'), /maxArgumentChars must be a positive integer/);
    refused(() => resolveToolBudget({ maxSchemaChars: '4000' as unknown as number }, 'qwen3:4b'), /got string/);
    refused(() => resolveToolBudget({ maxItems: 2.5 }, 'qwen3:4b'), /maxItems must be a positive integer/);
    refused(() => resolveToolBudget({ catalog: 'yes' as unknown as boolean }, 'qwen3:4b'), /catalog must be a boolean/);
    refused(() => resolveToolBudget({ maxArgs: 10 } as never, 'qwen3:4b'), /unknown tool budget member 'maxArgs'/);
    refused(() => resolveToolBudget(null as never, 'qwen3:4b'), /budget must be 'auto', a tool tier or a partial/);
    refused(() => resolveToolBudget('auto', undefined as unknown as string), /non-empty model id/);
  });
});
