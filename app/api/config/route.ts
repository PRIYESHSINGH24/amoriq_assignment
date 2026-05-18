import { NextResponse } from "next/server";
import { state } from "@/lib/state";

export async function GET() {
  return NextResponse.json({
    hasOpenAiKey: !!state.openaiApiKey,
    hasGeminiKey: !!state.geminiApiKey,
    model: state.activeModel
  });
}

export async function POST(req: Request) {
  try {
    const { apiKey, geminiApiKey, model } = await req.json();
    if (apiKey !== undefined) state.openaiApiKey = apiKey;
    if (geminiApiKey !== undefined) state.geminiApiKey = geminiApiKey;
    if (model !== undefined) state.activeModel = model;
    return NextResponse.json({
      status: "ok",
      hasOpenAiKey: !!state.openaiApiKey,
      hasGeminiKey: !!state.geminiApiKey,
      model: state.activeModel
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
