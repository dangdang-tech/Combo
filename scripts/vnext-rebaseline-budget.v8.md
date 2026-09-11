# v8 legacy-retirement budget

`scripts/vnext-rebaseline-budget.v8.json` is the active governance contract for one approved removal of the obsolete capability extraction, conversation upload/pairing, Agent management, and web execution/runtime surfaces. It creates a new tranche at immutable Main `0b0d25eccb70ec5e1beb898fe70f05059fe417eb`; it does not extend or reset v7.

The gate continues to parse and verify every v1-v7 contract and receipt. In particular, v7 is locked byte-for-byte at SHA-256 `f8019c915f928b599eb3afeba637f0e08fd60c14fef71cc10c4c29dfb049f2ff`, and its 14,615 changed lines remain recorded history.

## State machine

- `PENDING`: the complete locked inventory exists in both the comparison base and candidate. Only budget-policy files may change.
- `RETIREMENT`: the comparison base has the complete inventory and the candidate has none. This is the only exceptional PR, and its source branch must contain exactly one non-merge product commit directly on that comparison base. A local pre-commit check may instead validate the same cleanup as a fully staged index with zero new commits.
- `CONSUMED`: neither side has a retirement path. Ordinary governance/product rules and the unchanged 30-file, 1,200-lines-per-file, 5,000-lines-per-PR, and 15,000 cumulative ceilings apply again.

Partial inventories, replacement files, additions below deletion roots, and resurrection after consumption fail closed. Before retirement, every commit from the locked base to the cleanup comparison base must be policy-only. The single-commit source invariant makes merge-commit, squash, and rebase integration record one atomic `PENDING` to `CONSUMED` transition. After retirement, Main history must contain exactly one complete transition and its tombstones stay enforced.

## Retirement manifest

The contract contains only:

- explicit deletion-only legacy roots and exact deletion-only files;
- an exact list of bridge, manifest, non-gate workflow, and documentation files that may be modified, never added or deleted; and
- multiple package/route sentinels which must exist at the locked base and disappear in the retirement candidate.

The base inventory digest covers each target in raw Git path order with its object mode/type/blob SHA, byte count, and line count; the verifier also requires that order to be sorted and duplicate-free. The locked receipt is 364 files, 3,072,884 bytes, and 84,744 lines at `sha256:3d5d7320464a15c63b49008b1278a430e916358587572dcc564d7c72228c110a`. The authoring test fake, shared knowledge source and test, and acceptance smoke script are deletion-only; the shared pending-recovery source and test and browser E2E README remain editable integration files. Validation uses `--raw -z --full-index --no-renames --abbrev=40` together with name-status and numstat, cross-checks their status/path records, rejects binary and unsupported statuses, and requires every inventory item to be its locked ordinary blob becoming absent. Editable paths must be status `M` ordinary blobs which retain their exact Git mode, so chmod-only changes, symlinks, submodules, and type changes fail closed.

Only locked pure deletions are excluded from the ordinary retirement file/line ceilings. Editable work is limited to 110 files, 1,000 additions, 6,500 changed lines total, and 1,200 changed lines per file. Those changed lines begin the new tranche's cumulative accounting; subsequent changes remain subject to the normal 15,000-line cumulative ceiling.

Every budget-policy path, including the verifier, its tests, the v8 contract and documentation, and `.github/workflows/pr-ci.yml`, is immutable during `RETIREMENT`. The PR workflow is made tolerant of the deleted sandbox and runtime packages by this preceding governance-only change; the cleanup cannot change its own gate.

The ordinary `pull_request` job still runs the candidate verifier before installing dependencies. An independent `pull_request_target` job checks out the exact synthetic merge commit, verifies its base/head parents, extracts the complete trusted `scripts/` tree from the immutable PR base with `git archive`, and runs only that base verifier against the candidate checkout through `COMBO_BUDGET_REPO_ROOT`. It has read-only contents permission, receives no secrets or caches, and does not install dependencies or execute candidate JavaScript. The cleanup must not merge unless `CI / trusted retirement policy` passes, even if repository branch-protection settings do not yet list that check as required.

The manifest contains no PostgreSQL migration/data path and no current Agent Draft/Package/Release/Receiver/Package Session, J-012 context compiler, account/auth/billing, V2 payment, landing/login/new Agent, creator-worker/J011/Broker, or public plugin implementation root. The exception cannot authorize a DROP migration or edits outside its exact integration list.
