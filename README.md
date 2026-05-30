# Idempotency Gateway

A payment-processing API that makes sure every transaction is charged **exactly once** regardless of how many times the client retries a request.

Built with **Node.js**, **Express**, and **SQLite**

---

## Architecture Diagram

```mermaid
sequenceDiagram
    participant C as Client
    participant M as Idempotency Middleware
    participant DB as SQLite Store
    participant P as Payment Processor

    C->>M: POST /process-payment<br/>Idempotency-Key: abc-123

    M->>DB: SELECT record WHERE key = 'abc-123'
    DB-->>M: (not found)

    M->>DB: INSERT key='abc-123', status='pending'
    M->>P: forward request

    Note over P: simulate 2s processing

    P-->>M: { message: "Charged 100 GHS", transactionId: ... }
    M->>DB: UPDATE key='abc-123', status='complete', response=...
    M-->>C: 201 Created + response body

    Note over C,P: --- Client retries (network timeout) ---

    C->>M: POST /process-payment<br/>Idempotency-Key: abc-123 (same body)
    M->>DB: SELECT record WHERE key = 'abc-123'
    DB-->>M: { status: 'complete', response: ... }
    M-->>C: 201 Created + cached response body<br/>X-Cache-Hit: true
```

### In-Flight Race Condition

```mermaid
sequenceDiagram
    participant A as Request A
    participant B as Request B
    participant M as Middleware
    participant DB as SQLite Store
    participant P as Payment Processor

    A->>M: POST (key: xyz)
    B->>M: POST (key: xyz) — arrives simultaneously

    M->>DB: INSERT key='xyz', status='pending' [Request A wins]
    M->>DB: INSERT key='xyz' [Request B: 0 rows changed → already pending]

    A->>P: forward to processor
    Note over B,DB: Request B polls DB every 100ms

    P-->>A: payment result
    A->>DB: UPDATE status='complete'

    DB-->>B: status='complete' (poll succeeds)
    B-->>B: return cached result
```
