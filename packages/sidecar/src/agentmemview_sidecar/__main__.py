"""AgentMemView sidecar: stdio JSON-RPC server (one JSON object per line).

Contract (Spec section 10, frozen): handshake / embed / rerank / cluster /
consolidate. v1 implements handshake + embed only; unknown methods return
-32601, malformed JSON returns -32700. The sidecar never calls back into
core (unidirectional dependency).
"""

import json
import sys

PROTOCOL_VERSION = 1
SIDECAR_NAME = "agentmemview-sidecar"
SIDECAR_VERSION = "0.1.0"
SUPPORTED_METHODS = ["embed", "rerank", "cluster", "consolidate"]
IMPLEMENTED_METHODS = ["embed"]

_model = None


def _get_model(model_name: str | None):
    """Lazy-load fastembed; import error surfaces as a JSON-RPC error."""
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding(model_name or "BAAI/bge-small-en-v1.5")
    return _model


def handle_request(payload: dict) -> dict | None:
    """Route one JSON-RPC request; returns the response object (or None)."""
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if method == "handshake":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "name": SIDECAR_NAME,
                "version": SIDECAR_VERSION,
                "protocol": PROTOCOL_VERSION,
                "methods": IMPLEMENTED_METHODS,
            },
        }
    if method == "embed":
        texts = params.get("texts")
        if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32602, "message": "params.texts must be string[]"},
            }
        try:
            model = _get_model(params.get("model"))
            vectors = [list(map(float, v)) for v in model.embed(texts)]
        except Exception as exc:  # noqa: BLE001 — surface as protocol error
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32000, "message": f"embed failed: {exc}"},
            }
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {"vectors": vectors, "dims": len(vectors[0]) if vectors else 0},
        }
    if method in SUPPORTED_METHODS:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"method not implemented in v1: {method}"},
        }
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": f"unknown method: {method}"},
    }


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            sys.stdout.write(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": None,
                        "error": {"code": -32700, "message": "parse error"},
                    }
                )
                + "\n"
            )
            sys.stdout.flush()
            continue
        response = handle_request(payload)
        if response is not None:
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
