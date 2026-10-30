# HTTP API

The complete HTTP API — every route the backend serves (`backend/routes/api.php`, the same
paths and shapes as the Node API it replaced), with auth, request/response schemas and the
env-dependent behavior — is documented as a hand-written OpenAPI 3.1 spec:

- **Spec (source of truth):** [`backend/openapi.yaml`](../backend/openapi.yaml)
- **Browsable (Swagger UI):** https://opengym.duarte-santos.ch/api.html

Lint it after changing routes:

```sh
npx --yes @redocly/cli lint backend/openapi.yaml
```
