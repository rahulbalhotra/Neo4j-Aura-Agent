"""
Lightweight Multithreaded Static Server, OAuth Relay, & API Proxy for Neo4j Aura
Run with: python server.py
Serves at: http://localhost:8080
"""

import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import base64
import os
import sys

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class AuraDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key')
        self.end_headers()

    def do_POST(self):
        # 1. OAuth token helper endpoint
        if self.path == '/api/token':
            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length)
            try:
                data = json.loads(post_body.decode('utf-8'))
                client_id = data.get('client_id')
                client_secret = data.get('client_secret')
                auth_type = data.get('auth_type', 'mcp')

                if auth_type == 'mcp':
                    url = 'https://mcp.neo4j.io/oauth/token'
                    payload = urllib.parse.urlencode({
                        'grant_type': 'client_credentials',
                        'client_id': client_id,
                        'client_secret': client_secret,
                        'audience': 'https://agent-mcp.neo4j.io'
                    }).encode()
                    req = urllib.request.Request(
                        url,
                        data=payload,
                        headers={'Content-Type': 'application/x-www-form-urlencoded'}
                    )
                else:
                    url = 'https://api.neo4j.io/oauth/token'
                    auth_str = f"{client_id}:{client_secret}"
                    auth_b64 = base64.b64encode(auth_str.encode()).decode()
                    payload = urllib.parse.urlencode({'grant_type': 'client_credentials'}).encode()
                    req = urllib.request.Request(
                        url,
                        data=payload,
                        headers={
                            'Authorization': f'Basic {auth_b64}',
                            'Content-Type': 'application/x-www-form-urlencoded'
                        }
                    )

                with urllib.request.urlopen(req, timeout=12) as response:
                    resp_data = response.read()
                    self.send_response(response.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(resp_data)
            except urllib.error.HTTPError as e:
                err_data = e.read()
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(err_data)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode())
            return

        # 2. CORS-free API Proxy for querying Aura Agent / MCP
        elif self.path == '/api/query':
            content_length = int(self.headers.get('Content-Length', 0))
            post_body = self.rfile.read(content_length)
            try:
                data = json.loads(post_body.decode('utf-8'))
                target_url = data.get('endpoint_url')
                auth_token = data.get('auth_token')
                payload = data.get('payload', {})

                headers = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': f'Bearer {auth_token}' if auth_token else ''
                }

                req = urllib.request.Request(
                    target_url,
                    data=json.dumps(payload).encode('utf-8'),
                    headers=headers
                )

                with urllib.request.urlopen(req, timeout=25) as response:
                    resp_data = response.read()
                    self.send_response(response.status)
                    self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(resp_data)
            except urllib.error.HTTPError as e:
                err_data = e.read()
                self.send_response(e.code)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(err_data)
            except Exception as e:
                self.send_response(502)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(json.dumps({'error': f'Proxy error: {str(e)}'}).encode())
            return

        super().do_POST()

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    print("=" * 65)
    print("Neo4j Aura Agent Web Client & Local Dev Server")
    print(f"Local URL: http://localhost:{PORT}")
    print(f"Workspace: {DIRECTORY}")
    print("=" * 65)
    with socketserver.ThreadingTCPServer(("", PORT), AuraDevHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
            sys.exit(0)
