# Contributing

...

## Code quality checks

All commits are automatically checked for linting and formatting errors using
[Husky](https://github.com/typicode/husky) and `lint-staged`.  
The pre‑commit hook runs the `scripts/lint-staged.sh` script which in turn
executes `eslint` and `prettier` on the files staged for commit.

If a commit would fail the hook, the commit is aborted and you will see a
readable error message.  To bypass the hook for a single commit, use:

