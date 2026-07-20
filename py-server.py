#!/usr/bin/env python3
"""Lightweight HTTP server for NexusCorp Business OS - serves pre-built static files."""
import http.server
import socketserver
import json
import os
import sys
import subprocess
import threading
import re

PORT = 3000
BASE_DIR = '/home/z/my-project'
STATIC_DIR = os.path.join(BASE_DIR, '.next', 'static')
STANDALONE_DIR = os.path.join(BASE_DIR, '.next', 'standalone')
PUBLIC_DIR = os.path.join(BASE_DIR, 'public')

# Read pre-rendered HTML
with open(os.path.join(STANDALONE_DIR, '.next', 'server', 'app', 'index.html'), 'r') as f:
    INDEX_HTML = f.read()

MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
    '.txt': 'text/plain',
}

# API route handling via Node.js subprocess (lazy, on-demand)
api_lock = threading.Lock()

def handle_api(url_path):
    """Handle API requests by spawning a lightweight node process."""
    # Map URL to route file
    fs_route = url_path.replace('/api/', 'app/api/')
    route_js = os.path.join(STANDALONE_DIR, '.next', 'server', fs_route, 'route.js')
    
    if not os.path.exists(route_js):
        # Try dynamic [id] route
        parts = url_path.rstrip('/').split('/')
        if len(parts) >= 4:
            dynamic_route = '/'.join(parts[:-1])
            dynamic_js = os.path.join(STANDALONE_DIR, '.next', 'server', 
                                      dynamic_route.replace('/api/', 'app/api/'), '[id]', 'route.js')
            if os.path.exists(dynamic_js):
                route_js = dynamic_js
            else:
                return 404, json.dumps({'error': 'Not found'})
        else:
            return 404, json.dumps({'error': 'Not found'})
    
    try:
        # Use a small Node.js script to execute the route handler
        runner = f'''
        const mod = require('{route_js}');
        const req = {{ url: '{url_path}', method: 'GET', query: {{}} }};
        mod.GET(req).then(r => {{
          const body = typeof r === 'string' ? r : JSON.stringify(r);
          process.stdout.write('STATUS:200\\n');
          process.stdout.write(body);
          process.exit(0);
        }}).catch(e => {{
          process.stdout.write('STATUS:500\\n');
          process.stdout.write(JSON.stringify({{error: e.message}}));
          process.exit(1);
        }});
        '''
        result = subprocess.run(
            ['node', '-e', runner],
            capture_output=True, text=True, timeout=10,
            cwd=STANDALONE_DIR,
            env={**os.environ, 'DATABASE_URL': 'file:/home/z/my-project/db/custom.db'}
        )
        
        output = result.stdout
        if 'STATUS:200' in output:
            body = output.split('STATUS:200\\n', 1)[1] if 'STATUS:200\\n' in output else output
            body = output.split('\n', 1)[1] if '\n' in output else output
            return 200, body
        else:
            return 500, json.dumps({'error': result.stderr[:200] or 'API error'})
    except subprocess.TimeoutExpired:
        return 504, json.dumps({'error': 'Timeout'})
    except Exception as e:
        return 500, json.dumps({'error': str(e)})


class NexusCorpHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress logs
    
    def do_GET(self):
        path = self.path.split('?')[0]
        
        # API routes
        if path.startswith('/api/'):
            status, body = handle_api(path)
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body.encode())
            return
        
        # Static _next/ files
        if path.startswith('/_next/static/'):
            relative = path.replace('/_next/static/', '')
            fpath = os.path.join(STATIC_DIR, relative)
            if os.path.exists(fpath):
                ext = os.path.splitext(fpath)[1]
                self.send_response(200)
                self.send_header('Content-Type', MIME_TYPES.get(ext, 'application/octet-stream'))
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
                self.end_headers()
                with open(fpath, 'rb') as f:
                    self.wfile.write(f.read())
                return
        
        # Public files
        fpath = os.path.join(PUBLIC_DIR, path.lstrip('/'))
        if os.path.isfile(fpath):
            ext = os.path.splitext(fpath)[1]
            self.send_response(200)
            self.send_header('Content-Type', MIME_TYPES.get(ext, 'application/octet-stream'))
            self.end_headers()
            with open(fpath, 'rb') as f:
                self.wfile.write(f.read())
            return
        
        # SPA fallback
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(INDEX_HTML.encode())
    
    def do_POST(self):
        path = self.path.split('?')[0]
        if path.startswith('/api/'):
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode() if content_length > 0 else ''
            
            status, resp_body = handle_api(path)
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(resp_body.encode())
        else:
            self.send_response(405)
            self.end_headers()
    
    def do_PUT(self):
        self.do_POST()
    
    def do_DELETE(self):
        self.do_GET()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True
    allow_reuse_port = True

if __name__ == '__main__':
    with ReusableTCPServer(('0.0.0.0', PORT), NexusCorpHandler) as httpd:
        print(f'Python server running on http://0.0.0.0:{PORT}', flush=True)
        httpd.serve_forever()
