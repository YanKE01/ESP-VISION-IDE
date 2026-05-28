# ViperIDE - Claude Code Guidelines

## Code Style

- Use ES6+ syntax (import/export, const/let, arrow functions, template literals)
- Never use `var`
- Indent with 2 spaces
- Use single quotes for strings
- Preserve existing SPDX license headers — do not modify or remove them
- Follow the existing ESLint config (`eslint.config.mjs`): no-unused-vars (warn), no-undef (error)
- Prefix intentionally unused variables with `_`

## Project Structure

- Source code is in `src/`, build output in `build/` — never edit `build/` directly
- Entry point: `src/app.js`
- Use `npm run build` to build, `npm run start` for dev server

## Constraints

- Do not introduce new npm dependencies without explicit approval
- Do not modify `eslint.config.mjs` or `rollup.config.mjs` without explicit approval
- Keep the existing module structure — do not reorganize files
