import http from 'node:http'

const PORT = 3999
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  console.log(`[MockServer] ${req.method} ${url.pathname}`)

  // 1. RFC 9728 Protected Resource Metadata
  if (url.pathname === '/.well-known/oauth-protected-resource') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({
      resource: `http://127.0.0.1:${PORT}/mcp`,
      authorization_servers: [`http://127.0.0.1:${PORT}`],
    }))
    return
  }

  // 2. RFC 8414 Authorization Server Metadata
  if (url.pathname === '/.well-known/oauth-authorization-server') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({
      issuer: `http://127.0.0.1:${PORT}`,
      authorization_endpoint: `http://127.0.0.1:${PORT}/oauth/authorize`,
      token_endpoint: `http://127.0.0.1:${PORT}/oauth/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256', 'plain'],
    }))
    return
  }

  // 3. OAuth Authorize endpoint (Simulate user login and consent)
  if (url.pathname === '/oauth/authorize' || url.pathname === '/authorize') {
    const redirectUri = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')
    console.log(`[MockServer] Authorizing redirect to ${redirectUri}?code=mock_auth_code&state=${state}`)
    
    // Auto-approve and redirect back to client callback
    const target = new URL(redirectUri)
    target.searchParams.set('code', 'mock_auth_code_123')
    target.searchParams.set('state', state)
    res.writeHead(302, { Location: target.toString() })
    res.end()
    return
  }

  // 4. OAuth Token endpoint (Code exchange & refresh)
  if (url.pathname === '/oauth/token' || url.pathname === '/token') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({
      access_token: 'mock_access_token_secret_12345',
      token_type: 'Bearer',
      expires_in: 7200,
      refresh_token: 'mock_refresh_token_67890',
      scope: 'read write',
    }))
    return
  }

  // 5. MCP Streamable HTTP / SSE Endpoint
  if (url.pathname === '/mcp') {
    const auth = req.headers['authorization']
    if (!auth || !auth.startsWith('Bearer ')) {
      res.writeHead(401, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer resource_metadata="http://127.0.0.1:${PORT}/.well-known/oauth-protected-resource"`,
      })
      res.end(JSON.stringify({ error: 'Unauthorized: OAuth token required' }))
      return
    }

    if (req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      res.write(`event: endpoint\ndata: http://127.0.0.1:${PORT}/mcp/messages\n\n`)
      return
    }

    if (req.method === 'POST') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => {
        try {
          const msg = JSON.parse(body)
          if (msg.method === 'initialize') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                protocolVersion: '2024-11-05',
                capabilities: { tools: {} },
                serverInfo: { name: 'mock-oauth-server', version: '1.0.0' },
              },
            }))
            return
          }
          if (msg.method === 'tools/list') {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                tools: [
                  {
                    name: 'oauth_demo_tool',
                    description: 'A tool exposed via OAuth 2.0 authorized MCP server',
                    inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
                  },
                ],
              },
            }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} }))
        } catch {
          res.writeHead(400).end()
        }
      })
      return
    }
  }

  res.writeHead(404).end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[MockServer] Running at http://127.0.0.1:${PORT}`)
})
