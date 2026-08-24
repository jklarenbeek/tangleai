# LoCoMo Benchmark Integration — Implementation Plan (v2)

> **Goal:** Integrate the LoCoMo long-term conversational memory benchmark as a first-class, automated benchmark that drives iterative optimization of MemFlow's memory/retrieval/evolution components — while building a vendor-agnostic agent configuration system that records every LLM/provider choice in Memgraph for post-hoc pattern analysis.
>
> **Effort Estimate:** 3–5 weeks for full evolutionary loop + config system; 3–4 days for Phase 1 MVP.

---

## 0. Research Corrections & Critical Findings

### 0.1 Adversarial QA (Category 5) — Double Bug

The LoCoMo dataset has **two independent bugs** in category 5:

**Bug A — Missing `answer` keys (data):**
444 of 446 adversarial questions lack `answer`, containing only `adversarial_answer`. The official prompting code (`gpt_utils.py`, `claude_utils.py`, etc.) does `qa['answer']` → `KeyError`.

**Bug B — Evaluation logic contradicts prompting (code):**
`evaluation.py` lines 216-221 score category 5 as:
```python
if 'no information available' in output.lower() or 'not mentioned' in output.lower():
    all_ems.append(1)
else:
    all_ems.append(0)
```

But the 2 questions that *do* have both fields show the **correct answer is factual** (e.g., `"answer": "No"`, `"adversarial_answer": "Yes"`). The evaluation would give **0** for the correct answer because it doesn't say "not mentioned". This is a released-code bug, not a design choice.

**MemFlow Fix:**
- **Skip category 5 in official LoCoMo parity scoring** (report categories 1-4 only)
- **Add experimental LLM-as-judge evaluation** for category 5: the judge sees the conversation evidence + model output and scores factual correctness
- **Optional:** Run an evidence-extraction LLM over the 444 missing-answer questions to recover ground truths (expensive, deferred)
- **Document the flaw** in all benchmark reports with a `cat5_excluded: true` flag

### 0.2 `text-embedding-ada-002` Clarification

My initial report implied this was a core LoCoMo dependency. It is **not**. It appears only as:
- An **optional RAG retriever** (`--retriever=openai`) in `rag_utils.py`
- A default in `memory_utils.py` for observation generation (not evaluation)

The default LoCoMo RAG retrievers are local HF models: `contriever`, `dragon`, `dpr`. MemFlow's existing `EmbeddingProvider` abstraction (`ollama`/`openrouter`/`openai`) handles this natively. No special Ada-002 handling required.

### 0.3 Event Summarization Evaluation — Missing

The LoCoMo repo has **no released evaluation code** for event summarization (README: "Coming soon!"). We must build our own:
- Graph edit distance between predicted and ground-truth event graphs
- LLM-as-judge for semantic event matching
- Precision/recall on causal/temporal edges

---

## 1. Configuration Architecture (Foundation for Everything)

Before touching LoCoMo-specific code, we build a **vendor-agnostic, hierarchically inherited agent configuration system** that records every provider choice in Memgraph. This is prerequisite for both the benchmark and future agent personas.

### 1.1 Problem with Current State

MemFlow's config is flat:
```typescript
// GlobalConfig — one provider/model for entire workflow
interface GlobalConfig {
  llmProvider?: "ollama" | "openrouter" | "openai";
  llmModel?: string;
  embeddingProvider?: "ollama" | "openrouter" | "openai";
  embeddingModel?: string;
}
```

`WorkflowContext.getLLM(moduleConfig?)` caches by `"provider:model"` string. This is too coarse:
- No temperature/topP per agent
- No vendor abstraction ("smart" vs. "fast" vs. "cheap")
- No recording of which config produced which output
- No way to query Memgraph for "which model stack gives best temporal QA?"

### 1.2 Proposed: `AgentConfigProfile` with Capability Abstraction

We introduce **capability profiles** — vendor-agnostic labels that resolve to concrete models at runtime.

```typescript
// src/core/types.ts — additions

/** Vendor-agnostic capability tiers. These are NOT model names. */
export type LLMCapability = "reasoning" | "fast" | "cheap" | "vision" | "long_context";
export type EmbeddingCapability = "general" | "multilingual" | "code" | "high_dim";

/** A model specification that can resolve to any vendor. */
export interface ModelSpec {
  /** Concrete vendor */
  provider: "ollama" | "openrouter" | "openai";
  /** Concrete model identifier */
  model: string;
  /** Optional: override base URL */
  baseUrl?: string;
  /** Optional: override API key */
  apiKey?: string;
  /** Capability tags for auto-selection */
  capabilities?: LLMCapability[];
}

/** Inference parameters — vendor-agnostic */
export interface InferenceConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
}

/** Retrieval parameters — vendor-agnostic */
export interface RetrievalConfig {
  strategy: "simplemem" | "lightmem" | "structmem" | "hybrid";
  topK: number;
  minSimilarity: number;
  graphMaxHops: number;
  semanticWeight: number;
  keywordWeight: number;
  freshnessDecay: number;
  /** Which corpora to search (maps to LoCoMo dialog/observation/summary) */
  corpora: ("raw" | "observation" | "summary" | "event_graph")[];
}

/** Hierarchical agent configuration profile */
export interface AgentConfigProfile {
  /** Unique profile ID (UUID) */
  id: string;
  /** Human-readable name */
  name: string;
  /** Version for evolution tracking */
  version: number;
  /** Parent profile ID for inheritance (null = root) */
  parentId?: string;
  /** Inheritance mode */
  mergeStrategy: "shallow" | "deep" | "replace";

  /** Agent identity */
  persona: {
    roleId?: string;              // from GMPL RoleRegistry
    personalitySummary?: string;
    expertiseDomains?: string[];
    trustLevel: 0 | 1 | 2 | 3;
  };

  /** Model stack — can be concrete or capability-driven */
  modelStack: {
    llm: ModelSpec;
    embedding: ModelSpec;
    inference: InferenceConfig;
  };

  /** Memory & retrieval configuration */
  memoryProfile: RetrievalConfig;

  /** Distilled skills to inject */
  injectedSkillIds: string[];

  /** Tool permissions (MCP/ACP) */
  toolPermissions: {
    recall: boolean;
    search: boolean;
    webSearch: boolean;
    manage: boolean;
    gmpl_run_pattern: boolean;
    gmpl_resolve_outcome: boolean;
  };

  /** Benchmark-specific metadata (optional extension) */
  benchmarkMeta?: {
    benchmark: string;
    task: string;
    corpus?: string;
  };

  /** Audit trail */
  createdAt: string;
  updatedAt: string;
  createdBy: string; // workflow name, user id, or "evolution_loop"
}
```

### 1.3 Capability-to-Model Resolution

Create `src/config/llm-capabilities.toml` and `src/config/embedding-capabilities.toml`:

```toml
# llm-capabilities.toml
# Maps capability tags to concrete models per provider.
# When an agent requests "reasoning", the resolver picks the best match
# for the available provider.

[capabilities.reasoning]
ollama = "qwen3.5:9b"
openrouter = "anthropic/claude-3.5-sonnet"
openai = "gpt-4o"

description = "Highest quality reasoning. Use for synthesis, validation, and complex extraction."

[capabilities.fast]
ollama = "llama3.2:3b"
openrouter = "meta-llama/llama-3.2-3b-instruct"
openai = "gpt-4o-mini"

description = "Low-latency responses. Use for classification, routing, and simple extraction."

[capabilities.cheap]
ollama = "phi3:mini"
openrouter = "google/gemma-2-2b-it"
openai = "gpt-4o-mini"

description = "Minimize cost. Use for high-volume batch processing."

[capabilities.vision]
ollama = "llava:13b"
openrouter = "anthropic/claude-3.5-sonnet"
openai = "gpt-4o"

description = "Image understanding. Use when multimodal input is present."
```

**Resolver function** (`src/core/ConfigResolver.ts`):
```typescript
export function resolveModelSpec(
  capability: LLMCapability,
  provider: GlobalConfig["llmProvider"],
): ModelSpec {
  const table = loadCapabilityTable();
  const model = table[capability]?.[provider];
  if (!model) {
    throw new Error(`No model for capability "${capability}" on provider "${provider}"`);
  }
  return { provider, model, capabilities: [capability] };
}
```

This means workflows can be written vendor-agnostically:
```json
{
  "module": "AnswerGenerator",
  "config": {
    "llmCapability": "reasoning",
    "temperature": 0.2
  }
}
```
The module calls `ctx.getLLMByCapability("reasoning", { temperature: 0.2 })` instead of hardcoding `gpt-4o`.

### 1.4 Recording Config in Memgraph

**New node labels:**

```cypher
:AgentProfile {
  id, name, version, mergeStrategy,
  personaRoleId, personaSummary, personaTrustLevel,
  llmProvider, llmModel, llmCapabilities,
  embeddingProvider, embeddingModel, embeddingCapabilities,
  inferenceTemperature, inferenceMaxTokens, inferenceTopP,
  memoryStrategy, retrievalTopK, retrievalMinSimilarity,
  corpora, // JSON array
  injectedSkillIds, // JSON array
  toolPermissions, // JSON object
  benchmarkMeta, // JSON object
  createdAt, updatedAt, createdBy
}

:LLMConfiguration {
  id, provider, model, baseUrl, capabilities,
  temperature, maxTokens, topP,
  costPer1KInputTokens, costPer1KOutputTokens, // optional cost tracking
  createdAt
}

:EmbeddingConfiguration {
  id, provider, model, dimensions, maxSeqLen, capabilities,
  createdAt
}

:ConfigInheritance {
  fromProfileId, toProfileId, mergeStrategy, diffJson
}

// Edges
(:AgentProfile)-[:USES_LLM]->(:LLMConfiguration)
(:AgentProfile)-[:USES_EMBEDDING]->(:EmbeddingConfiguration)
(:AgentProfile)-[:INHERITS_FROM]->(:AgentProfile)
(:WorkflowExecution)-[:RAN_WITH]->(:AgentProfile)
(:BenchmarkResult)-[:PRODUCED_BY]->(:AgentProfile)
```

**Why this matters:**
- After 100 benchmark runs, query: `MATCH (b:BenchmarkResult)-[:PRODUCED_BY]->(p:AgentProfile) WHERE p.llmProvider = "ollama" RETURN avg(b.score)`
- Find root cause: `MATCH (e:WorkflowExecution {status:"error"})-[:RAN_WITH]->(p:AgentProfile) RETURN p.llmModel, count(e) ORDER BY count(e) DESC`
- Evolution loop queries: `MATCH (p:AgentProfile)-[:INHERITS_FROM*]->(root) WHERE p.benchmarkMeta.benchmark = "locomo" RETURN p.name, p.inferenceTemperature, p.score`

### 1.5 `WorkflowContext` Provider Cache Upgrade

Current:
```typescript
getLLM(moduleConfig?: { llmProvider?: string; llmModel?: string }): BaseChatModel {
  const cacheKey = `${provider}:${model}`;
  // ...
}
```

Proposed:
```typescript
getLLM(spec?: ModelSpec | LLMCapability, inference?: InferenceConfig): BaseChatModel {
  let resolved: ModelSpec;
  if (typeof spec === "string") {
    // spec is a capability tag
    resolved = resolveModelSpec(spec, this.globalConfig.llmProvider ?? "ollama");
  } else {
    resolved = spec ?? { provider: this.globalConfig.llmProvider!, model: this.globalConfig.llmModel! };
  }

  // Include inference params in cache key so temperature changes get different instances
  const cacheKey = `${resolved.provider}:${resolved.model}:${JSON.stringify(inference ?? {})}`;
  if (!this.llmCache.has(cacheKey)) {
    this.llmCache.set(cacheKey, createLLM({ ...resolved, ...inference }));
  }
  return this.llmCache.get(cacheKey)!;
}
```

**Embedding remains a singleton** (vectors are incompatible across models), but we record which embedding config was used:
```typescript
recordEmbeddingConfig(): string {
  // Returns a config ID that gets attached to :Chunk and :MemoryUnit nodes
  // so we can later query "which embedding model produced this vector?"
  return `${this.globalConfig.embeddingProvider}:${this.embeddingModel}`;
}
```

### 1.6 File Inventory (Config System)

**New files:**
```
src/core/ConfigResolver.ts              # Capability → ModelSpec resolution
src/core/AgentConfigProfile.ts          # Profile CRUD + inheritance merging
src/config/llm-capabilities.toml        # Capability-to-model mapping
src/config/embedding-capabilities.toml  # Capability-to-embedding mapping
src/modules/core/ConfigProfilerModule.ts # Materializes profile onto data bus
src/server/routes/agent-profiles.ts     # REST API for profile CRUD
src/tests/unit/core/ConfigResolver.test.ts
src/tests/unit/core/AgentConfigProfile.test.ts
```

**Modified files:**
```
src/core/types.ts                       # Add AgentConfigProfile, ModelSpec, etc.
src/core/WorkflowContext.ts             # getLLM() accepts ModelSpec/capability
src/server/api.ts                       # Add /api/v1/agent-profiles routes
src/server/routes/solutions.ts          # Add agentProfileId to Solution
```

---

## 2. Phase 1: Data & Ingestion Integration

### 2.1 Dataset Preprocessing

Before ingestion, preprocess `locomo10.json` to fix the adversarial bug and normalize schema:

```typescript
// src/modules/benchmark/LoCoMoPreprocessor.ts

interface PreprocessedLoCoMo {
  sampleId: string;
  speakers: [string, string];
  sessions: LoCoMoSession[];
  qaPairs: LoCoMoQA[];
  eventSummaries: LoCoMoEventSummary[];
  observations: LoCoMoObservation[];
  sessionSummaries: Record<string, string>;
}

interface LoCoMoQA {
  id: string;
  question: string;
  answer: string;           // FIXED: derived for cat 5
  adversarialAnswer?: string; // preserved for reference
  category: 1 | 2 | 3 | 4 | 5;
  evidenceDialogIds: string[];
  sessionIds: string[];
  evalMode: "f1" | "f1_comma_split" | "binary" | "llm_judge";
}
```

**Preprocessing rules:**
1. **Category 5 fix:** For questions with `adversarial_answer` but no `answer`:
   - Set `evalMode: "llm_judge"`
   - Set `answer: ""` (empty — judge will evaluate from context)
   - Preserve `adversarialAnswer` for reference
   - Log warning: `44/446 adversarial questions lack ground truth; using LLM judge`
2. **Category 3 fix:** Split ground truth on `;`, keep first part (matches official eval)
3. **Category 1:** Mark `evalMode: "f1_comma_split"`
4. **Categories 2, 4:** Mark `evalMode: "f1"`
5. **Evidence normalization:** Strip parentheses from dialog IDs (some have `(D1:3)`)

**Output:** `data/benchmarks/locomo/locomo10-preprocessed.json`

### 2.2 New Module: `LoCoMoIngestorModule`

**File:** `src/modules/benchmark/LoCoMoIngestorModule.ts`

**Responsibility:** Load preprocessed dataset, create graph schema, emit chunks + memory units.

**Config Schema:**
```typescript
const ConfigSchema = z.object({
  datasetPath: z.string().default("data/benchmarks/locomo/locomo10-preprocessed.json"),
  conversationIds: z.array(z.string()).optional(),
  includeObservations: z.boolean().default(true),
  includeSessionSummaries: z.boolean().default(true),
  includeEventGraphs: z.boolean().default(true),
  agentProfileId: z.string().optional(), // which profile is running this ingestion
});
```

**Graph schema additions:**
```cypher
// Benchmark-specific nodes
:BenchmarkRun {
  id, benchmark: "locomo", task, agentProfileId,
  modelStackJson, // snapshot of resolved ModelSpec at run time
  startedAt, completedAt, status
}
:BenchmarkResult {
  id, runId, task, metric, score, category,
  conversationId, questionId, // granular
  agentProfileId
}
:LoCoMoConversation {
  id, sampleId, speakerA, speakerB,
  sessionCount, turnCount, qaCount
}
:LoCoMoSession {
  id, conversationId, sessionNum, date, turnIndexStart, turnCount
}
:LoCoMoTurn {
  id, conversationId, sessionId, speaker, text, timestamp, diaId,
  hasImage, blipCaption, imageQuery
}
:LoCoMoQA {
  id, conversationId, question, answer, category, evalMode,
  evidenceDialogIds, // JSON array
  adversarialAnswer // null for non-adversarial
}
:LoCoMoEvent {
  id, conversationId, sessionId, speaker, description,
  cause, effect, temporalRelation
}

// Edges
(:LoCoMoConversation)-[:HAS_SESSION]->(:LoCoMoSession)
(:LoCoMoSession)-[:NEXT_SESSION]->(:LoCoMoSession)
(:LoCoMoSession)-[:HAS_TURN]->(:LoCoMoTurn)
(:LoCoMoTurn)-[:NEXT]->(:LoCoMoTurn)
(:LoCoMoTurn)-[:MENTIONS]->(:Entity)
(:LoCoMoConversation)-[:HAS_QA]->(:LoCoMoQA)
(:LoCoMoConversation)-[:HAS_EVENT]->(:LoCoMoEvent)
(:LoCoMoEvent)-[:CAUSES]->(:LoCoMoEvent)
(:LoCoMoEvent)-[:PRECEDES]->(:LoCoMoEvent)
(:BenchmarkRun)-[:EVALUATED]->(:BenchmarkResult)
(:BenchmarkRun)-[:RAN_WITH]->(:AgentProfile)
```

**Process logic:**
1. Load preprocessed dataset
2. For each conversation, create `:LoCoMoConversation` node
3. Create `:LoCoMoSession` chain with `:NEXT_SESSION` edges
4. Create `:LoCoMoTurn` nodes with `:NEXT` edges within session
5. If `includeObservations`, create `:MemoryUnit {type: "observation"}` per fact
6. If `includeSessionSummaries`, create `:MemoryUnit {type: "summary"}` per session
7. If `includeEventGraphs`, create `:LoCoMoEvent` nodes with `:CAUSES`/`:PRECEDES`
8. Create `:BenchmarkRun` node linked to `:AgentProfile` (if provided)
9. Emit `documents`, `memoryUnits`, `entities`, `relationships` to data bus

### 2.3 Sub-Workflow: `locomo-ingest.json`

```json
{
  "name": "locomo-ingest",
  "version": "1.0",
  "description": "Ingest LoCoMo conversations into Memgraph with full graph indexing.",
  "entry": "load",
  "stages": [
    {
      "id": "load",
      "module": "LoCoMoIngestor",
      "config": { "includeObservations": true, "includeEventGraphs": true },
      "next": "embed"
    },
    {
      "id": "embed",
      "module": "Embedder",
      "config": { "capability": "general" },
      "next": "graph"
    },
    {
      "id": "graph",
      "module": "SubWorkflow",
      "workflowRef": "src/workflows/sub/graph-indexing.json",
      "inputMap": { "chunks": "chunks", "embeddings": "embeddings" },
      "outputMap": { "entities": "entities", "relationships": "relationships" },
      "next": "memory"
    },
    {
      "id": "memory",
      "module": "SubWorkflow",
      "workflowRef": "src/workflows/sub/structmem-pipeline.json",
      "inputMap": { "memoryUnits": "memoryUnits" },
      "outputMap": { "memoryUnits": "memoryUnits" }
    }
  ],
  "globalConfig": {
    "llmCapability": "reasoning",
    "embeddingCapability": "general"
  }
}
```

Note: `globalConfig` now uses **capabilities** instead of concrete models. The `ConfigResolver` maps these at runtime.

---

## 3. Phase 2: Benchmark Tasks as Executable Workflows

### 3.1 QA Task Workflow: `locomo-qa-eval.json`

```json
{
  "name": "locomo-qa-eval",
  "version": "1.0",
  "entry": "load_qa",
  "stages": [
    {
      "id": "load_qa",
      "module": "LoCoMoQAProvider",
      "config": { "categories": [1, 2, 3, 4], "skipCat5": true },
      "next": "for_each"
    },
    {
      "id": "for_each",
      "module": "SubWorkflow",
      "workflowRef": "src/workflows/sub/benchmark/locomo-qa-per-question.json",
      "inputMap": { "questions": "questions", "agentProfile": "agentProfile" },
      "outputMap": { "qaScores": "qaScores" },
      "next": "aggregate"
    },
    {
      "id": "aggregate",
      "module": "LoCoMoMetricsAggregator",
      "config": { "groupBy": ["category", "conversationId"] }
    }
  ]
}
```

**Per-question sub-workflow** (`locomo-qa-per-question.json`):
```json
{
  "name": "locomo-qa-per-question",
  "version": "1.0",
  "entry": "retrieve",
  "stages": [
    {
      "id": "retrieve",
      "module": "SubWorkflow",
      "workflowRef": "src/workflows/sub/hybrid-retrieval.json",
      "inputMap": { "query": "question" },
      "outputMap": { "retrievalResult": "retrievalResult" },
      "next": "generate"
    },
    {
      "id": "generate",
      "module": "AnswerGenerator",
      "config": { "citationMode": true, "llmCapability": "reasoning" },
      "next": "validate"
    },
    {
      "id": "validate",
      "module": "HallucinationValidator",
      "config": { "llmCapability": "fast" },
      "next": "score"
    },
    {
      "id": "score",
      "module": "LoCoMoQAScorer",
      "config": { "metric": "f1", "usePorterStemmer": true }
    }
  ]
}
```

### 3.2 New Scorer: `LoCoMoQAScorerModule`

**File:** `src/modules/benchmark/LoCoMoQAScorerModule.ts`

Port the official scoring logic exactly:
```typescript
function normalizeAnswer(s: string): string {
  return s
    .replace(/,/g, "")
    .toLowerCase()
    .replace(/\b(a|an|the|and)\b/g, " ")
    .replace(/[\p{P}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function f1Score(prediction: string, groundTruth: string): number {
  const predTokens = normalizeAnswer(prediction).split(/\s+/).map(porterStem);
  const gtTokens = normalizeAnswer(groundTruth).split(/\s+/).map(porterStem);
  const common = intersectionCount(predTokens, gtTokens);
  if (common === 0) return 0;
  const precision = common / predTokens.length;
  const recall = common / gtTokens.length;
  return (2 * precision * recall) / (precision + recall);
}

function multiHopF1(prediction: string, groundTruth: string): number {
  const preds = prediction.split(",").map(s => s.trim());
  const gts = groundTruth.split(",").map(s => s.trim());
  return mean(gts.map(gt => max(preds.map(p => f1Score(p, gt)))));
}
```

**Category-specific routing:**
| Category | Eval Mode | Function |
|---|---|---|
| 1 (multi-hop) | `f1_comma_split` | `multiHopF1(pred, answer)` |
| 2 (temporal) | `f1` | `f1Score(pred, answer)` |
| 3 (commonsense) | `f1` | `f1Score(pred, answer.split(';')[0])` |
| 4 (single-hop) | `f1` | `f1Score(pred, answer)` |
| 5 (adversarial) | `llm_judge` | `llmJudge(pred, context, evidence)` |

**LLM Judge for Category 5:**
- TOML prompt: `src/prompts/benchmark/locomo-qa-judge-cat5.toml`
- Input: conversation context + evidence turns + model prediction
- Output: `{ "correct": boolean, "reasoning": string }`
- Score: 1 if correct, 0 if wrong

### 3.3 Event Summarization Workflow: `locomo-event-eval.json`

Since LoCoMo has no released event evaluator, we build one:

```json
{
  "name": "locomo-event-eval",
  "version": "1.0",
  "entry": "load_conv",
  "stages": [
    {
      "id": "load_conv",
      "module": "LoCoMoConversationProvider",
      "config": {},
      "next": "extract"
    },
    {
      "id": "extract",
      "module": "SubWorkflow",
      "workflowRef": "src/workflows/sub/structmem-pipeline.json",
      "inputMap": { "memoryUnits": "conversationMemoryUnits" },
      "outputMap": { "memoryUnits": "predictedEvents" },
      "next": "compare"
    },
    {
      "id": "compare",
      "module": "LoCoMoEventComparator",
      "config": { "llmCapability": "reasoning" },
      "next": "score"
    },
    {
      "id": "score",
      "module": "LoCoMoEventScorer",
      "config": { "metrics": ["event_coverage", "causal_accuracy", "temporal_consistency"] }
    }
  ]
}
```

**Event comparison logic:**
1. Extract predicted events from StructMem output
2. For each ground-truth event, find the best-matching predicted event via:
   - Exact string match (normalized)
   - LLM semantic similarity: `src/prompts/benchmark/locomo-event-match.toml`
3. Causal edge comparison: check if predicted `:CAUSES` edges exist between matched events
4. Temporal edge comparison: check if predicted `:PRECEDES` edges match ground truth

### 3.4 RAG Variant Matrix

LoCoMo tests 3 corpora. In MemFlow, these are 3 different `RetrievalConfig.corpora` settings:

| Corpus | `corpora` | Ingestion Target | Retrieval Target |
|---|---|---|---|
| Raw dialogs | `["raw"]` | `:LoCoMoTurn.text` | Vector + keyword on `:LoCoMoTurn` |
| Observations | `["observation"]` | `:MemoryUnit {type:"observation"}` | Vector on `:MemoryUnit` |
| Summaries | `["summary"]` | `:MemoryUnit {type:"summary"}` | Vector + graph on `:MemoryUnit` |

The QA eval workflow stays identical; only the agent profile's `memoryProfile.corpora` changes.

### 3.5 CLI with Config Profiles

```bash
# Create a vendor-agnostic agent profile
bun run memflow agent-profile create \
  --name="locomo-qa-reasoning" \
  --llm-capability=reasoning \
  --embedding-capability=general \
  --memory-strategy=structmem \
  --corpora=observation

# Run benchmark with profile
bun run benchmark locom --task=qa --profile=locomo-qa-reasoning

# Run matrix: all combinations of 3 memory strategies × 3 corpora
bun run benchmark locom --task=qa --matrix='{"memoryStrategy":["simplemem","lightmem","structmem"],"corpora":[["raw"],["observation"],["summary"]]}'

# Override capability at runtime (still vendor-agnostic)
bun run benchmark locom --task=qa --profile=locomo-qa-reasoning --llm-capability=fast
```

### 3.6 REST API Endpoints

```typescript
// POST /api/v1/agent-profiles
// Body: { name, llmCapability, embeddingCapability, memoryStrategy, corpora, ... }
// Returns: { profileId }

// GET /api/v1/agent-profiles/:id
// Returns: full AgentConfigProfile with resolved ModelSpecs

// POST /api/v1/benchmarks/locomo/run
// Body: { task: "qa" | "event" | "all", agentProfileId: string }
// Returns: { runId, status }

// GET /api/v1/benchmarks/locomo/runs/:runId
// Returns: BenchmarkRun with nested BenchmarkResult nodes + AgentProfile snapshot

// GET /api/v1/benchmarks/locomo/leaderboard
// Query: ?groupBy=llmCapability,memoryStrategy
// Returns: aggregated scores with AgentProfile breakdowns
```

### 3.7 Prometheus Metrics

```typescript
// Existing metrics extended with agent profile labels
export const benchmarkRunsCounter = new Counter({
  name: "memflow_benchmark_runs_total",
  help: "Total benchmark runs",
  labelNames: ["benchmark", "task", "llm_capability", "embedding_capability", "memory_strategy"],
  registers: [register],
});

export const benchmarkScoreGauge = new Gauge({
  name: "memflow_benchmark_score",
  help: "Latest benchmark score",
  labelNames: ["benchmark", "task", "metric", "category", "llm_capability", "memory_strategy"],
  registers: [register],
});

// New: provider-specific cost/latency tracking
export const llmInvocationCounter = new Counter({
  name: "memflow_llm_invocations_total",
  help: "LLM calls by capability and resolved provider/model",
  labelNames: ["capability", "provider", "model", "module"],
  registers: [register],
});

export const llmLatencyHistogram = new Histogram({
  name: "memflow_llm_latency_seconds",
  help: "LLM latency by capability",
  labelNames: ["capability", "provider", "model"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});
```

---

## 4. Phase 3: Evolutionary Optimization Loop

### 4.1 Closed Loop with Config Inheritance

The evolution loop now mutates **agent profiles**, not just prompts:

```
Baseline Profile (p0)
  ├── llmCapability: reasoning
  ├── memoryStrategy: structmem
  └── corpora: [observation]
       │
       ▼
    Benchmark Run → Score 0.38
       │
       ▼
    SkillGapAnalyzer: "temporal reasoning weak"
       │
       ▼
    Mutated Profile (p1) — INHERITS from p0
      ├── llmCapability: reasoning  (inherited)
      ├── memoryStrategy: structmem (inherited)
      ├── corpora: [observation, event_graph]  (mutated)
      └── injectedSkillIds: ["temporal-hop-v3"]  (new)
       │
       ▼
    Benchmark Run → Score 0.45
       │
       ▼
    OutcomeLearner: reward = +0.07 → PROMOTE p1
       │
       ▼
    Trace2Skill: distill "add event_graph for temporal QA"
       │
       ▼
    SLMDatasetExporter: export hard temporal examples
```

### 4.2 Mutations the Loop Can Apply

| Mutation Target | What Changes | Impact |
|---|---|---|
| `llmCapability` | `fast` → `reasoning` | Better synthesis, higher cost |
| `memoryStrategy` | `simplemem` → `structmem` | Better causal/temporal recall |
| `corpora` | add `"event_graph"` | Multi-source retrieval |
| `inference.temperature` | 0.1 → 0.3 | More creative answers |
| `retrievalProfile.graphMaxHops` | 2 → 4 | Deeper multi-hop retrieval |
| `injectedSkillIds` | add `"temporal-hop-v3"` | Prompt-level strategy |

### 4.3 Workflow: `locomo-evolution-loop.json`

```json
{
  "name": "locomo-evolution-loop",
  "version": "1.0",
  "entry": "baseline",
  "stages": [
    {
      "id": "baseline",
      "module": "SubWorkflow",
      "workflowRef": "src/workflows/examples/locomo-benchmark.json",
      "outputMap": { "metrics": "baselineMetrics" },
      "next": "profile_snapshot"
    },
    {
      "id": "profile_snapshot",
      "module": "ConfigProfiler",
      "config": { "persistToGraph": true },
      "next": "gap_analysis"
    },
    {
      "id": "gap_analysis",
      "module": "SkillGapAnalyzer",
      "config": { "targetBenchmark": "locomo", "minCoverage": 0.6 },
      "next": "mutate"
    },
    {
      "id": "mutate",
      "module": "ProfileMutator",
      "config": { "maxMutations": 2, "mutationTypes": ["corpora", "graphMaxHops", "injectedSkillIds"] },
      "next": "validate"
    },
    {
      "id": "validate",
      "module": "SubWorkflow",
      "workflowRef": "src/workflows/examples/locomo-benchmark.json",
      "inputMap": { "agentProfile": "mutatedProfile" },
      "outputMap": { "metrics": "mutatedMetrics" },
      "next": "compare"
    },
    {
      "id": "compare",
      "module": "OutcomeLearner",
      "config": { "rewardThreshold": 0.03 },
      "next": "distill"
    },
    {
      "id": "distill",
      "module": "Trace2Skill",
      "config": { "k": 5 },
      "next": "export"
    },
    {
      "id": "export",
      "module": "SLMDatasetExporter",
      "config": { "format": "both", "minConfidence": 0.8 },
      "next": null
    }
  ],
  "meta": {
    "learning": true,
    "maxIterations": 10,
    "metrics": ["qa_f1", "event_coverage", "hallucination_rate"]
  }
}
```

**New module: `ProfileMutatorModule`** (`src/modules/evolution/ProfileMutatorModule.ts`)
- Takes `AgentConfigProfile` + `skillGaps` as input
- Applies 1-2 mutations from allowed set
- Creates new profile with `parentId` pointing to original
- Persists to `:AgentProfile` node with `:INHERITS_FROM` edge

---

## 5. Phase 4: Reporting, CI, and Extensibility

### 5.1 Benchmark Report Format

```json
{
  "benchmark": "locomo",
  "runId": "uuid",
  "agentProfile": {
    "id": "uuid",
    "name": "locomo-qa-reasoning",
    "llmCapability": "reasoning",
    "resolvedLlm": { "provider": "openrouter", "model": "anthropic/claude-3.5-sonnet" },
    "embeddingCapability": "general",
    "resolvedEmbedding": { "provider": "ollama", "model": "nomic-embed-text" },
    "memoryStrategy": "structmem",
    "corpora": ["observation"]
  },
  "timestamp": "2026-05-06T...",
  "qa": {
    "overall": { "f1": 0.38, "count": 1540, "categoriesIncluded": [1,2,3,4] },
    "byCategory": {
      "1_multi_hop": { "f1": 0.28, "count": 282 },
      "2_temporal": { "f1": 0.22, "count": 321 },
      "3_commonsense": { "f1": 0.41, "count": 96 },
      "4_single_hop": { "f1": 0.52, "count": 841 }
    },
    "cat5_excluded": {
      "reason": "dataset_ground_truth_incomplete",
      "llmJudgeExperimental": { "accuracy": 0.31, "count": 446 }
    }
  },
  "event": {
    "eventCoverage": 0.55,
    "causalAccuracy": 0.48,
    "temporalConsistency": 0.61
  },
  "latencyMs": { "p50": 1200, "p95": 4500 }
}
```

### 5.2 Memgraph Query Patterns for Analysis

```cypher
// Which capability gives best temporal QA?
MATCH (b:BenchmarkResult {task: "qa", category: 2})-[:PRODUCED_BY]->(p:AgentProfile)
RETURN p.llmCapability, avg(b.score) as avg_f1, count(b) as n
ORDER BY avg_f1 DESC;

// Which memory strategy is most cost-effective?
MATCH (b:BenchmarkResult)-[:PRODUCED_BY]->(p:AgentProfile)
MATCH (p)-[:USES_LLM]->(llm:LLMConfiguration)
WITH p.memoryStrategy, avg(b.score) as score,
     avg(llm.costPer1KInputTokens) as cost
RETURN p.memoryStrategy, score, cost, score/cost as efficiency
ORDER BY efficiency DESC;

// Find configs that cause hallucination spikes
MATCH (e:WorkflowExecution {status: "complete"})-[:RAN_WITH]->(p:AgentProfile)
MATCH (e)-[:PRODUCED]->(b:BenchmarkResult {metric: "hallucination_rate"})
WHERE b.score > 0.3
RETURN p.llmCapability, p.memoryStrategy, p.inferenceTemperature, count(e) as failures
ORDER BY failures DESC;

// Trace evolution of a profile family
MATCH path = (child:AgentProfile)-[:INHERITS_FROM*]->(root:AgentProfile {name: "locomo-baseline"})
RETURN path, child.version, child.benchmarkMeta.score
ORDER BY child.version;
```

### 5.3 GitHub Action

```yaml
name: LoCoMo Benchmark
on:
  schedule: [{ cron: "0 2 * * 0" }]
  pull_request:
    paths: ["src/modules/memory/**", "src/modules/retrieval/**", "src/modules/graph/**"]
  workflow_dispatch:
    inputs:
      llmCapability: { default: "reasoning" }
      memoryStrategy: { default: "structmem" }

jobs:
  benchmark:
    runs-on: ubuntu-latest
    services:
      memgraph: { image: memgraph/memgraph-mage, ports: ["7687:7687"] }
      ollama: { image: ollama/ollama, ports: ["11434:11434"] }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: |
          bun run benchmark locom --task=all \
            --llm-capability=${{ inputs.llmCapability || 'reasoning' }} \
            --memory-strategy=${{ inputs.memoryStrategy || 'structmem' }} \
            --output=file --outputPath=report.json
      - uses: actions/upload-artifact@v4
        with: { name: locomo-report, path: report.json }
      - name: Comment PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const r = require('./report.json');
            const body = `## 🤖 LoCoMo Benchmark\n| Metric | Score |\n|---|---|\n| QA F1 | ${r.qa.overall.f1} |\n| Temporal F1 | ${r.qa.byCategory['2_temporal'].f1} |\n| Event Coverage | ${r.event.eventCoverage} |\n\n**Config:** ${r.agentProfile.llmCapability} + ${r.agentProfile.memoryStrategy}`;
            github.rest.issues.createComment({ ...context.issue, body });
```

### 5.4 Desktop App Dashboard

New "Benchmarks" tab shows:
- Line chart: `score` over `version` for profile families
- Matrix heatmap: `llmCapability` × `memoryStrategy` → QA F1
- Query explorer: Pre-built Cypher queries for pattern analysis
- Profile editor: Create/modify `AgentConfigProfile` with live validation

---

## 6. File Inventory (All Phases)

### New Files

```
src/core/ConfigResolver.ts
src/core/AgentConfigProfile.ts
src/config/llm-capabilities.toml
src/config/embedding-capabilities.toml

src/modules/benchmark/
├── LoCoMoPreprocessor.ts
├── LoCoMoIngestorModule.ts
├── LoCoMoQAProviderModule.ts
├── LoCoMoQAScorerModule.ts
├── LoCoMoMetricsAggregatorModule.ts
├── LoCoMoConversationProviderModule.ts
├── LoCoMoEventComparatorModule.ts
├── LoCoMoEventScorerModule.ts
├── LoCoMoReportGeneratorModule.ts

src/modules/evolution/
├── ProfileMutatorModule.ts

src/modules/core/
├── ConfigProfilerModule.ts

src/workflows/sub/benchmark/
├── locom-ingest.json
├── locom-qa-eval.json
├── locom-qa-per-question.json
├── locom-event-eval.json
├── locom-ingest-raw.json
├── locom-ingest-obs.json
├── locom-ingest-summaries.json

src/workflows/examples/
├── locom-benchmark.json
└── locom-evolution-loop.json

src/prompts/benchmark/
├── locomo-qa-judge-cat5.toml
├── locomo-event-compare.toml
├── locomo-event-match.toml

src/tests/unit/benchmark/
├── LoCoMoPreprocessor.test.ts
├── LoCoMoIngestor.test.ts
├── LoCoMoQAScorer.test.ts
├── LoCoMoEventComparator.test.ts

src/tests/integration/real-services/
├── locomo-ingest-real.test.ts
├── locomo-qa-real.test.ts
├── locomo-evolution-real.test.ts

src/server/routes/
├── agent-profiles.ts

src/cli/
└── benchmark.ts

data/benchmarks/locomo/
├── manifest.json
└── .gitignore

.github/workflows/
└── benchmark-locomo.yml

docs/
├── BENCHMARK_LOCOMO.md
└── AGENT_CONFIG_PROFILES.md
```

### Modified Files

```
src/core/types.ts                       # Add AgentConfigProfile, ModelSpec, etc.
src/core/WorkflowContext.ts             # getLLM() accepts capability or ModelSpec
src/core/ModuleRegistry.ts              # Register new modules

src/index.ts                            # Add "benchmark" and "agent-profile" CLI
src/server/api.ts                       # Add /api/v1/agent-profiles, /benchmarks/*
src/server/routes/solutions.ts          # Add agentProfileId to Solution
src/server/metrics.ts                   # Add benchmark_* + llm_* metrics

packages/desktop-app/src/App.tsx        # Add Benchmarks tab
```

---

## 7. Implementation Sequence

### Week 1: Config System Foundation

| Day | Task | Deliverable |
|---|---|---|
| 1 | Implement `ConfigResolver`, `AgentConfigProfile`, capability TOMLs | Config system core |
| 1-2 | Upgrade `WorkflowContext.getLLM()` to accept capabilities | Provider cache supports capabilities |
| 2-3 | Add `:AgentProfile`, `:LLMConfiguration`, `:EmbeddingConfiguration` to Memgraph schema | Graph schema updated |
| 3-4 | Implement `ConfigProfilerModule`, REST routes for agent profiles | Profile CRUD API |
| 4-5 | Tests + docs for config system | `AGENT_CONFIG_PROFILES.md` |

### Week 2: LoCoMo Ingestion + QA MVP

| Day | Task | Deliverable |
|---|---|---|
| 6 | Preprocess dataset (fix cat 5, normalize schema) | `locomo10-preprocessed.json` |
| 6-7 | Implement `LoCoMoPreprocessor` + `LoCoMoIngestorModule` | Ingestion module |
| 7-8 | Create `locomo-ingest.json`, test E2E | Integration test passes |
| 8-9 | Implement `LoCoMoQAProvider`, `LoCoMoQAScorer` (exact F1 port) | QA eval modules |
| 9-10 | Create `locomo-qa-eval.json`, run baseline | First score report |

### Week 3: Event Eval + RAG Matrix

| Day | Task | Deliverable |
|---|---|---|
| 11 | Implement `LoCoMoEventComparator` + `LoCoMoEventScorer` | Event eval modules |
| 12 | Create `locomo-event-eval.json` | Event workflow |
| 12-13 | Implement 3 RAG corpus variants (raw/obs/summary) | Corpus matrix ready |
| 13-14 | Add Prometheus metrics with agent profile labels | Metrics visible |
| 14-15 | CLI `benchmark locom` with profile support | CLI usable |

### Week 4: Evolution Loop + CI

| Day | Task | Deliverable |
|---|---|---|
| 16 | Implement `ProfileMutatorModule` | Config mutations |
| 17 | Create `locomo-evolution-loop.json` | Evolution workflow |
| 17-18 | Wire `SkillGapAnalyzer` + `HarnessEvolver` to profiles | Benchmark-aware evolution |
| 18-19 | GitHub Action + PR comments | CI posts scores |
| 19-20 | First autonomous optimization run | Score improvement tracked |

### Week 5: Polish + Dashboard

| Day | Task | Deliverable |
|---|---|---|
| 21 | Desktop app Benchmarks tab | UI charting |
| 22 | Memgraph query explorer | Pre-built analytics queries |
| 23 | Full test coverage | >80% on new modules |
| 24 | Documentation | `BENCHMARK_LOCOMO.md` + updated `ARCHITECTURE.md` |
| 25 | Buffer for issues, validation | Known issues documented |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| LoCoMo adversarial answers broken | Skip cat 5 for parity scoring; use LLM judge for experimental metric. Document in all reports. |
| Category 5 LLM judge is expensive | Make optional; default to F1 on categories 1-4 only. Cache judge results. |
| Event eval has no ground-truth code | Build our own comparator + document methodology. Community-review the scoring logic. |
| Config inheritance complexity | Start with 2-level inheritance (base → task). Deep chains deferred. |
| Embedding model singleton limits RAG matrix | Run each corpus variant as separate workflow with its own context (re-indexing is required anyway). |
| Evolution loop overfits to LoCoMo | Hold out 2 conversations (20%) from evolution; test only on held-out. |
| Cost tracking requires provider APIs | Start with static cost table in `llm-capabilities.toml`. Dynamic cost tracking deferred. |
| CC BY-NC 4.0 license | Include attribution in all reports. Do not redistribute dataset in Docker images. |

---

## 9. Success Criteria

- [ ] `bun run benchmark locom --task=qa --llm-capability=reasoning` runs end-to-end with vendor-agnostic config
- [ ] All 10 LoCoMo conversations ingestable with full graph schema
- [ ] QA F1 scores match official LoCoMo evaluator on categories 1-4 (±0.02 tolerance)
- [ ] Category 5 evaluated via LLM judge with reasoning traces
- [ ] Event summarization scores computed against ground-truth event graphs
- [ ] `:AgentProfile` + `:LLMConfiguration` nodes queryable in Memgraph
- [ ] At least one autonomous evolution iteration improves QA F1
- [ ] CI posts benchmark results on memory/retrieval PRs with profile breakdown
- [ ] Desktop app shows score trends over evolution iterations
- [ ] `ollama` and `openrouter` capabilities produce comparable benchmark reports without workflow changes

---

*Plan version 2.0 — incorporates corrected LoCoMo research, adversarial QA fixes, vendor-agnostic capability system, and Memgraph-config recording for pattern analysis.*
