# Implementation notes: artifact-robust engine, Cyton+Daisy mode, self-learning scores

Spec: `docs/IMPLEMENTATION_PROMPT.md`. Branch: `feat/robust-engine-cyton` (from `mario-kart-focus`). Nothing is pushed.

## Baseline test results

Run on 2026-11-14 before any change (Node v24.20.0, Python 3.10.11; numpy 2.2.6, scipy 1.15.3, websockets 16.1.1 installed; brainflow not installed):

| Test | Result |
|---|---|
| `node arousal.test.js` | exit 0, 24 PASS |
| `node stress.test.js` | exit 0, 35 PASS |
| `node panel/motion.test.js` | exit 0, 17 PASS |
| `node game/bomb.test.js` | exit 0, 27 PASS |
| `node game/mkds.test.js` | exit 0, 44 PASS |
| `node focus/experimental/focus.test.js` | exit 0, 26 PASS |
| `python game-py/test_mkds.py` | exit 0, "all passed" |

No test failed before the work started.

## Judgement calls

## Changes to numbers in the prompt

## Hardware assumptions and runtime checks

## Known limits

## Final checklist report
