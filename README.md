# th-chat (working title)

<!-- TODO: Replace with actual repository name -->

A monorepo for frontend (and possibly backend) utilities and runtime abstractions centered around ai-sdk.

**Status:** Work in Progress (WIP)

> [!NOTE]
> Part of this README file is ai-generated. Terms of project conventions are subject to change.

## Table of Contents

- [Features and Scope](#features-and-scope)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Development](#development)
- [Roadmap](#roadmap)
- [Architecture Notes](#architecture-notes)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Features and Scope

**Current:**

- Playground environments for experimenting and testing ai-sdk integrations
- Vue-specific utilities and components for ai-sdk workflows

**Planned:**

- Runtime abstractions for bridging backend agents and frontend applications
- Backend implementation and integration
- Cross-framework compatibility beyond Vue

## Project Structure

```
├── playground/          # Dev apps for experimenting and testing
│   └── ai-sdk-nuxt/    # Nuxt.js playground application
└── vue/                # Vue-related packages
    └── ai-sdk/          # Vue utilities for ai-sdk
```

## Getting Started

### Prerequisites

- Node.js LTS (18.x or later recommended)
- pnpm (package manager)

### Installation

Clone the repository and install dependencies:

```bash
pnpm install
```

### Development

To run the playground application:

```bash
# Navigate to playground
cd playground/ai-sdk-nuxt

# Start dev server
pnpm dev
```

For monorepo-wide tasks, use Turborepo:

```bash
# Build all packages
pnpm build

# Run development mode across packages
pnpm dev

# TODO: Define additional Turborepo tasks as needed
```

## Development

### Conventions

- TODO: Set up linting rules (ESLint recommended)
- TODO: Set up code formatting (Prettier recommended)
- TODO: Define testing strategy and conventions
- TODO: Establish commit message conventions

### Workspace Management

- **Package Manager:** pnpm with workspaces
- **Monorepo Tool:** Turborepo for task orchestration and caching
- TODO: Set up build and dev scripts across packages
- TODO: Configure Turborepo pipeline optimization

## Roadmap

- [ ] **List most common agentic tools and workflows**  
       Research and document the standard patterns, tools, and workflows used in AI agent development to inform our abstraction design.

- [ ] **Explore and identify fundamental contracts between backend agents and frontend apps**  
       Define the core interfaces and data contracts that enable seamless communication between AI agents/tools and frontend applications.

- [ ] **Backend implementation**  
       Develop server-side components and APIs that complement the frontend utilities and complete the full-stack ai-sdk integration story.

## Architecture Notes

The core concept of "runtime abstractions" refers to the contracts and bridges that enable seamless integration between backend AI agents/tools and frontend applications. These abstractions will provide:

- Standardized interfaces for agent-to-frontend communication
- Type-safe contracts for data exchange
- Framework-agnostic integration patterns

TODO: Define specific contract specifications and provide implementation examples.

## Contributing

We welcome contributions! To get started:

1. Open an issue to discuss proposed changes
2. Fork the repository and create a feature branch
3. Make your changes with appropriate tests
4. Submit a pull request with a clear description

TODO: Create detailed CONTRIBUTING.md with:

- Code style guidelines
- Testing requirements
- Pull request checklist
- Review process

## License

TBD

<!-- TODO: Choose and add appropriate license (MIT, Apache 2.0, etc.) -->

## Acknowledgements

This project builds upon [ai-sdk](https://ai-sdk.dev) and the broader AI development ecosystem.
