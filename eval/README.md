# Evaluation

`npm run eval` scores golden conversations and compares them with human labels. It's how a default model is chosen (cheapest one that passes the gates) and how prompt or model changes are checked before they ship.

| Gate (docs/05 §1) | Threshold |
|---|---|
| Criterion agreement (Yes/No/NA, after rules) | ≥ 85% overall |
| Worst single criterion (n ≥ 3) | ≥ 70% |
| Outcome | ≥ 90% |
| Extraction (enum / boolean / number) | ≥ 90% |
| Evidence verified (Yes/No answers with a quote found in the transcript) | ≥ 95% |

## Sets

**G1** (built in): the 28 scripted, code-mixed conversations in `content/call-templates`, labelled by their authors. It runs on transcripts (no ASR), so it isolates the LLM and prompt. With mock providers it scores 100% by construction; it's meant for real models:

```bash
ANTHROPIC_API_KEY=… npm run eval -- --llm anthropic:claude-opus-5-5 --llm anthropic:claude-sonnet-5-5 --llm anthropic:claude-haiku-5-5
```

**G2** (you add it): real, consented recordings, double-labelled by auditors. One JSON file per conversation in `eval/g2/`, next to its audio:

```jsonc
// eval/g2/kf-0001.json
{
  "categoryId": "early-bucket",
  "language": "ta-en",
  "audio": "kf-0001.mp3",          // relative to eval/g2; stereo with the person on the left by default
  "channels": "left",              // or "right" | "mono"
  "labels": {
    "criteria": { "op_greet_company": "yes", "op_rpc_verify": "no", "pr_late_fee_info": "na" },
    "outcomeId": "ptp",
    "extractions": { "ptp_amount": 18500, "delay_reason": "medical" }
  }
}
```

```bash
npm run eval -- --set g2 --asr sarvam:saaras:v4 --llm anthropic:claude-sonnet-5-5
```

Audio and labels are customer data: `eval/g2/` is git-ignored.

Every run writes `eval/runs/<timestamp>-<set>.json` with per-case disagreements (git-ignored too). `--gate` exits non-zero when a gate fails, for CI.
