import yaml
from pathlib import Path

def generate():
    spec_path = Path("docs/openapi.yaml")
    spec = yaml.safe_load(spec_path.read_text(encoding="utf-8"))
    
    lines = [
        "# OphirPay API Cookbook",
        "",
        "A practical, copy-pasteable cookbook for integrating with the **OphirPay REST API** on Stellar / Soroban.",
        "This guide provides runnable `curl` command examples and realistic JSON request and response payloads for every public endpoint documented in the [OpenAPI Specification](./openapi.yaml).",
        "",
        "---",
        "",
        "## Table of Contents",
        "",
        "- [Overview & Authentication](#overview--authentication)",
        "- [Standard Error Responses](#standard-error-responses)",
    ]
    
    # Collect sections by tags
    tags_order = [
        ("Payments", "1. Payments API"),
        ("Batches", "2. Batch Payments API"),
        ("Escrows", "3. Escrows API"),
        ("Streams", "4. Payment Streams API"),
        ("Recurring", "5. Recurring Payments & Subscriptions API"),
        ("Payment Requests", "6. Payment Requests & Links API"),
        ("Webhooks", "7. Webhooks API"),
        ("API Keys", "8. API Keys API"),
        ("Session", "9. Session & Authentication API"),
        ("Multisig", "10. Multisig Operations API"),
        ("Governance", "11. Governance & DAO API"),
        ("Refunds", "12. Refunds API"),
        ("Hooks", "13. Notification Hooks Registry API"),
        ("Audit Log", "14. Audit Log API"),
        ("Events", "15. Real-Time Events API"),
        ("Analytics", "16. Analytics API"),
        ("Stats", "17. Contract Statistics API"),
        ("Fee Config", "18. Fee Configuration API"),
        ("Policy Versions", "19. Policy Versions API"),
        ("Contracts", "20. Contracts Deployment API"),
        ("Timelock", "21. Timelock Actions API"),
        ("RBAC", "22. Role-Based Access Control (RBAC) API"),
        ("Health", "23. Health Check API"),
        ("Metrics", "24. Observability Metrics API"),
    ]
    
    for tag_name, display_title in tags_order:
        slug = display_title.lower().replace(" ", "-").replace(".", "").replace("&", "").replace("(", "").replace(")", "")
        lines.append(f"- [{display_title}](#{slug})")
        
    lines.extend([
        "",
        "---",
        "",
        "## Overview & Authentication",
        "",
        "Base URLs:",
        "- **Local Development:** `http://localhost:3000`",
        "- **Production:** `https://api.ophirpay.com`",
        "",
        "OphirPay supports two primary API authentication methods, plus cookie-based authentication for web browser wallet sessions:",
        "",
        "1. **Bearer Token Header (Recommended):**",
        "   ```http",
        "   Authorization: Bearer ophir_live_sk_7f8a9b2c3d4e5f6a7b8c9d0e1f2a3b4c",
        "   ```",
        "2. **API Key Header:**",
        "   ```http",
        "   X-API-Key: ophir_live_sk_7f8a9b2c3d4e5f6a7b8c9d0e1f2a3b4c",
        "   ```",
        "3. **Session Cookie:**",
        "   ```http",
        "   Cookie: ophirpay_session=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "   ```",
        "",
        "---",
    ])
    
    # Map endpoints to tags
    endpoints_by_tag = {}
    for path, path_item in spec.get("paths", {}).items():
        for method, operation in path_item.items():
            if method.lower() not in ["get", "post", "put", "patch", "delete"]:
                continue
            tags = operation.get("tags", ["General"])
            tag = tags[0] if tags else "General"
            endpoints_by_tag.setdefault(tag, []).append((method.upper(), path, operation))
            
    # Sample data dictionaries
    sample_address_1 = "GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37"
    sample_address_2 = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    sample_address_3 = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    sample_tx_hash = "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0"
    
    for tag_name, display_title in tags_order:
        items = endpoints_by_tag.get(tag_name, [])
        if not items:
            continue
        lines.append(f"\n## {display_title}\n")
        
        for method, path, op in items:
            summary = op.get("summary", f"{method} {path}")
            desc = op.get("description", "")
            lines.append(f"### {summary} (`{method} {path}`)")
            if desc:
                lines.append(f"\n{desc.strip()}\n")
            else:
                lines.append("")
                
            # Build curl command
            curl_cmd = ["curl -X " + method]
            clean_path = path.replace("{id}", "pay_9a8b7c6d").replace("{proposalId}", "1")
            
            headers = []
            sec = op.get("security", spec.get("security", []))
            if sec and any("BearerAuth" in s or "ApiKeyAuth" in s for s in sec):
                headers.append('-H "Authorization: Bearer ophir_live_sk_test"')
                
            req_body = op.get("requestBody")
            data_str = None
            if req_body and method in ["POST", "PUT", "PATCH"]:
                headers.append('-H "Content-Type: application/json"')
                # generate sample payload based on path
                if "payment" in path and method == "POST":
                    data_str = f'{{\\n    "amount": 50.0,\\n    "assetCode": "XLM",\\n    "sourceAddress": "{sample_address_1}",\\n    "destinationAddress": "{sample_address_2}",\\n    "memo": "Payment for software design"\\n  }}'
                elif "batch" in path and method == "POST":
                    data_str = f'{{\\n    "name": "August Wave 1",\\n    "assetCode": "USDC",\\n    "payments": [\\n      {{\\n        "destination": "{sample_address_2}",\\n        "amount": 2500.0,\\n        "memo": "Milestone #1"\\n      }},\\n      {{\\n        "destination": "{sample_address_3}",\\n        "amount": 1500.0,\\n        "memo": "Milestone #2"\\n      }}\\n    ]\\n  }}'
                elif "escrow" in path and method == "POST":
                    data_str = f'{{\\n    "depositor": "{sample_address_1}",\\n    "beneficiary": "{sample_address_2}",\\n    "arbiter": "{sample_address_3}",\\n    "amount": "100000000",\\n    "asset": "native",\\n    "deadline": 1787900000,\\n    "metadata": "Security deposit"\\n  }}'
                elif "stream" in path and method == "POST":
                    data_str = f'{{\\n    "sender": "{sample_address_1}",\\n    "recipient": "{sample_address_2}",\\n    "totalDeposit": "300000000",\\n    "asset": "native",\\n    "durationSeconds": 2592000\\n  }}'
                elif "recurring" in path and method == "POST":
                    data_str = f'{{\\n    "destinationAddress": "{sample_address_2}",\\n    "amount": 49.00,\\n    "assetCode": "USDC",\\n    "frequency": "MONTHLY",\\n    "startDate": "2026-09-01T00:00:00Z"\\n  }}'
                elif "request" in path and method == "POST":
                    data_str = f'{{\\n    "amount": 120.00,\\n    "assetCode": "USDC",\\n    "description": "Invoice #884",\\n    "recipientAddress": "{sample_address_2}"\\n  }}'
                elif "webhook" in path and method == "POST":
                    data_str = '{\\n    "url": "https://api.merchant.com/webhooks/ophirpay",\\n    "events": ["payment.completed", "refund.created"]\\n  }'
                elif "key" in path and method == "POST":
                    data_str = '{\\n    "name": "Production Server Key"\\n  }'
                elif "session" in path and method == "POST":
                    data_str = f'{{\\n    "publicKey": "{sample_address_1}",\\n    "signature": "3045022100...abcd...",\\n    "challenge": "OphirPay Sign-In: 1787740000"\\n  }}'
                elif "propose" in path and method == "POST":
                    data_str = f'{{\\n    "recipient": "{sample_address_2}",\\n    "amount": "5000000000",\\n    "asset": "native",\\n    "description": "Grant Disbursement"\\n  }}'
                elif "approve" in path and method == "POST":
                    data_str = f'{{\\n    "proposalId": 12,\\n    "signer": "{sample_address_2}"\\n  }}'
                elif "multisig" in path and "execute" in path and method == "POST":
                    data_str = '{\\n    "proposalId": 12\\n  }'
                elif "multisig" in path and method == "POST":
                    data_str = f'{{\\n    "threshold": 2,\\n    "signers": ["{sample_address_1}", "{sample_address_2}", "{sample_address_3}"]\\n  }}'
                elif "governance/proposals" in path and method == "POST":
                    data_str = '{\\n    "title": "Add EURC Token Support",\\n    "description": "Integrate Circle EURC stablecoin",\\n    "actionContract": "CABC123...",\\n    "actionFunction": "add_asset"\\n  }'
                elif "governance/vote" in path and method == "POST":
                    data_str = '{\\n    "proposalId": 1,\\n    "support": true\\n  }'
                elif "governance/execute" in path and method == "POST":
                    data_str = '{\\n    "proposalId": 1\\n  }'
                elif "refunds" in path and method == "POST":
                    data_str = '{\\n    "paymentId": "pay_9a8b7c6d",\\n    "reasonCode": "SERVICE_NOT_DELIVERED",\\n    "reasonDetails": "Order cancelled"\\n  }'
                elif "hooks" in path and method == "POST":
                    data_str = f'{{\\n    "eventType": "payment_recorded",\\n    "endpointUrl": "https://api.partner.com/events",\\n    "subscriberAddress": "{sample_address_1}"\\n  }}'
                elif method == "PATCH":
                    data_str = '{\\n    "status": "COMPLETED"\\n  }'
                else:
                    data_str = '{\\n    "enabled": true\\n  }'

            curl_lines = [f'curl -X {method} "http://localhost:3000{clean_path}"']
            for h in headers:
                curl_lines.append(f"  {h}")
            if data_str:
                curl_lines.append(f"  -d '{data_str}'")
                
            lines.append("#### Request")
            lines.append("```bash")
            lines.append(" \\\n".join(curl_lines))
            lines.append("```\n")
            
            # Response
            lines.append("#### Response")
            lines.append("```json")
            if method == "DELETE":
                lines.append('{\n  "success": true,\n  "message": "Resource deleted successfully"\n}')
            elif "health" in path:
                lines.append('{\n  "status": "healthy",\n  "timestamp": "2026-08-26T13:50:00.000Z",\n  "services": {\n    "database": "up",\n    "stellarRpc": "up"\n  },\n  "version": "0.1.0"\n}')
            elif "metrics" in path:
                lines.append('{\n  "http_requests_total": 572,\n  "http_request_duration_seconds_avg": 0.042\n}')
            elif "csrf" in path:
                lines.append('{\n  "csrfToken": "9f8e7d6c5b4a3210fedcba9876543210"\n}')
            elif "policy-versions" in path:
                lines.append('{\n  "policies": [\n    {\n      "policyType": "fee_config",\n      "currentVersion": 2,\n      "lastUpdated": "2026-08-01T00:00:00.000Z"\n    }\n  ]\n}')
            elif "collector" in path:
                lines.append(f'{{\n  "feeCollector": "{sample_address_2}"\n}}')
            elif "fee-config" in path:
                lines.append('{\n  "feeBps": 10,\n  "minFeeStroops": "1000",\n  "maxFeeStroops": "50000000"\n}')
            elif "contracts" in path:
                lines.append('{\n  "network": "testnet",\n  "ophirpayContractId": "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",\n  "emitterContractId": "CBRCW7Z46C7E2YQ2MOHW5V2D3VOHK5W5N36C3G7Y7N6O5Z3Y4Z3Y4Z3Y",\n  "version": "0.1.0"\n}')
            elif "stats" in path:
                lines.append('{\n  "totalRecordedPayments": 12500,\n  "activeEscrowsCount": 18,\n  "activeStreamsCount": 7,\n  "contractVersion": "0.1.0"\n}')
            elif "timelock" in path:
                lines.append(f'{{\n  "actions": [\n    {{\n      "actionId": "tl_01",\n      "functionName": "transfer_ownership",\n      "targetAddress": "{sample_address_2}",\n      "unlocksAt": 1787820000,\n      "canExecute": false\n    }}\n  ]\n}}')
            elif "rbac" in path:
                lines.append(f'{{\n  "address": "{sample_address_1}",\n  "roles": ["OPERATOR", "ARBITER"]\n}}')
            elif "events" in path and "history" not in path:
                lines.append('data: {"event":"payment_completed","paymentId":"pay_9a8b7c6d","amount":100.5,"asset":"USDC"}')
            elif "events/history" in path:
                lines.append(f'{{\n  "events": [\n    {{\n      "type": "payment_recorded",\n      "ledger": 1284930,\n      "txHash": "{sample_tx_hash}",\n      "timestamp": "2026-08-26T12:00:00.000Z"\n    }}\n  ]\n}}')
            elif "audit-log/sse" in path:
                lines.append('data: {"id":"log_102","action":"payment_recorded","timestamp":"2026-08-26T13:50:00.000Z"}')
            elif "audit-log" in path:
                lines.append(f'{{\n  "records": [\n    {{\n      "id": "log_101",\n      "action": "fee_config_updated",\n      "actor": "{sample_address_1}",\n      "timestamp": "2026-08-26T11:00:00.000Z"\n    }}\n  ]\n}}')
            elif "analytics" in path:
                lines.append('{\n  "totalVolumeUSD": 450000.00,\n  "paymentsCount": 3840,\n  "successfulPayments": 3810,\n  "failedPayments": 30,\n  "assetBreakdown": {\n    "USDC": 320000.00,\n    "XLM": 130000.00\n  }\n}')
            elif "multisig/requests" in path:
                lines.append(f'{{\n  "pending": [\n    {{\n      "proposalId": 12,\n      "recipient": "{sample_address_2}",\n      "amount": "5000000000",\n      "asset": "native",\n      "approvals": ["{sample_address_1}"]\n    }}\n  ]\n}}')
            elif "multisig/propose" in path:
                lines.append('{\n  "proposalId": 12,\n  "status": "PENDING_APPROVALS",\n  "approvalsCount": 1,\n  "requiredThreshold": 2\n}')
            elif "multisig/approve" in path:
                lines.append('{\n  "proposalId": 12,\n  "approvalsCount": 2,\n  "thresholdMet": true\n}')
            elif "multisig/execute" in path:
                lines.append(f'{{\n  "success": true,\n  "proposalId": 12,\n  "txHash": "{sample_tx_hash}"\n}}')
            elif "multisig" in path and method == "GET":
                lines.append(f'{{\n  "threshold": 2,\n  "signers": [\n    "{sample_address_1}",\n    "{sample_address_2}",\n    "{sample_address_3}"\n  ]\n}}')
            elif "governance/proposals" in path and method == "GET":
                lines.append(f'{{\n  "proposals": [\n    {{\n      "id": 1,\n      "title": "Lower platform fee to 0.05%",\n      "proposer": "{sample_address_1}",\n      "forVotes": "1200000",\n      "againstVotes": "45000",\n      "status": "ACTIVE",\n      "votingEnds": 1788200000\n    }}\n  ]\n}}')
            elif "governance/proposals" in path and method == "POST":
                lines.append('{\n  "id": 2,\n  "title": "Add EURC Token Support",\n  "status": "ACTIVE",\n  "votingEnds": 1788500000\n}')
            elif "governance/vote" in path:
                lines.append(f'{{\n  "success": true,\n  "proposalId": 1,\n  "voter": "{sample_address_1}",\n  "voteWeight": "50000"\n}}')
            elif "governance/execute" in path:
                lines.append(f'{{\n  "success": true,\n  "proposalId": 1,\n  "executed": true,\n  "txHash": "{sample_tx_hash}"\n}}')
            elif "keys" in path and method == "POST":
                lines.append('{\n  "id": "key_02",\n  "name": "Production Server Key",\n  "apiKey": "ophir_live_sk_4b8f1c3d7e9a2b5c8d0e3f6a9b1c4d7e",\n  "createdAt": "2026-08-26T13:40:00.000Z"\n}')
            elif "keys" in path and method == "GET":
                lines.append('{\n  "keys": [\n    {\n      "id": "key_01",\n      "name": "Backend Service Production",\n      "prefix": "ophir_live_sk_7f8a...",\n      "createdAt": "2026-08-01T00:00:00.000Z",\n      "lastUsedAt": "2026-08-26T12:00:00.000Z"\n    }\n  ]\n}')
            elif "webhooks" in path and method == "POST":
                lines.append('{\n  "id": "whk_02",\n  "url": "https://api.merchant.com/webhooks/ophirpay",\n  "secret": "sec_mock_webhook_secret_key_example",\n  "events": ["payment.completed", "refund.created"],\n  "active": true\n}')
            elif "webhooks" in path and method == "GET":
                lines.append('{\n  "webhooks": [\n    {\n      "id": "whk_01",\n      "url": "https://api.merchant.com/webhooks/ophirpay",\n      "events": ["payment.completed", "batch.completed"],\n      "active": true,\n      "createdAt": "2026-08-20T10:00:00.000Z"\n    }\n  ]\n}')
            elif "auth/session" in path and method == "POST":
                lines.append(f'{{\n  "success": true,\n  "publicKey": "{sample_address_1}",\n  "expiresAt": "2026-08-27T13:45:00.000Z"\n}}')
            elif "refunds" in path and method == "POST":
                lines.append('{\n  "id": "ref_02",\n  "paymentId": "pay_9a8b7c6d",\n  "status": "PENDING_REVIEW",\n  "reasonCode": "SERVICE_NOT_DELIVERED"\n}')
            elif "refunds" in path and method == "GET":
                lines.append('{\n  "refunds": [\n    {\n      "id": "ref_01",\n      "paymentId": "pay_9a8b7c6d",\n      "reasonCode": "DUPLICATE_PAYMENT",\n      "status": "APPROVED",\n      "amount": 100.5,\n      "createdAt": "2026-08-25T15:00:00.000Z"\n    }\n  ]\n}')
            elif "hooks" in path and method == "POST":
                lines.append('{\n  "id": "hook_02",\n  "eventType": "payment_recorded",\n  "active": true\n}')
            elif "hooks" in path and method == "GET":
                lines.append('{\n  "hooks": [\n    {\n      "id": "hook_01",\n      "eventType": "payment_recorded",\n      "endpointUrl": "https://partner.example.com/ophir-events",\n      "active": true\n    }\n  ]\n}')
            elif "escrows" in path and method == "POST":
                lines.append(f'{{\n  "id": "2",\n  "status": "PENDING_DEPOSIT",\n  "depositor": "{sample_address_1}",\n  "beneficiary": "{sample_address_2}",\n  "amount": "500000000"\n}}')
            elif "escrows" in path and method == "GET":
                lines.append(f'{{\n  "escrows": [\n    {{\n      "id": "1",\n      "depositor": "{sample_address_1}",\n      "beneficiary": "{sample_address_2}",\n      "arbiter": "{sample_address_3}",\n      "amount": "100000000",\n      "asset": "native",\n      "deadline": 1787800000,\n      "status": "ACTIVE",\n      "metadata": "App development milestone escrow"\n    }}\n  ]\n}}')
            elif "streams" in path and method == "POST":
                lines.append(f'{{\n  "id": "stream_2",\n  "sender": "{sample_address_1}",\n  "recipient": "{sample_address_2}",\n  "ratePerSecond": "115740",\n  "status": "INITIALIZED"\n}}')
            elif "streams" in path and method == "GET":
                lines.append(f'{{\n  "streams": [\n    {{\n      "id": "stream_1",\n      "sender": "{sample_address_1}",\n      "recipient": "{sample_address_2}",\n      "ratePerSecond": "115740",\n      "remainingBalance": "300000000",\n      "startTime": 1787700000,\n      "stopTime": 1790292000,\n      "status": "STREAMING"\n    }}\n  ]\n}}')
            elif "recurring" in path and method == "POST":
                lines.append(f'{{\n  "id": "rec_87654321-fedc-ba09-8765-43210fedcba9",\n  "destinationAddress": "{sample_address_2}",\n  "amount": 49.00,\n  "assetCode": "USDC",\n  "frequency": "MONTHLY",\n  "status": "ACTIVE"\n}}')
            elif "recurring" in path and method == "GET":
                lines.append(f'{{\n  "data": [\n    {{\n      "id": "rec_12345678-abcd-ef01-2345-6789abcdef01",\n      "destinationAddress": "{sample_address_2}",\n      "amount": 29.99,\n      "assetCode": "USDC",\n      "frequency": "MONTHLY",\n      "nextExecution": "2026-09-01T00:00:00.000Z",\n      "status": "ACTIVE"\n    }}\n  ]\n}}')
            elif "requests" in path and method == "POST":
                lines.append('{\n  "id": "req_xyz789",\n  "amount": 120.00,\n  "assetCode": "USDC",\n  "checkoutUrl": "https://ophirpay.com/pay/req_xyz789",\n  "expiresAt": "2026-08-27T13:30:00.000Z"\n}')
            elif "requests" in path and method == "GET":
                lines.append(f'{{\n  "requests": [\n    {{\n      "id": "req_abc123",\n      "payee": "{sample_address_2}",\n      "amount": 75.0,\n      "assetCode": "USDC",\n      "status": "PENDING",\n      "checkoutUrl": "https://ophirpay.com/pay/req_abc123"\n    }}\n  ]\n}}')
            elif "batches" in path and method == "POST":
                lines.append('{\n  "id": "batch_99887766-5544-3322-1100-aabbccddeeff",\n  "name": "Contractor Disbursements Wave 1",\n  "totalAmount": 4300.0,\n  "assetCode": "USDC",\n  "itemCount": 2,\n  "status": "PENDING",\n  "createdAt": "2026-08-26T13:10:00.000Z"\n}')
            elif "batches" in path and method == "GET":
                lines.append('{\n  "data": [\n    {\n      "id": "batch_11223344-aabb-ccdd-eeff-001122334455",\n      "name": "August Payroll",\n      "totalAmount": 12500.0,\n      "assetCode": "USDC",\n      "totalCount": 25,\n      "status": "PROCESSING",\n      "createdAt": "2026-08-26T08:00:00.000Z"\n    }\n  ],\n  "total": 1,\n  "page": 1,\n  "limit": 10\n}')
            elif "payments" in path and method == "POST":
                lines.append(f'{{\n  "id": "pay_5f6e7d8c-4321-8765-ba09-fedc87654321",\n  "amount": 50.0,\n  "assetCode": "XLM",\n  "status": "PENDING",\n  "sourceAddress": "{sample_address_1}",\n  "destinationAddress": "{sample_address_2}",\n  "memo": "Payment for software design",\n  "txHash": null,\n  "createdAt": "2026-08-26T13:00:00.000Z",\n  "updatedAt": "2026-08-26T13:00:00.000Z"\n}}')
            elif "payments" in path and method == "GET":
                lines.append(f'{{\n  "data": [\n    {{\n      "id": "pay_9a8b7c6d-1234-5678-90ab-cdef12345678",\n      "amount": 100.5,\n      "assetCode": "USDC",\n      "status": "COMPLETED",\n      "sourceAddress": "{sample_address_1}",\n      "destinationAddress": "{sample_address_2}",\n      "memo": "Invoice #1042",\n      "txHash": "{sample_tx_hash}",\n      "createdAt": "2026-08-26T12:00:00.000Z",\n      "updatedAt": "2026-08-26T12:01:30.000Z"\n    }}\n  ],\n  "total": 1,\n  "page": 1,\n  "limit": 10,\n  "totalPages": 1\n}}')
            else:
                lines.append('{\n  "success": true\n}')
            lines.append("```\n")
            lines.append("---\n")

    lines.extend([
        "## Standard Error Responses",
        "",
        "All API error responses follow a consistent JSON structure:",
        "",
        "```json",
        "{",
        '  "error": "Error message description",',
        '  "code": "ERROR_CODE",',
        '  "statusCode": 400',
        "}",
        "```",
        "",
        "### Common HTTP Status Codes",
        "",
        "| Status Code | Code Identifier | Description |",
        "|---|---|---|",
        "| `400 Bad Request` | `VALIDATION_ERROR` | Malformed request body, invalid Stellar address, or negative amount |",
        "| `401 Unauthorized` | `UNAUTHORIZED` | Missing or invalid API key or session cookie |",
        "| `403 Forbidden` | `FORBIDDEN` | Insufficient permissions for operation or CSRF verification failure |",
        "| `404 Not Found` | `NOT_FOUND` | Resource ID does not exist |",
        "| `409 Conflict` | `CONFLICT` | Unique constraint violation (e.g. duplicate transaction hash) |",
        "| `429 Too Many Requests` | `RATE_LIMITED` | Exceeded rate limit quota |",
        "| `500 Internal Error` | `INTERNAL_ERROR` | Server-side execution exception |",
        "| `503 Service Unavailable` | `SERVICE_UNAVAILABLE` | Database or Stellar RPC connectivity issues |",
        "",
        "---",
        "",
        "*Authored for the OphirPay Developer Community. For further questions or contract deployment details, see the [Integration Guide](./integration-guide.md) or [OpenAPI Spec](./openapi.yaml).*",
        ""
    ])
    
    output_path = Path("docs/API_COOKBOOK.md")
    output_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Generated {output_path} with {len(lines)} lines successfully.")

if __name__ == "__main__":
    generate()
