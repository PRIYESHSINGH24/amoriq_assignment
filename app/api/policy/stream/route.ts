import { state } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  let callback: ((data: string) => void) | null = null;
  
  const stream = new ReadableStream({
    start(controller) {
      // Stream initial ping to establish connection
      controller.enqueue(`data: ${JSON.stringify(state.policy)}\n\n`);
      
      callback = (data: string) => {
        try {
          controller.enqueue(`data: ${data}\n\n`);
        } catch (e) {
          // Client dropped, ignore
        }
      };
      
      state.sseClients.push(callback);
    },
    cancel() {
      if (callback) {
        state.sseClients = state.sseClients.filter(c => c !== callback);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Encoding": "none"
    }
  });
}
