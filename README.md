# OpenRouter Proxy

An intermediary service that enhances compatibility between AI client applications (particularly VS Code Claude Code extension) and the OpenRouter API.

## Features

- Request interception and routing
- Path rewriting (/v1/* to /api/v1/*)
- Header management (injection, stripping, reconstruction)
- API key pool management with rotation strategies
- Request body processing for mixed message separation
- Specialized Server-Sent Event (SSE) processing for VS Code Claude Code
- Comprehensive error handling and resilience
- Connection management for HTTP and WebSocket
- Structured logging and observability

## Architecture

The proxy follows a pipeline pattern where each request passes through sequential stages:
1. Path rewriting
2. Header management  
3. Key management
4. Request body processing
5. Upstream connection
6. Response processing (with SSE specialization)
7. Client response

## Installation

```bash
npm install
```

## Usage

```bash
npm start
```

For development with auto-restart:

```bash
npm run dev
```

## Testing

```bash
npm test
```

## License

MIT