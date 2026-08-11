"""Protocol tests for the sidecar JSON-RPC surface (no model download)."""

import json
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / "src"))

from agentmemview_sidecar.__main__ import handle_request  # noqa: E402


def test_handshake_returns_name_version_methods():
    response = handle_request({"jsonrpc": "2.0", "id": 1, "method": "handshake"})
    assert response is not None
    result = response["result"]
    assert result["name"] == "agentmemview-sidecar"
    assert result["protocol"] == 1
    assert "embed" in result["methods"]


def test_unknown_method_returns_minus_32601():
    response = handle_request({"jsonrpc": "2.0", "id": 2, "method": "explode"})
    assert response is not None
    assert response["error"]["code"] == -32601


def test_unimplemented_contract_method_returns_minus_32601():
    response = handle_request({"jsonrpc": "2.0", "id": 3, "method": "rerank"})
    assert response is not None
    assert response["error"]["code"] == -32601


def test_embed_invalid_params_returns_minus_32602():
    response = handle_request(
        {"jsonrpc": "2.0", "id": 4, "method": "embed", "params": {"texts": 42}}
    )
    assert response is not None
    assert response["error"]["code"] == -32602


def test_malformed_json_line_yields_parse_error():
    """Line-level protocol: malformed JSON → -32700 (exercised via stdio loop)."""
    import io
    import contextlib

    from agentmemview_sidecar.__main__ import main

    stdin = io.StringIO("this is not json\n")
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        old_stdin = sys.stdin
        sys.stdin = stdin
        try:
            main()
        finally:
            sys.stdin = old_stdin
    payload = json.loads(stdout.getvalue().strip())
    assert payload["error"]["code"] == -32700
