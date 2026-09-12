/** The existing assistant tool vocabulary, shared with browser-hosted agents. */
import { KINDS } from '@jarenjs/studio';
import { AUTHORABLE_KINDS } from '@tangleai/jaren/studio';
import { playComponent } from './play.ts';
import { STUDIO_TEMPLATES } from './appTemplates.ts';
import { FLOW_TEMPLATES } from './flowTemplates.ts';
const engineKeys = playComponent.engineIds().filter(key => key !== 'validate');
export const TOOL_DEFINITIONS = [
  {
name: 'jaren_validate',
    description: 'Validate a JSON document against a JSON Schema with the Jaren validating compiler, loading both into #/play so the user sees the result. Pass `schema` as a real JSON object (not JSON text). Returns { valid, errors, draft, compileMs, validateMs }.',
    inputSchema: {
      type: 'object',
      properties: { schema: { type: ['object', 'boolean'] }, data: {} },
      required: ['schema'],
    }
},
  {
name: 'jaren_run_engine',
    description: `Run one of the Jaren play engines (${engineKeys.join(', ')}) with flat text inputs (JSON values as JSON text; each key is one of the engine's panes from jaren_list_engines), loading them into #/play so the user watches it run. JSON Schema validation is NOT an engine here — use jaren_validate for that. Returns the result panels the play stage itself shows ({ ok, panels, timing, error } — errors carry stable codes).`,
    inputSchema: {
      type: 'object',
      properties: {
        engine: { enum: engineKeys },
        inputs: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['engine', 'inputs'],
    }
},
  {
name: 'jaren_list_engines',
    description: 'List the available play engines with their input panes (source / data / option).',
    inputSchema: { type: 'object', properties: {} }
},
  {
name: 'jaren_get_state',
    description: 'Read what is currently on screen: the active page, and the working surface it carries — on #/play the selected engine and its pane texts, on #/project the project\'s files (with which one is open and which have errors). Call this before editing so you build on what the user already has.',
    inputSchema: { type: 'object', properties: {} }
},
  {
name: 'jaren_navigate',
    description: 'Navigate the site to a page, optionally with params (e.g. { page: "docs", params: { s: "query" } }).',
    inputSchema: {
      type: 'object',
      properties: {
        page: { enum: ['home', 'studio', 'project', 'play', 'flow', 'benchmarks', 'charts', 'docs', 'calculator'] },
        params: { type: 'object', additionalProperties: { type: 'string' } },
      },
      required: ['page'],
    }
},
  {
name: 'jaren_get_examples',
    description: 'Get the site\'s working examples for one engine — play\'s canonical library. Each is { label, inputs } and runs as-is through jaren_run_engine (engine \'validate\': pass the schema/data to jaren_validate instead). Before writing a program for an engine you have not used this conversation, fetch its examples and adapt one instead of guessing syntax. Pass `label` to get a single example.',
    inputSchema: {
      type: 'object',
      properties: { engine: { enum: playComponent.engineIds() }, label: { type: 'string' } },
      required: ['engine'],
    }
},
  {
name: 'jaren_project_files',
    description: 'The Studio project (#/project) is a TREE OF FILES — an app document beside the jslt/query/schema transforms and the state/data they run on. Without a name you get every file (kind, role, size, whether it validates, and its coded errors) plus which one is open. With a name you also get that file\'s full text. ALWAYS call this before answering anything about "the project", "my files" or "the studio" — the app document is only ONE of the files.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
    }
},
  {
name: 'jaren_project_author',
    description: 'Generate or revise ONE project file through provider-constrained JSON and the full grammar/compiler acceptance gate. Use this to author app, flow, model, query and stylesheet documents. Existing file references are preserved. A concurrent edit refuses publication and returns the candidate for recovery.',
    inputSchema: {
      type: 'object', properties: {
        name: { type: 'string', minLength: 1 },
        kind: { enum: [...AUTHORABLE_KINDS] }, prompt: { type: 'string', minLength: 1 }
      }, required: ['name', 'prompt']
    }
},
  {
name: 'jaren_project_write',
    description: 'Write exact JSON text to ONE project file and open it. A new file requires a kind: app, jslt, query, schema, state, data, contract, fsm, dag or model. Validation resolves imports and uses the full file compiler gate before publication. Existing routing and imports are preserved. Runnable files use their input/model route and return results. For generating new content, use jaren_project_author.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1 },
        kind: { enum: [...KINDS] },
        text: { type: 'string' },
      },
      required: ['name', 'text'],
    }
},
  {
name: 'jaren_project_run',
    description: 'Run a project file using its input/model route: query or stylesheet output, schema validation, contract projections, a pure FSM trace, DAG output, or SQLite results and query plan. Without a name the open file runs. App documents run interactively on the stage; state/data files supply inputs.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
    }
},
  {
name: 'jaren_studio_write',
    description: 'Load a COMPLETE @jarenjs/app document (state + JSLT view + actions as one JSON value) into the project IDE (#/project), where it becomes the project\'s app file and boots as a live app the user watches. The document is validated against the jaren-app meta-schema first; on failure you get the errors (with instancePaths) to repair. Start from jaren_get_templates and iterate with jaren_studio_patch instead of resending whole documents.',
    inputSchema: {
      type: 'object',
      properties: { doc: { type: 'object' } },
      required: ['doc'],
    }
},
  {
name: 'jaren_studio_patch',
    description: 'Modify the current Studio document with an RFC 6902 JSON Patch (applied by the suite\'s own patch engine). The patched result is re-validated against the meta-schema before it swaps in — an invalid result is rejected atomically and the current document stays live. Returns the new revision, or the errors to repair.',
    inputSchema: {
      type: 'object',
      properties: { patch: { type: 'array', items: { type: 'object' } } },
      required: ['patch'],
    }
},
  {
name: 'jaren_studio_read',
    description: 'Read the current Studio document, or one subtree of it via a JSON Pointer (e.g. { pointer: "/view/rules/0" }) — inspect narrowly instead of pulling the whole document into context.',
    inputSchema: {
      type: 'object',
      properties: { pointer: { type: 'string' } },
    }
},
  {
name: 'jaren_get_templates',
    description: 'The Studio seed library: complete, boot-tested @jarenjs/app documents (a validated form, a charts dashboard, a routed mini-site). Without a name you get the list; with a name, the full document — load it with jaren_studio_write and adapt it with jaren_studio_patch.',
    inputSchema: {
      type: 'object',
      properties: { name: { enum: STUDIO_TEMPLATES.map((t) => t.name) } },
    }
},
  {
name: 'jaren_flow_write',
    description: 'Load a COMPLETE executable workflow document into the Flow studio (#/flow), where it renders as a diagram and runs live. `kind` is "fsm" (a jaren-fsm state machine: initial, states, transitions with query-document guards) or "dag" (a jaren-dag dataflow: nodes of kind input/output/const/query/jslt/task, wired by edges). The document is validated against the schema AND compiled; on failure you get the errors (each with a JF/JQ/JT code and a docPath) to repair. Start from jaren_flow_get_templates.',
    inputSchema: {
      type: 'object',
      properties: { kind: { enum: ['fsm', 'dag'] }, doc: { type: 'object' } },
      required: ['kind', 'doc'],
    }
},
  {
name: 'jaren_flow_patch',
    description: 'Modify the current Flow document with an RFC 6902 JSON Patch (applied by the suite\'s own patch engine). The patched result is re-validated and re-compiled before it swaps in — an invalid result is rejected and the current document stays live. Returns ok, or the errors to repair.',
    inputSchema: {
      type: 'object',
      properties: { patch: { type: 'array', items: { type: 'object' } } },
      required: ['patch'],
    }
},
  {
name: 'jaren_flow_check',
    description: 'Validate and compile a workflow document WITHOUT loading it — a read-only verdict. Returns { ok: true } or the errors (code + docPath each). Use it to iterate a document before committing it with jaren_flow_write.',
    inputSchema: {
      type: 'object',
      properties: { kind: { enum: ['fsm', 'dag'] }, doc: { type: 'object' } },
      required: ['kind', 'doc'],
    }
},
  {
name: 'jaren_flow_get_templates',
    description: 'The Flow seed library: complete, runnable jaren-fsm and jaren-dag documents. Without a name you get the list; with a name, the full document and its kind — load it with jaren_flow_write and adapt it with jaren_flow_patch.',
    inputSchema: {
      type: 'object',
      properties: { name: { enum: FLOW_TEMPLATES.map((t) => t.name) } },
    }
},
  {
name: 'jaren_save_experiment',
    description: 'Save what is on screen under a name so the user keeps what you built together: on #/project the current project (the IDE store); anywhere else the current play session (the play store). Returns the updated saved names.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1 } },
      required: ['name'],
    }
},
  {
name: 'jaren_list_experiments',
    description: 'List the saved work: the IDE store\'s experiments (projects, plus any legacy studio or engine experiments) and the saved play sessions.',
    inputSchema: { type: 'object', properties: {} }
},
  {
name: 'jaren_load_experiment',
    description: 'Load a saved experiment by name: a project (or a legacy studio document) opens in #/project; a legacy engine experiment opens as the equivalent play session.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
},
  {
name: 'jaren_share_link',
    description: 'Build a share link that restores what is on screen (the project on #/project, the play session otherwise), and copy it to the clipboard.',
    inputSchema: { type: 'object', properties: {} }
}
];
