# Initial GitHub Repository Setup

This setup is prepared for a public repository owned by the project maintainer. The connected GitHub integration in this session does not expose a repository-creation action, so repository creation itself must be completed in GitHub or with GitHub CLI. The steps below are ready to run.

## 1. Repository details

- Suggested repository: `skillguard`
- Suggested owner: your personal GitHub account
- Visibility: Public
- Description: `Validate, test, and security-scan AI agent skills before use.`
- Website: leave blank until project documentation is hosted.
- Initialize with README: No (this starter pack already contains one).
- License: MIT (included).
- Default branch: `main`.
- Topics: `ai-agents`, `agent-skills`, `security`, `static-analysis`, `developer-tools`, `cli`, `typescript`, `python`.

Before creation, search GitHub for `skillguard` and check npm/PyPI package-name availability. The name and package scopes are provisional and may conflict with existing projects or trademarks.

## 2. Create the repository

Using GitHub CLI:

```bash
gh auth status
gh repo create skillguard --public \
  --description "Validate, test, and security-scan AI agent skills before use." \
  --disable-wiki \
  --source . \
  --remote origin \
  --push
```

Run this from the extracted project root after reviewing the files and initializing Git:

```bash
git init
git add .
git commit -m "chore: initialize SkillGuard project"
git branch -M main
```

If `gh repo create` reports that the repository already exists, inspect it before pushing. Do not overwrite an existing repository.

## 3. Recommended GitHub settings

### General

- Disable Wikis initially.
- Enable Issues and Discussions only when there is capacity to respond.
- Keep Projects optional.
- Add a short social preview image after the identity is finalized.

### Branch protection / ruleset for `main`

- Require pull requests before merging.
- Require at least one approval once there are multiple maintainers; for a solo maintainer, use required CI checks and self-review.
- Require status checks: `typescript`, `python`, `lint`, `tests`.
- Require branches to be up to date.
- Block force pushes and deletion.
- Require conversation resolution.
- Do not require signed commits unless signing is operationally reliable.

### Security

- Enable Dependabot alerts and security updates.
- Enable secret scanning and push protection if available on the plan.
- Enable private vulnerability reporting.
- Use least-privilege GitHub Actions permissions.
- Pin third-party Actions to full commit SHAs.

### Labels

`bug`, `feature`, `documentation`, `good first issue`, `help wanted`, `security`, `false positive`, `false negative`, `rule request`, `breaking change`.

## 4. First release hygiene

Before publishing:

- Verify the project name and package names.
- Review all dependencies and licenses.
- Add a maintainer contact to SECURITY.md.
- Run the clean-install test.
- Add a changelog entry.
- Create a signed/tagged release if signing is configured.
- Never claim adoption, downloads, or security effectiveness without measured evidence.

## 5. Suggested first public milestone

Publish the architecture and invite design feedback before claiming a working security scanner. Label the repository as early-stage until core checks, test fixtures, and CI are implemented.
