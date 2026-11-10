# Architecture

Approved hybrid design: TypeScript CLI/core and Python static security engine,
communicating through locally validated versioned JSON. Basic checks must not need
Python. Optional AI stays off until explicit consent, disclosure and budgets exist.

```mermaid
flowchart TD
    A[Untrusted skill directory] --> B[TypeScript bounded discovery]
    B --> C[Spec and reference validators]
    B --> D[Normalized text inventory]
    D --> E[Versioned JSON request]
    E --> F[Isolated Python subprocess]
    F --> G[Static security rules]
    G --> H[Validated JSON response]
    C --> I[Deterministic findings]
    H --> I
    I --> J[Threshold gates and reports]
    D -. Explicit consent only .-> K[Optional advisory AI]
    K -. Cannot suppress findings .-> J
```

This diagram includes planned modules, not an implementation claim. Actual status
is in IMPLEMENTATION_TRACKER and phase reports. Runtime authority is intentionally
split: filesystem policy belongs to TypeScript; Python consumes text data only.
Neither layer executes scanned scripts. The subprocess is not an OS sandbox.

Canonical contracts: packages/protocol/schema. Rule IDs and taxonomy are public
contracts when released. Identity strings live in CLI core/identity.ts; package
manifests, Python metadata and protocol URNs are independently versioned build
metadata, not external service addresses. Package names remain private/provisional.

See ADR 0001 for language choice, ADR 0002 for the protocol trust boundary,
THREAT_MODEL for adversaries and residual risks, and PROTOCOL for wire limits.
