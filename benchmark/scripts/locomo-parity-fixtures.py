#!/usr/bin/env python3
"""
The parity fixtures — produced by RUNNING the official
LoCoMo evaluator, never by reading it.

`benchmark/locomo/task_eval/evaluation.py` is loaded verbatim from the
submodule (with `bert_score` stubbed: the module imports it at the top
and only the BERTScore path calls it, which nothing here does) and asked
to score a hand-authored table of predictions; its answers are what
`test/fixtures/locomo-parity.json` records and what the TypeScript port
must reproduce. A fixture that had been derived by reading the code
would have to be labelled `derived` and could not close the order; this
one is labelled `oracle` because the numbers are the evaluator's own.

Three files:

  test/fixtures/locomo-parity.json             hand-authored cases: normalization
                                               strings, stems, F1 rows, the
                                               category-5 keyword rule — Tangle's
                                               own text, committed
  test/fixtures/locomo-parity-vocabulary.json  every token of every question and
                                               answer in the release, with the stem
                                               NLTK gives it — a sorted word list,
                                               not the text; committed
  test-output/locomo-parity-dataset.json       dataset-derived rows (gold turns as
                                               predictions) — REDISTRIBUTES
                                               LoCoMo text, so it is gitignored and
                                               only ever checked locally

    python3 benchmark/scripts/locomo-parity-fixtures.py
    python3 benchmark/scripts/locomo-parity-fixtures.py --require   # exit 1 without the submodule

Needs `nltk`, `regex` and `numpy` (`pip install nltk regex numpy`).
"""

import contextlib
import importlib.util
import json
import sys
import types
from pathlib import Path

# the submodule is a pointer, not a workspace: never leave bytecode in it
sys.dont_write_bytecode = True

ROOT = Path(__file__).resolve().parents[2]
EVALUATOR = ROOT / 'benchmark/locomo/task_eval/evaluation.py'
DATASET = ROOT / 'benchmark/locomo/data/locomo10.json'
FIXTURE = ROOT / 'test/fixtures/locomo-parity.json'
VOCABULARY = ROOT / 'test/fixtures/locomo-parity-vocabulary.json'
DATASET_ROWS = ROOT / 'test-output/locomo-parity-dataset.json'

require = '--require' in sys.argv[1:]
if not EVALUATOR.exists():
    print(f'skipped — {EVALUATOR.relative_to(ROOT)} is absent; git submodule update --init benchmark/locomo')
    sys.exit(1 if require else 0)

# the module imports bert_score at the top; only bert_score() uses it
sys.modules['bert_score'] = types.SimpleNamespace(
    score=lambda *a, **k: (_ for _ in ()).throw(RuntimeError('bert_score is stubbed; the parity fixtures never call it')))
spec = importlib.util.spec_from_file_location('locomo_evaluation', EVALUATOR)
official = importlib.util.module_from_spec(spec)
spec.loader.exec_module(official)

import nltk  # noqa: E402
import numpy  # noqa: E402
import regex  # noqa: E402

META = {
    'mode': 'oracle',
    'evaluator': 'benchmark/locomo/task_eval/evaluation.py',
    'stemmer': f'nltk.stem.PorterStemmer mode={official.ps.mode}',
    'python': sys.version.split()[0],
    'nltk': nltk.__version__,
    'regex': regex.__version__,
    'numpy': numpy.__version__,
    'command': 'python3 benchmark/scripts/locomo-parity-fixtures.py',
    'lowerCaseMismatches': 'str.lower() and String.prototype.toLowerCase() disagree on U+A7CE, U+A7D2, U+A7D4 and U+16EA0–U+16EB8 (measured over every code point, 2026-08-27); none occur in the release',
}


def score_rows(rows):
    """Run eval_question_answering over the rows and attach its answers."""
    qas = [{'prediction': r['prediction'], 'answer': r['answer'], 'category': r['category'], 'evidence': []} for r in rows]
    with contextlib.redirect_stdout(sys.stderr):
        f1s, _, _ = official.eval_question_answering(qas, eval_key='prediction')
    assert len(f1s) == len(rows)
    return [{**r, 'expected': round(float(v), 10)} for r, v in zip(rows, f1s)]


# ---------------------------------------------------------------------------
# hand-authored cases — Tangle's text, so the fixture can be committed
# ---------------------------------------------------------------------------

NORMALIZE = [
    'The cat, and the dog.',
    'the-cat',
    'A band and an anthem',
    "Caroline's 1,000 friends!",
    '  Multiple   spaces\tand\nnewlines ',
    'café A LA carte',
    'éa and aé',
    'x\x1cthe\x1fy',
    '﻿the answer',
    'ΣΟΦΊΑ ΚΑΙ Σ',
    'İstanbul',
    'straße',
    '',
    'a',
    'and',
    '2022',
    'a_b the_c',
    '“smart” quotes — and dashes…',
    'the 🎉 party',
    '‍the‍',
    'anna and andy',
]

STEM_WORDS = [
    # the paper's own examples
    'caresses', 'ponies', 'ties', 'caress', 'cats', 'feed', 'agreed', 'plastered', 'bled', 'motoring', 'sing',
    'conflated', 'troubled', 'sized', 'hopping', 'tanned', 'falling', 'hissing', 'fizzed', 'failing', 'filing',
    'happy', 'sky', 'relational', 'conditional', 'rational', 'valenci', 'hesitanci', 'digitizer', 'conformabli',
    'radicalli', 'differentli', 'vileli', 'analogousli', 'vietnamization', 'predication', 'operator', 'feudalism',
    'decisiveness', 'hopefulness', 'callousness', 'formaliti', 'sensitiviti', 'sensibiliti', 'triplicate',
    'formative', 'formalize', 'electriciti', 'electrical', 'hopeful', 'goodness', 'revival', 'allowance',
    'inference', 'airliner', 'gyroscopic', 'adjustable', 'defensible', 'irritant', 'replacement', 'adjustment',
    'dependent', 'adoption', 'homologou', 'communism', 'activate', 'angulariti', 'homologous', 'effective',
    'bowdlerize', 'probate', 'rate', 'cease', 'controll', 'roll',
    # NLTK's extensions
    'skies', 'dying', 'lying', 'tying', 'news', 'innings', 'outing', 'cannings', 'howe', 'proceed', 'exceed',
    'succeed', 'flies', 'dies', 'ties', 'spied', 'died', 'tried', 'cried', 'enjoy', 'enjoyment', 'spy', 'fly', 'try',
    'happily', 'radically', 'fully', 'carefully', 'geology', 'theology', 'archaeology', 'philology', 'logi',
    'generalization', 'oscillators', 'agreement', 'abli', 'ably', 'stably',
    # short words, y runs, mixed case, the *o two-letter case, astral characters
    'a', 'ab', 'abc', 'y', 'yy', 'yyy', 'yyyy', 'by', 'toy', 'syzygy', 'day', 'days', 'played', 'playing',
    'Running', 'RUNS', 'WALKED', 'İstanbul', 'straße', '🎉', '🎉🎉🎉', 'a🎉🎉', 'party🎉', 'hopp🎉🎉', 'sized🎉',
    # words the release's questions lean on
    'painted', 'painting', 'adopted', 'adoption', 'counseling', 'certification', 'graduated', 'traveled',
    'travelling', 'moved', 'moving', 'started', 'studies', 'studying', 'married', 'marriage', 'babies', 'family',
    'families', 'volunteering', 'organizations', 'university', 'anxiety', 'therapy', 'photography', 'hiking',
]

ROWS = [
    # single-hop
    dict(id='identical', category=4, prediction='Psychology', answer='Psychology'),
    dict(id='empty prediction', category=4, prediction='', answer='Psychology'),
    dict(id='both empty', category=4, prediction='', answer=''),
    dict(id='prediction normalizes to nothing', category=4, prediction='a', answer='cat'),
    dict(id='answer normalizes to nothing', category=4, prediction='cat', answer='the'),
    dict(id='extra words', category=4, prediction='She studied psychology at university', answer='Psychology'),
    dict(id='case and punctuation', category=4, prediction='psychology!', answer='PSYCHOLOGY.'),
    dict(id='punctuation before articles keeps the article', category=4, prediction='the-cat', answer='cat'),
    dict(id='plural stems to singular', category=4, prediction='cats', answer='cat'),
    dict(id='stem conflation', category=4, prediction='running runs', answer='run runner'),
    dict(id='nltk irregulars', category=4, prediction='flies dies skies', answer='fly die sky'),
    dict(id='and is an article', category=4, prediction='salt and pepper', answer='salt pepper'),
    dict(id='band is not', category=4, prediction='band', answer='and'),
    dict(id='commas vanish before anything else', category=4, prediction='1,000', answer='1000'),
    dict(id='apostrophe', category=4, prediction="Caroline's", answer='carolines'),
    dict(id='repeated tokens count as a multiset', category=4, prediction='no no no yes', answer='no yes'),
    dict(id='unicode letters differ', category=4, prediction='naïve', answer='naive'),
    dict(id='unicode letters agree', category=4, prediction='résumé', answer='Résumé'),
    dict(id='an emoji is a token', category=4, prediction='🎉 party', answer='party'),
    dict(id='unicode word boundary keeps éa', category=4, prediction='éa', answer='a'),
    dict(id='python whitespace', category=4, prediction='blue\x1cgreen', answer='blue green'),
    dict(id='bom is not whitespace', category=4, prediction='﻿blue', answer='blue'),
    # temporal, with the integer answers
    dict(id='integer answer matched', category=2, prediction='2022', answer=2022),
    dict(id='integer answer in a sentence', category=2, prediction='She painted it in 2022.', answer=2022),
    dict(id='integer answer missed', category=2, prediction='2023', answer=2022),
    dict(id='date order does not matter', category=2, prediction='May 7, 2023', answer='7 May 2023'),
    dict(id='relative date', category=2, prediction='25 May 2023', answer='The sunday before 25 May 2023'),
    dict(id='the year alone', category=2, prediction='2023', answer='7 May 2023'),
    # open-domain: the ground truth is cut at the first semicolon
    dict(id='semicolon truncates the truth', category=3, prediction='psychology', answer='Psychology; counseling certification'),
    dict(id='second clause is invisible', category=3, prediction='counseling certification', answer='Psychology; counseling certification'),
    dict(id='semicolon with spaces', category=3, prediction='hiking and camping', answer='  hiking ; camping  '),
    dict(id='no semicolon', category=3, prediction='hiking', answer='hiking, camping'),
    dict(id='semicolon inside prediction is punctuation', category=3, prediction='hiking; camping', answer='hiking'),
    # multi-hop: split on commas FIRST
    dict(id='multi-hop reordered', category=1, prediction='counseling certification, psychology', answer='Psychology, counseling certification'),
    dict(id='multi-hop half', category=1, prediction='psychology', answer='Psychology, counseling certification'),
    dict(id='multi-hop empty', category=1, prediction='', answer='Psychology, counseling certification'),
    dict(id='multi-hop all articles', category=1, prediction='a, an, the', answer='Psychology, counseling certification'),
    dict(id='multi-hop one part against two truths', category=1, prediction='psychology counseling certification', answer='Psychology, counseling certification'),
    dict(id='multi-hop more parts than truths', category=1, prediction='psychology, counseling, certification, art', answer='Psychology, counseling certification'),
    dict(id='multi-hop trailing comma', category=1, prediction='a, b', answer='a, b,'),
    dict(id='multi-hop truth without commas', category=1, prediction='one, two', answer='one two'),
    dict(id='multi-hop integer answer', category=1, prediction='42', answer=42),
    dict(id='multi-hop nine truths', category=1, prediction='one, three, five, seven, nine', answer='one, two, three, four, five, six, seven, eight, nine'),
    dict(id='multi-hop nineteen truths', category=1,
         prediction='alpha beta, gamma, epsilon zeta, theta, kappa lambda mu, xi, pi rho, tau, phi chi psi omega',
         answer='alpha, beta, gamma, delta, epsilon, zeta, eta, theta, iota, kappa, lambda, mu, nu, xi, omicron, pi, rho, sigma, tau'),
    dict(id='multi-hop partial overlaps', category=1,
         prediction='red apples and green pears, a blue car, the old house',
         answer='green apples, red car, old house, new boat'),
]

ADVERSARIAL = [
    'No information available',
    'There is no information available in the conversation.',
    'This was not mentioned.',
    'NOT MENTIONED',
    'Paris',
    '',
    'She never mentioned it',
]


def build_hand_fixture():
    return {
        'generated': META,
        'normalize': [{'input': s, 'expected': official.normalize_answer(s)} for s in NORMALIZE],
        'stems': [[w, official.ps.stem(w)] for w in STEM_WORDS],
        'rows': score_rows(ROWS),
        'adversarial': [{'output': o, 'expected': 1 if ('no information available' in o.lower() or 'not mentioned' in o.lower()) else 0}
                        for o in ADVERSARIAL],
    }


# ---------------------------------------------------------------------------
# the release: its vocabulary (committed) and its turns as predictions (not)
# ---------------------------------------------------------------------------

def sessions_of(sample):
    out = []
    for key, value in sample['conversation'].items():
        m = regex.match(r'^session_(\d+)$', key)
        if m:
            out.append((int(m.group(1)), value))
    return [turns for _, turns in sorted(out)]


def build_dataset_fixtures():
    data = json.loads(DATASET.read_text('utf8'))
    vocabulary = set()
    turn_vocabulary = set()
    rows = []
    for sample in data:
        turns = {t['dia_id']: t for session in sessions_of(sample) for t in session}
        for t in turns.values():
            turn_vocabulary.update(official.normalize_answer(t['text']).split())
        for i, qa in enumerate(sample['qa']):
            vocabulary.update(official.normalize_answer(qa['question']).split())
            if 'answer' in qa:
                vocabulary.update(official.normalize_answer(str(qa['answer'])).split())
            if qa['category'] == 5 or 'answer' not in qa:
                continue
            gold = [turns[e] for e in qa.get('evidence', []) if e in turns]
            base = dict(sample=sample['sample_id'], index=i, category=qa['category'], answer=qa['answer'])
            rows.append({**base, 'id': f"{sample['sample_id']}/{i}/answer", 'prediction': str(qa['answer'])})
            if gold:
                rows.append({**base, 'id': f"{sample['sample_id']}/{i}/gold-turn", 'prediction': gold[0]['text']})
                rows.append({**base, 'id': f"{sample['sample_id']}/{i}/gold-turns", 'prediction': ', '.join(t['text'] for t in gold)})
    words = sorted(vocabulary)
    turn_words = sorted(turn_vocabulary - vocabulary)
    committed = {
        'generated': {**META, 'what': 'the sorted vocabulary of every question and answer in the release (categories 1–5), with the stem NLTK gives each token — a word list, not the text'},
        'tokens': len(words),
        'stems': [[w, official.ps.stem(w)] for w in words],
    }
    local = {
        'generated': {**META, 'what': 'dataset-derived rows: each scorable answer as its own prediction, then its first gold turn, then all gold turns joined by commas; plus the stems of the turn vocabulary. Redistributes LoCoMo text — gitignored, never committed'},
        'turnVocabulary': [[w, official.ps.stem(w)] for w in turn_words],
        'rows': score_rows(rows),
    }
    return committed, local


hand = build_hand_fixture()
FIXTURE.write_text(json.dumps(hand, ensure_ascii=False, indent=2) + '\n', 'utf8')
print(f'{FIXTURE.relative_to(ROOT)}: {len(hand["normalize"])} normalizations, {len(hand["stems"])} stems, {len(hand["rows"])} rows, {len(hand["adversarial"])} adversarial')

if DATASET.exists():
    committed, local = build_dataset_fixtures()
    VOCABULARY.write_text(json.dumps(committed, ensure_ascii=False, indent=0) + '\n', 'utf8')
    print(f'{VOCABULARY.relative_to(ROOT)}: {committed["tokens"]} tokens')
    DATASET_ROWS.parent.mkdir(parents=True, exist_ok=True)
    DATASET_ROWS.write_text(json.dumps(local, ensure_ascii=False, indent=1) + '\n', 'utf8')
    print(f'{DATASET_ROWS.relative_to(ROOT)}: {len(local["rows"])} rows, {len(local["turnVocabulary"])} turn-only tokens (gitignored)')
else:
    print(f'{DATASET.relative_to(ROOT)} absent — vocabulary and dataset rows not generated')
