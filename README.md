# Neo4j Aura Agent & MCP Front-End Client

A pure, zero-middleware web front-end designed to connect directly to **Neo4j Aura Agent** and **Neo4j MCP (Model Context Protocol)** hosted endpoints.

---

## 🌟 Key Features

- **Direct Aura Connection**: No custom heavy backend needed. Plugs straight into your Aura Agent REST API or MCP endpoint.
- **Support for Both Protocols**:
  - **Aura Agent REST API**: Direct JSON queries (`message`, `prompt`, `sessionId`).
  - **Neo4j MCP Endpoint**: JSON-RPC standard (`tools/call` with `execute_query` or custom tools).
- **Graph Reasoning & Cypher Trace**: Automatically parses and displays grounded Cypher queries, graph entities, and agent reasoning traces in an expandable drawer.
- **Secure Local Storage**: Endpoint URL, Auth tokens, and session identifiers are stored safely in browser `localStorage`.
- **Live Connection Tester**: Ping your Aura endpoint directly from the settings drawer with latency diagnostics.
- **Modern Aesthetics**: Sleek dark mode with Neo4j cyan accents, markdown rendering, and code syntax highlighting.

---

## 🚀 How to Run

### Method 1: Python Dev Server (Recommended)
From this directory, run:
```bash
python server.py
```
Open **[http://localhost:8080](http://localhost:8080)** in your browser.

### Method 2: Direct Open
Double-click `index.html` to open directly in any web browser.

---

## ⚙️ Configuration Setup

1. Click the **Aura Credentials** button in the top right.
2. Select your protocol:
   - **Aura Agent REST API**: For standard published Aura Agents.
   - **Neo4j MCP Endpoint**: For hosted MCP instances (`https://<instance-id>.mcp-instances.neo4j.io`).
3. Enter your **Endpoint URL** and **API Key / Bearer Token**.
4. Click **Test Connection** to verify connectivity and latency.
5. Click **Save Credentials** and start chatting!
