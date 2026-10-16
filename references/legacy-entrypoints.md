# Archived entry points (before production.v1)

The `legacy-*.md` files in this directory preserve the previous entry-point documentation verbatim. They describe the old runtime and are historical references. Their model tables, dependency instructions, generation defaults and approval rules do not override the current root `SKILL.md` or `AGENTS.md`.

The archives retain their original relative links and commands for fidelity; interpret those paths from the repository root or inspect the corresponding historical Git revision. They are not an executable guide for the new runtime.

Start new work at [`../SKILL.md`](../SKILL.md) and [`production-v1.md`](production-v1.md). Legacy YAML, manifests and existing media remain usable through explicit migration; migration does not authorize generation. Old source code and fixtures remain in place for rollback and comparison. Do not run both runtimes against the same production.
