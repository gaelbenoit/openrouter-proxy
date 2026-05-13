# OpenRouter Proxy - Functional Specification

## Purpose
The OpenRouter Proxy is an intermediary service that enhances compatibility between AI client applications (particularly VS Code Claude Code extension) and the OpenRouter API. It provides header injection for accessing free models, fixes Server-Sent Event (SSE) streaming compatibility issues, manages API key rotation, and ensures reliable communication between clients and the OpenRouter service.

## Core Functionalities

### 1. Request Interception and Routing
- Accepts incoming HTTP and WebSocket connections on a configurable host and port
- Forwards valid requests to the OpenRouter API endpoint
- Maintains bidirectional communication channels for both standard requests and streaming responses
- Handles connection lifecycle including establishment, data transfer, and termination

### 2. Path Rewriting
- Automatically converts client requests targeting `/v1/*` endpoints to `/api/v1/*` 
- This ensures compatibility with clients that omit the `/api` prefix (such as VS Code Claude Code extension)
- Preserves query parameters, HTTP methods, and request bodies during rewriting

### 3. Header Management
- Strips hop-by-hop headers that should not be forwarded (connection, keep-alive, proxy-authenticate, proxy-authorization, te, trailers, transfer-encoding, upgrade)
- Removes specific client headers (host, x-forwarded-for) that are rebuilt by the proxy
- Injects required authentication and identification headers:
  - Authorization: Bearer [API_KEY] - dynamically obtained from key management system
  - HTTP-Referer: [configured value]
  - X-OpenRouter-Title: [configured value]
  - Reconstructed host header based on target service
  - X-Forwarded-For: client IP address
  - X-Forwarded-Host: original host header from client
  - X-Forwarded-Proto: "http"

### 4. API Key Management
- Maintains a pool of API keys with usage tracking
- Implements key rotation strategy:
  - On successful requests: marks key as used recently
  - On rate limit errors (HTTP 429): immediately rotates to a new key
  - On other error conditions: tracks failures and may deactivate keys after threshold
  - On initialization or when current key is unavailable: selects least recently used active key
- Handles key lifecycle events:
  - Key activation/reactivation
  - Key deactivation after repeated failures
  - Rate limit detection and handling
  - Success tracking for optimal key usage

### 5. Request Body Processing
- Buffers complete request bodies for inspection and potential modification
- Detects JSON payloads containing message arrays
- Processes mixed-content messages where tool_result blocks are combined with text blocks:
  - Separates tool_result blocks to be sent first
  - Sends text blocks in subsequent user messages
  - This prevents provider-side rejection due to insufficient tool messages following tool_calls

### 6. Server-Sent Event (SSE) Special Handling
#### General SSE Processing:
- Identifies SSE responses by Content-Type: text/event-stream
- Removes hop-by-hop and potentially conflicting headers (content-length, content-encoding, cache-control)
- Adds appropriate headers for SSE compatibility:
  - cache-control: no-cache, no-transform
  - connection: keep-alive
  - x-accel-buffering: no

#### VS Code Claude Code Extension Specific Fixes:
- Detects requests from VS Code Claude Code extension via User-Agent header
- Applies specialized SSE stream processing when both conditions are met:
  1. Response is SSE stream
  2. Request originates from VS Code Claude Code extension
- Implements event-based processing with these specific behaviors:
  - **Redacted Thinking Block Handling**:
    * Detects start of redacted thinking blocks (content_block_start containing "redacted_thinking")
    * Filters (does not forward) all events within redacted thinking blocks
    * Properly detects end of redacted thinking blocks (content_block_stop while in filtered state)
    * Maintains filtering state across multiple events within the same block
  - **Thinking Block Completion**:
    * Detects when thinking blocks end (transition from thinking to non-thinking content)
    * Automatically injects a synthetic signature_delta event upon thinking block completion
    * Uses predefined signature value: "dd9960d18582b741463f3ba1347853ee2ad01144306d9b1e07fd45808d81b171"
  - **Event Flow Management**:
    * Flushes accumulated content_block_stop events when encountering content_block_start
    * Maintains index tracking for content_block_stop events
    * Ensures proper ordering of message_stop and [DONE] events
    * Forwards all non-filtered events normally (data, content_block_start, content_block_stop, message_stop, etc.)

### 7. Streaming Response Handling
- For SSE responses:
  * Optionally logs SSE events while passing data through (when verbose logging enabled)
  * Applies specialized processing based on client type (as described above)
  * Ensures proper termination with message_stop and [DONE] events
- For non-SSE responses:
  * Passes data through unchanged
  * Optionally logs responses when verbose logging enabled

### 8. Error Handling and Resilience
- Implements comprehensive error handling for:
  * Client request errors (malformed requests, connection issues)
  * Upstream request errors (DNS failures, connection timeouts to OpenRouter)
  * Upstream response errors (HTTP error statuses from OpenRouter)
  * WebSocket proxy errors
- Applies appropriate HTTP status codes to clients:
  * 502 Bad Gateway for upstream errors
  * 400 Bad Request for client errors
- Implements request timeouts:
  * No timeout for SSE streams (indefinite)
  * 60 second timeout for regular requests
- Tracks key performance and marks keys as:
  * Successful on normal completion (status < 400 and ≠ 429)
  * Failed on rate limiting (status = 429)
  * Failed on other error statuses (status ≥ 400)
  * Failed on any connection or processing errors

### 9. Connection Management
- Properly handles HTTP connection lifecycle:
  * Chunked request body processing
  * Content-Length header management
  - Connection closure detection
- Manages WebSocket connections:
  * Upgrade request handling
  - Proper WebSocket handshake forwarding
  - Bidirectional data piping between client and upstream
  - Error propagation in both directions
- Ensures resource cleanup:
  * Socket destruction on errors
  * Proper connection termination
  * Timeout-based cleanup for stalled connections

### 10. Logging and Observability
- Provides structured logging through configurable loggers:
  * Request logging (incoming/outgoing HTTP details)
  * Error logging (exceptions and failure conditions)
  * Key management logging (rotation, success, failure events)
  * SSE-specific logging (when verbose enabled)
  * Proxy operation logging (when verbose enabled)
  * WebSocket logging (when verbose enabled)
- Includes timestamped entries for traceability
- Supports different log levels (info, error, warn, debug)
- Categorizes logs by context (SSE, PROXY, WS) for easier filtering

## Operational Flow

### For Standard HTTP Requests:
1. Client connects to proxy and sends HTTP request
2. Proxy receives and parses request
3. Proxy rewrites path if needed (/v1/* → /api/v1/*)
4. Proxy builds headers:
   * Strips hop-by-hop and restricted headers
   * Adds required injection headers
   * Adds current API key from key manager
   * Adds forwarding headers (X-Forwarded-For, etc.)
5. Proxy buffers request body for potential modification
6. If JSON with messages array detected:
   * Applies mixed message separation if needed
   * Reserializes modified JSON
7. Proxy establishes connection to OpenRouter API
8. Proxy forwards request with modified headers and body
9. Proxy receives response from OpenRouter:
   * For SSE responses: applies special SSE processing
   * For non-SSE responses: passes through directly
10. Proxy sends response back to client
11. On completion:
    * If successful: marks current key as successful
    * If error: marks current key as failed with appropriate error
12. Resources are cleaned up

### For WebSocket Connections:
1. Client sends WebSocket upgrade request to proxy
2. Proxy validates and forwards upgrade request to OpenRouter
3. Upon successful upgrade:
   * Pipes data bidirectionally between client and OpenRouter
   * Maintains connection until termination by either party
   * Propagates errors in both directions
4. On termination or error:
   * Cleans up both client and upstream connections

## Configuration Aspects

### Network Configuration:
- Listen interface and port (default: 127.0.0.1:8899)
- Target OpenRouter endpoint (protocol, hostname, port)
- SSL/TLS verification settings

### Behavioral Configuration:
- Verbose logging toggle
- User agent strings that trigger VS Code Claude Code specific SSE fixes
- Header injection values (HTTP-Referer, X-OpenRouter-Title)
- Key management behavior (failure thresholds, rotation policies)

### Header Configuration:
- Headers to strip from client requests
- Hop-by-hop headers to never forward
- Headers to inject into every proxied request

## Security Considerations

- API keys are never logged in plain text (shown as ***REDACTED*** in logs)
- The proxy acts as a trusted intermediary - only suitable for use in controlled environments
- Input validation is performed on request paths and methods
- Error messages sent to clients are generic to avoid information leakage
- Connection timeouts prevent resource exhaustion from stalled clients
- WebSocket connections are properly validated and forwarded

## Error Conditions Handled

### Client-Side Errors:
- Malformed HTTP requests
- Invalid WebSocket upgrade requests
- Connection aborts during request transmission
- Request timeouts

### Upstream-Side Errors:
- DNS resolution failures for OpenRouter
- Connection timeouts to OpenRouter
- HTTP error responses from OpenRouter (particularly 429 rate limiting)
- Malformed or incomplete responses from OpenRouter
- WebSocket connection failures to OpenRouter

### Internal Processing Errors:
- JSON parsing errors in request bodies
- Key management failures (no available keys, database errors)
- Memory allocation issues during body buffering
- SSE stream processing anomalies

Each error condition results in appropriate client-side error responses and proper key state updates in the management system.

## Compatibility Features

The proxy specifically addresses these compatibility issues:
1. Path prefix mismatch between client expectations (/v1/) and OpenRouter API (/api/v1/)
2. Missing required headers for free model access (HTTP-Referer, X-OpenRouter-Title)
3. SSE streaming incompatibilities in VS Code Claude Code extension:
   * Improper handling of redacted thinking blocks
   * Missing signature_delta events upon thinking block completion
   * Incorrect event ordering and filtering
4. Mixed message handling requirements for certain AI providers accessed via OpenRouter

## Scalability and Performance Characteristics

- Designed for handling multiple concurrent connections
- Non-blocking I/O model for efficient resource utilization
- Per-connection state management prevents cross-talk between clients
- Key management system distributes load across available API keys
- Buffering limited to request bodies only (response bodies streamed directly)
- Timeout mechanisms prevent resource accumulation from faulty clients

## Deployment Considerations

- Requires network access to OpenRouter API endpoints
- Should be deployed in an environment where it can securely store and access API credentials
- Benefits from horizontal scaling behind a load balancer for high availability
- Log storage requirements should be monitored due to potential verbose logging
- Can be configured to listen on specific interfaces for security boundary enforcement

This functional specification provides a complete description of the OpenRouter Proxy's behavior sufficient to reimplement the functionality in any programming language or framework, focusing on what the system does rather than how it is implemented in the current codebase.