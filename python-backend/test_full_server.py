import asyncio
import websockets
import urllib.request
import sys

sys.path.insert(0, '.')
from server import Agent7Server

async def test():
    server = Agent7Server(host='127.0.0.1', port=8775)
    
    # Start server
    server_task = asyncio.create_task(server.start())
    await asyncio.sleep(2)  # Wait for server to start
    
    try:
        # Test HTTP request
        print("Testing HTTP...")
        response = urllib.request.urlopen('http://127.0.0.1:8775/')
        print(f"✅ HTTP Status: {response.status}")
        print(f"   Body preview: {response.read().decode()[:80]}...")
        
        # Test favicon
        print("\nTesting favicon.ico...")
        response = urllib.request.urlopen('http://127.0.0.1:8775/favicon.ico')
        print(f"✅ Favicon Status: {response.status}")
        
        # Test WebSocket
        print("\nTesting WebSocket...")
        async with websockets.connect('ws://127.0.0.1:8775') as ws:
            await ws.send('{"id": "1", "method": "ping", "params": {}}')
            msg = await ws.recv()
            print(f"✅ WebSocket works: {msg}")
        
        print("\n🎉 All tests passed!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        server_task.cancel()
        try:
            await server_task
        except asyncio.CancelledError:
            pass

asyncio.run(test())
