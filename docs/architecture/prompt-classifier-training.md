# Prompt Classifier Training

The prompt-classifier service supports four strategies while keeping the proxy contract unchanged: `POST /classify {text}` returns a `band`.

| Strategy | Behavior |
|---|---|
| `llm` | Existing local rubric judge. Shipping default. |
| `knn` | Semantic KNN verdict; optionally asks the LLM when KNN abstains. |
| `hybrid` | KNN when confident, existing LLM judge on abstention or model failure. |
| `shadow` | Returns the LLM verdict and records KNN agreement without changing routing. |

KNN uses local `fast-all-MiniLM-L6-v2` embeddings. A verdict is accepted only when both nearest-neighbor similarity and weighted vote margin clear thresholds selected by held-out evaluation. Otherwise it abstains. The proxy still applies its downgrade-only and allowed-band rules after the service responds.

## Training Data

### Hand-labelled coding prompts

The existing corpus is usable for a smoke model:

```bash
npm run classifier:train -- \
  --input=tests/fixtures/prompt-classifier-labels.json \
  --output=.data/prompt-classifier/knn-model.json \
  --precision-gate=0.90
```

This corpus is small. Use it to prove the pipeline, not as sufficient evidence for production activation.

### Objective model scores

The preferred source is a score table where every prompt was answered and objectively scored by the models assigned to the live bands. Produce scores for at least:

- the effective `small` model or weakest enabled small destination;
- the effective `medium` model;
- optionally the high model for quality-retention reporting.

Convert scores to least-capable-success labels:

```bash
npm run classifier:labels -- \
  --input=/path/to/scores.json \
  --output=.data/prompt-classifier/labels.jsonl \
  --small-models=claude-haiku-4.5,qwen3.8-27b-dual-fast \
  --medium-models=claude-sonnet-5
```

The converter refuses a score table that does not contain every named model and labels a band successful only when every possible destination supplied for that band passed. This prevents an old workshop model catalogue from silently defining current routing bands, and prevents an enabled local destination from inheriting a label earned only by an account model.

Then train:

```bash
npm run classifier:train -- \
  --input=.data/prompt-classifier/labels.jsonl \
  --output=.data/prompt-classifier/knn-model.json \
  --folds=5 \
  --k=3,5,7 \
  --precision-gate=0.90 \
  --min-predictions-per-band=20
```

The trainer:

1. Generates local MiniLM embeddings.
2. Splits held-out folds by `group`, not individual row.
3. Searches K, minimum similarity, and vote-margin thresholds.
4. Requires the precision gate independently for `small` and `medium`.
5. Writes an artifact only if a qualifying threshold set exists.

For coding traffic, use a `group` that prevents related prompts from crossing folds, such as task family, issue, repository operation, or session. Randomly splitting near-duplicate prompts overstates generalization.

## Evaluation

Evaluate the strategy served on port 12437:

```bash
npm run classifier:eval -- --service-url=http://127.0.0.1:12437 --gate=0.90
node scripts/eval-prompt-classifier.mjs --corpus
```

The first command gates worst-band precision. The second reports how many captured foreground turns pass the free eligibility and veto stages.

Minimum activation evidence:

- `small` precision at or above 90%;
- `medium` precision at or above 90%;
- meaningful accepted predictions in both bands;
- coding-specific prompts represented in held-out evaluation;
- latency below the proxy classifier timeout for accepted KNN decisions;
- shadow disagreements reviewed before changing routing.

## Activation

1. Train the artifact at the configured `knn.model_path`.
2. Set `strategy: shadow` in `config/prompt-classifier.yaml`.
3. Restart the service or wait for normal config reload, then inspect:

   ```bash
   curl -s localhost:12437/health | jq '{strategy,knn,counts}'
   ```

4. Exercise representative traffic and review `counts.knn.shadowDisagreed` plus labelled evaluation results.
5. Set `strategy: hybrid`. The file is hot-reloaded; new requests use KNN when confident and the LLM otherwise.
6. Keep `classifier.bands` and `semantic_routing.offload_bands` in `llm-routing.yaml` unchanged until both band precision and destination-model quality are independently validated.

Rollback is one line: set `strategy: llm`. Missing, corrupt, low-confidence, or out-of-distribution KNN evidence never invents a band.

## Workshop Integration

The evaluation workshop supplies the methodology and a large semantic query population. Its published model scores are not automatically valid labels for this installation because model catalogues change. Use it in either of these ways:

1. Re-run workshop queries against the current band models, then use `classifier:labels`.
2. Use workshop prompts as unlabeled coverage data, but label a coding-focused subset against current models and objective task checks.

Do not map workshop difficulty strata L1-L5 directly to `small`-`high`; a difficulty name is not evidence that the configured destination model succeeds.
