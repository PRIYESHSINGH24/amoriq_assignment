import { NextResponse } from "next/server";
import { state, emitPolicyUpdate } from "@/lib/state";

export async function GET() {
  return NextResponse.json(state.policy);
}

export async function POST(req: Request) {
  try {
    const newPolicy = await req.json();
    state.policy = { ...state.policy, ...newPolicy };
    emitPolicyUpdate(); // Broadcast SSE update to live connections
    return NextResponse.json({ status: "ok", policy: state.policy });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
