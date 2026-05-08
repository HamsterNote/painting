# Draft: Project Initialization

## Requirements (confirmed)
- stack: TypeScript + React
- bundler: Vite
- package manager: Yarn
- linting: ESLint
- formatting: Prettier
- ignore file: .gitignore
- unit testing: Jest
- e2e testing: Playwright

## Technical Decisions
- planning mode: produce a decision-complete setup plan before any implementation
- repository baseline: current workspace appears effectively empty aside from `LICENSE`

## Research Findings
- workspace root: `/home/zhangxiao/frontend/HamsterNote/painting` currently contains `.git/` and `LICENSE`

## Open Questions
- unit test companion tooling: whether to include React Testing Library alongside Jest
- Vite React variant: standard React plugin vs SWC-based React plugin
- CI scope: local-only bootstrap vs include CI workflow tasks in the setup plan

## Scope Boundaries
- INCLUDE: frontend project bootstrap, toolchain configuration, initial test setup, repository hygiene
- EXCLUDE: application feature development beyond bootstrap scaffolding
