# Releasing django-bookkeeper

This documents the actual release process for maintainers (and AI agents —
see [AGENTS.md](AGENTS.md)). It follows GitFlow: a `release/*` branch carries
the version bump, merges to `main`, and a tag on `main` drives publishing.

Versioning is currently **manual** — `version` in `pyproject.toml` is a
static string, not derived from git tags. You bump it by hand as part of
the release branch.

## Pipeline overview

```
release/X.Y.Z branch        →  PR into main
        │
tag vX.Y.Z pushed (on main) →  publish-testpypi.yml  →  test.pypi.org
        │
GitHub Release published    →  publish-pypi.yml      →  pypi.org
```

Both publish workflows gate on the full CI suite (lint + the Python/Django
test matrix) passing first, via `workflow_call`. Neither workflow uses a
stored API token — both authenticate to PyPI/TestPyPI via OIDC trusted
publishing (see [Trusted publisher setup](#trusted-publisher-setup-one-time)
below if this is a fresh fork or the config is ever lost).

## Step by step

### 1. Cut a release branch from `develop`

```bash
git checkout develop
git pull
git checkout -b release/X.Y.Z
```

### 2. Bump the version

Edit `version` in `pyproject.toml`, then refresh the lockfile so it
matches:

```bash
uv sync --extra dev
```

Confirm `uv.lock`'s `django-bookkeeper` package entry picked up the new
version (`git diff uv.lock` should show only that one line changing).

### 3. Lint and test locally before pushing

```bash
uv run ruff check src/ tests/ demo/
uv run pytest --cov
```

### 4. Commit, push, and open a PR into `main`

```bash
git add pyproject.toml uv.lock
git commit -m "release: bump version to X.Y.Z"
git push -u origin release/X.Y.Z
gh pr create --base main --head release/X.Y.Z --title "Release X.Y.Z"
```

Wait for CI to pass on the PR, then merge it.

### 5. Tag `main` and push the tag — ships to TestPyPI

```bash
git checkout main
git pull
git tag vX.Y.Z
git push origin vX.Y.Z
```

This triggers `publish-testpypi.yml`, which:
1. Verifies the tag's version (`vX.Y.Z` → `X.Y.Z`) matches `pyproject.toml`
2. Runs the full CI gate
3. Builds the sdist/wheel
4. Publishes to **test.pypi.org**

Watch it:

```bash
gh run watch $(gh run list --workflow=publish-testpypi.yml --limit 1 --json databaseId --jq '.[0].databaseId')
```

### 6. Verify the TestPyPI release

```bash
pip install --index-url https://test.pypi.org/simple/ \
            --extra-index-url https://pypi.org/simple/ \
            django-bookkeeper==X.Y.Z
```

The `--extra-index-url` is required — TestPyPI doesn't mirror dependencies
like Django, ebooklib, etc., so a TestPyPI-only install will fail to
resolve them.

If something's wrong, **do not retag the same version**. PyPI and TestPyPI
both permanently reject re-uploading a version number, even after deleting
a release. Fix the issue, bump to the next patch version, and start again
from step 1 (this is exactly what produced 0.2.1 right after 0.2.0).

### 7. Cut a GitHub Release from the tag — ships to PyPI

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."
```

This triggers `publish-pypi.yml`, which runs the same verification/build/
test gate and publishes to **pypi.org**. Watch it the same way as step 5.

### 8. Confirm the production release

```bash
curl -s https://pypi.org/simple/django-bookkeeper/ | grep "X.Y.Z"
```

### 9. Merge `main` back into `develop`

GitFlow requires this — without it, `develop`'s version string and any
release-branch-only commits drift out of sync with `main`. (This step was
missed after the 0.2.0 release, which is part of why 0.2.1 happened so
quickly afterward — see the postmortem note below.)

```bash
git checkout develop
git pull
git merge origin/main
# resolve conflicts if any (pyproject.toml/uv.lock version lines are
# the most likely spot — keep main's version)
git push origin develop
```

## If something goes wrong mid-pipeline

- **TestPyPI publish fails on the version-match check**: the tag doesn't
  match `pyproject.toml`. Delete the tag (`git push --delete origin
  vX.Y.Z`), fix the version, retag.
- **CI fails inside a publish workflow**: nothing was uploaded yet (the
  `publish` job only runs after `test` and `build` succeed). Fix the
  issue, bump to the next patch version (don't reuse the failed tag), and
  restart from step 1.
- **You need to test the workflows without cutting a real release**: both
  `publish-testpypi.yml` and `publish-pypi.yml` support
  `workflow_dispatch`, so they can be triggered manually from the Actions
  tab or `gh workflow run`.

## Trusted publisher setup (one-time, per environment)

If trusted publishing is ever reconfigured (new repo, renamed workflow
file, etc.), register these on both
[test.pypi.org](https://test.pypi.org/manage/project/django-bookkeeper/settings/publishing/)
and [pypi.org](https://pypi.org/manage/project/django-bookkeeper/settings/publishing/):

| Field | TestPyPI | PyPI |
|---|---|---|
| Owner | `ehwio` | `ehwio` |
| Repository | `django-bookkeeper` | `django-bookkeeper` |
| Workflow filename | `publish-testpypi.yml` | `publish-pypi.yml` |
| Environment name | `testpypi` | `pypi` |

These must match the `environment:` key in the corresponding workflow
file exactly, or the OIDC token exchange is rejected.

## Postmortem: why 0.2.0 was followed by 0.2.1 within the hour

`v0.2.0` was tagged and shipped to TestPyPI before a CI bug was found: the
Django-version test matrix was silently testing every cell against
whatever version `uv.lock` happened to resolve, not the version each cell
requested (`uv run` re-syncs the venv to the lockfile before executing,
reverting a `uv pip install` override done in an earlier step). The matrix
had provided zero actual cross-version coverage since it was added.

Two ways to have handled this were considered: force-push a moved
`v0.2.0` tag, or bump to `0.2.1`. The tag move was rejected — workflow
files aren't part of the published package, so there was no need to
mutate already-published history; a clean patch bump was simpler and
safer. The fix itself was `uv run --with "django~=X.Y.0"` instead of a
separate `uv pip install` step, which survives the re-sync.
