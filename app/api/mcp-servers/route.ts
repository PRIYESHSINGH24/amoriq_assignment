import { NextResponse } from "next/server";
import axios from "axios";
import { state } from "@/lib/state";

export async function GET() {
  return NextResponse.json({ servers: state.mcpServers });
}

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url) {
      return NextResponse.json({ error: "Server URL is required" }, { status: 400 });
    }
    
    if (!state.mcpServers.includes(url)) {
      // Validate that the server is active and exposes tools
      try {
        await axios.get(`${url}/tools`, { timeout: 3000 });
        state.mcpServers.push(url);
      } catch (e: any) {
        return NextResponse.json({ error: `Failed to discover tools from server: ${e.message}` }, { status: 400 });
      }
    }
    
    return NextResponse.json({ status: "ok", servers: state.mcpServers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { url } = await req.json();
    state.mcpServers = state.mcpServers.filter(s => s !== url);
    return NextResponse.json({ status: "ok", servers: state.mcpServers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
