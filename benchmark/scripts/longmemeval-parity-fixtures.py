"""Run only pinned pure evaluator code over Tangle-authored inputs, offline."""
import ast
import contextlib
import hashlib
import io
import json
import pathlib
import platform
import runpy
import sys
import tempfile
import numpy

root = pathlib.Path(__file__).resolve().parents[2]
evaluator = root / 'benchmark/longmemeval/src/evaluation/evaluate_qa.py'
metrics = root / 'benchmark/longmemeval/src/evaluation/print_qa_metrics.py'
assert hashlib.sha256(evaluator.read_bytes()).hexdigest() == 'ecce9c4c79dc89d99534ac17b383a5cbb5b9f0c69ee98adaf0684742e3d95251'
assert hashlib.sha256(metrics.read_bytes()).hexdigest() == 'e9283933a0cefb7a0ded7365e436ae3d1be5aac41853325e6155d83bf07607f0'
tree = ast.parse(evaluator.read_text())
function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'get_anscheck_prompt')
namespace = {}
exec(compile(ast.Module(body=[function], type_ignores=[]), str(evaluator), 'exec'), namespace)
label = next(n.value for n in ast.walk(tree) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'label' for t in n.targets))
label_code = compile(ast.Expression(label), str(evaluator), 'eval')
types = ['single-session-user', 'single-session-assistant', 'single-session-preference', 'multi-session', 'temporal-reasoning', 'knowledge-update']
prompts = []
for task in types:
    for abstention in (False, True):
        for answer in ('Tangle fixture answer.', 11):
            inputs = dict(task=task, question='Tangle fixture question?', answer=answer, response='Tangle fixture prediction.', abstention=abstention)
            prompts.append(dict(**inputs, expected=namespace['get_anscheck_prompt'](**inputs)))
labels = [dict(response=s, expected=eval(label_code, {'eval_response': s.strip()})) for s in ['yes', 'YES', ' no ', '', 'yesterday', 'no, yes', 'unknown', 'no.']]
references = [dict(question_id=f'q{i}' + ('_abs' if i % 2 else ''), question_type=task) for i, task in enumerate(types * 2)]
answers = [dict(question_id=q['question_id'], autoeval_label=dict(model='gpt-4o-2024-08-06', label=i % 3 == 0)) for i, q in enumerate(references)]
with tempfile.TemporaryDirectory(prefix='lme-parity-') as temporary:
    path = pathlib.Path(temporary)
    (path / 'references.json').write_text(json.dumps(references))
    (path / 'answers.jsonl').write_text('\n'.join(json.dumps(a) for a in answers))
    saved = sys.argv
    sys.argv = [str(metrics), str(path / 'answers.jsonl'), str(path / 'references.json')]
    capture = io.StringIO()
    try:
        with contextlib.redirect_stdout(capture):
            runpy.run_path(str(metrics), run_name='__main__')
    finally:
        sys.argv = saved
    aggregation_output = capture.getvalue()
result = dict(generated=dict(mode='pinned-offline-official-code', python=platform.python_version(), numpy=numpy.__version__,
    evaluatorSha256=hashlib.sha256(evaluator.read_bytes()).hexdigest(), aggregationSha256=hashlib.sha256(metrics.read_bytes()).hexdigest()),
    prompts=prompts, labels=labels, aggregation=dict(references=references, answers=answers, officialOutput=aggregation_output,
      expected=dict(micro=0.3333, macro=0.3333, abstention=0.3333, byType={t: float(i % 3 == 0) for i, t in enumerate(types)})))
destination = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'test/fixtures/longmemeval-parity.json'
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(f'{len(prompts)} prompt branches, {len(labels)} labels, official aggregation executed; no provider imports or calls')
