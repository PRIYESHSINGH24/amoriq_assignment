import { NextResponse } from "next/server";
import axios from "axios";
import { OpenAI } from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { state } from "@/lib/state";

function calculateOpenAiCost(promptTokens: number, completionTokens: number): number {
  const inputRate = 0.15 / 1000000;
  const outputRate = 0.60 / 1000000;
  return (promptTokens * inputRate) + (completionTokens * outputRate);
}

function calculateGeminiCost(promptTokens: number, completionTokens: number): number {
  const inputRate = 0.075 / 1000000;
  const outputRate = 0.30 / 1000000;
  return (promptTokens * inputRate) + (completionTokens * outputRate);
}

export async function POST(req: Request) {
  try {
    const { toolCall, conversationState } = await req.json();
    const simulatedLogs: string[] = [];
    
    simulatedLogs.push(`🙋‍♂️ Admin Approved execution of: ${toolCall.name}`);
    
    // 1. Execute tool via MCP
    const serverUrl = "http://localhost:4002"; 
    const resp = await axios.post(`${serverUrl}/execute`, {
      tool: toolCall.name,
      args: toolCall.args
    });
    const result = resp.data.result;
    simulatedLogs.push(`Execution Result: ${JSON.stringify(result)}`);
    
    // -------------------------------------------------------------
    // PRIMARY RESOLVER: Google Gemini thread continuation
    // -------------------------------------------------------------
    if (state.geminiApiKey && conversationState && conversationState.contents) {
      simulatedLogs.push(`🤖 Continuing Gemini function calling loop...`);
      try {
        const genAI = new GoogleGenerativeAI(state.geminiApiKey);
        const model = genAI.getGenerativeModel({
          model: state.activeModel.startsWith("gemini") ? state.activeModel : "gemini-1.5-flash"
        });

        const contents = conversationState.contents;
        
        // Append the tool request block from model candidate
        if (conversationState.candidate) {
          contents.push(conversationState.candidate);
        } else {
          contents.push({
            role: "model",
            parts: [{
              functionCall: {
                name: toolCall.name,
                args: toolCall.args
              }
            }]
          });
        }

        // Append the tool response block
        contents.push({
          role: "function",
          parts: [{
            functionResponse: {
              name: toolCall.name,
              response: { result }
            }
          }]
        });

        const finalResult = await model.generateContent({ contents });
        const finalReply = finalResult.response.text() || "";

        return NextResponse.json({
          reply: finalReply,
          logs: simulatedLogs,
          success: true,
          usage: {
            promptTokens: Math.floor(contents.reduce((acc: number, c: any) => acc + JSON.stringify(c).length, 0) / 4),
            completionTokens: Math.floor(finalReply.length / 4),
            totalTokens: Math.floor(contents.reduce((acc: number, c: any) => acc + JSON.stringify(c).length, 0) / 4) + Math.floor(finalReply.length / 4),
            costUsd: calculateGeminiCost(
              contents.reduce((acc: number, c: any) => acc + JSON.stringify(c).length, 0) / 4,
              finalReply.length / 4
            )
          }
        });
      } catch (e: any) {
        simulatedLogs.push(`💥 Gemini Continuation Failed: ${e.message}`);
        return NextResponse.json({
          reply: `Executed tool successfully but Gemini failed to generate final response: ${e.message}`,
          logs: simulatedLogs,
          success: false
        });
      }
    }

    // -------------------------------------------------------------
    // FALLBACK RESOLVER: OpenAI thread continuation
    // -------------------------------------------------------------
    if (state.openaiApiKey && conversationState && conversationState.messages) {
      simulatedLogs.push(`🤖 Continuing OpenAI function calling loop...`);
      try {
        const openai = new OpenAI({ apiKey: state.openaiApiKey });
        const messages = conversationState.messages;
        
        messages.push({
          role: "assistant",
          tool_calls: [{
            id: toolCall.id || "call_approved",
            type: "function",
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args) }
          }]
        });
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id || "call_approved",
          content: JSON.stringify(result)
        });
        
        const response = await openai.chat.completions.create({
          model: state.activeModel.startsWith("gemini") ? "gpt-4o-mini" : state.activeModel,
          messages
        });
        
        const finalReply = response.choices[0].message.content;
        const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        const cost = calculateOpenAiCost(usage.prompt_tokens, usage.completion_tokens);
        
        return NextResponse.json({
          reply: finalReply,
          logs: simulatedLogs,
          success: true,
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            costUsd: cost
          }
        });
      } catch (e: any) {
        simulatedLogs.push(`💥 OpenAI Continuation Failed: ${e.message}`);
        return NextResponse.json({
          reply: `Executed tool successfully but OpenAI failed to generate final response: ${e.message}`,
          logs: simulatedLogs,
          success: false
        });
      }
    }
    
    // 3. Fallback to Simulation completion
    return NextResponse.json({
      reply: `Successfully executed "${toolCall.name}" after admin approval. Result: ${JSON.stringify(result)}`,
      logs: simulatedLogs,
      success: true
    });
  } catch (e: any) {
    return NextResponse.json({
      reply: `Failed to execute approved tool: ${e.message}`,
      logs: [`💥 Execution Failed: ${e.message}`],
      success: false
    }, { status: 500 });
  }
}
