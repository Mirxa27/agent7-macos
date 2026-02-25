import asyncio
import websockets

async def test():
    async def handler(websocket, path=None):
        print(f"WebSocket connection from {websocket.remote_address}")
    
    # process_request can return:
    # - None to continue with WebSocket handshake
    # - HTTPResponse or bytes to send HTTP response
    def process_request(path, request_headers):
        print(f"HTTP request: {path}")
        if path == "/favicon.ico":
            # Return 204 No Content for favicon
            return (204, [], b"")
        # Return simple HTML for other paths
        body = b"<h1>Agent7 Backend</h1><p>WebSocket server running</p>"
        return (200, [(b"Content-Type", b"text/html")], body)
    
    print("Starting server on port 8770...")
    stop = asyncio.Future()
    
    async def run_server():
        async with websockets.serve(
            handler, 
            '127.0.0.1', 
            8770,
            process_request=process_request
        ):
            await stop
    
    server_task = asyncio.create_task(run_server())
    await asyncio.sleep(2)  # Let server start
    
    # Test HTTP
    import urllib.request
    try:
        response = urllib.request.urlopen('http://127.0.0.1:8770/')
        print(f"HTTP Response: {response.status}")
        print(f"Body: {response.read().decode()[:100]}")
    except Exception as e:
        print(f"HTTP Error: {e}")
    
    # Test favicon
    try:
        response = urllib.request.urlopen('http://127.0.0.1:8770/favicon.ico')
        print(f"Favicon Response: {response.status}")
    except Exception as e:
        print(f"Favicon Error: {e}")
    
    stop.set_result(None)
    await server_task

asyncio.run(test())
