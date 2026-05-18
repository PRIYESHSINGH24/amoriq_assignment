import { NextResponse } from "next/server";
import { discoverTools } from "@/lib/mcp";

export async function GET() {
  try {
    const discovered = await discoverTools();
    const allTools: any[] = [];
    
    for (const [server, list] of Object.entries(discovered)) {
      list.forEach((t: any) => {
        allTools.push({ ...t, server });
      });
    }
    
    return NextResponse.json({ tools: allTools });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
