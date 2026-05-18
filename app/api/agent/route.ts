import { NextResponse } from "next/server";
import axios from "axios";
import { OpenAI } from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { state } from "@/lib/state";
import { evaluateTool } from "@/lib/policy";
import { discoverTools } from "@/lib/mcp";

// Standard cost calculators
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

// Convert dynamic tool JSON Schema to Google Gemini parameter format
function convertSchemaToGemini(schema: any): any {
  if (!schema) return undefined;
  
  const typeMap: Record<string, string> = {
    "string": "STRING",
    "number": "NUMBER",
    "integer": "INTEGER",
    "boolean": "BOOLEAN",
    "object": "OBJECT",
    "array": "ARRAY"
  };

  const result: any = {};
  if (schema.type) {
    result.type = typeMap[schema.type.toLowerCase()] || "STRING";
  }
  if (schema.properties) {
    result.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) {
      result.properties[k] = convertSchemaToGemini(v);
    }
  }
  if (schema.required) {
    result.required = schema.required;
  }
  if (schema.description) {
    result.description = schema.description;
  }
  return result;
}

export async function POST(req: Request) {
  try {
    const { message, history = [] } = await req.json();
    const logs: string[] = [];
    const discovered = await discoverTools();

    // -------------------------------------------------------------
    // PRIMARY MODE: Google Gemini API
    // -------------------------------------------------------------
    if (state.geminiApiKey) {
      logs.push(`🤖 Running live Gemini tool-use loop with Model: ${state.activeModel}`);
      try {
        const genAI = new GoogleGenerativeAI(state.geminiApiKey);
        
        // Map dynamic MCP tools to Gemini function declarations
        const functionDeclarations: any[] = [];
        for (const [server, list] of Object.entries(discovered)) {
          list.forEach((t: any) => {
            functionDeclarations.push({
              name: t.name,
              description: t.description,
              parameters: convertSchemaToGemini(t.schema)
            });
          });
        }

        const model = genAI.getGenerativeModel({
          model: state.activeModel.startsWith("gemini") ? state.activeModel : "gemini-1.5-flash",
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined
        });

        // Format history into Gemini content structures
        const contents: any[] = [];
        history.forEach((msg: any) => {
          contents.push({
            role: msg.sender === "user" ? "user" : "model",
            parts: [{ text: msg.text }]
          });
        });
        contents.push({ role: "user", parts: [{ text: message }] });

        // Call Gemini Model
        const result = await model.generateContent({ contents });
        const responseText = result.response.text() || "";
        const functionCalls = result.response.functionCalls() || [];

        // Estimate default tokens (Gemini SDK has built-in countTokens but this requires a separate promise, we approximate or return 0 for efficiency)
        const totalCost = calculateGeminiCost(message.length / 4, responseText.length / 4);

        if (functionCalls.length > 0) {
          const functionCall = functionCalls[0];
          const toolName = functionCall.name;
          const toolArgs = functionCall.args as any;

          logs.push(`Agent decided to call tool: ${toolName}`);

          // --- Enforce Guardrails ---
          const decision = evaluateTool(toolName, toolArgs);
          if (!decision.allowed) {
            logs.push(`❌ Policy Blocked: ${decision.reason}`);
            return NextResponse.json({
              reply: `I wanted to use the tool "${toolName}" to help you, but it was blocked by the dashboard guardrails: ${decision.reason}`,
              logs,
              blocked: true,
              usage: {
                promptTokens: Math.floor(message.length / 4),
                completionTokens: 20,
                totalTokens: Math.floor(message.length / 4) + 20,
                costUsd: calculateGeminiCost(message.length / 4, 20)
              }
            });
          }

          if (decision.requiresApproval) {
            logs.push(`⚠️ Policy Flagged: ${decision.reason}`);
            return NextResponse.json({
              reply: `I need human approval to execute "${toolName}". The request is queued.`,
              logs,
              requiresApproval: true,
              toolCall: {
                id: "gemini_call",
                name: toolName,
                args: toolArgs
              },
              conversationState: { contents, candidate: result.response.candidates?.[0]?.content }, // save conversation stream
              usage: {
                promptTokens: Math.floor(message.length / 4),
                completionTokens: 30,
                totalTokens: Math.floor(message.length / 4) + 30,
                costUsd: calculateGeminiCost(message.length / 4, 30)
              }
            });
          }

          // --- Execute tool via custom MCP server ---
          logs.push(`✅ Policy Allowed. Executing tool on MCP server...`);
          try {
            const serverUrl = "http://localhost:4002"; 
            const execResp = await axios.post(`${serverUrl}/execute`, {
              tool: toolName,
              args: toolArgs
            });
            const toolResult = execResp.data.result;
            logs.push(`Execution Result: ${JSON.stringify(toolResult)}`);

            // Append function call and function response content streams
            contents.push(result.response.candidates?.[0]?.content);
            contents.push({
              role: "function",
              parts: [{
                functionResponse: {
                  name: toolName,
                  response: { result: toolResult }
                }
              }]
            });

            // Call model again with the function response!
            const finalResult = await model.generateContent({ contents });
            const finalReply = finalResult.response.text() || "";

            return NextResponse.json({
              reply: finalReply,
              logs,
              success: true,
              usage: {
                promptTokens: Math.floor(contents.reduce((acc, c) => acc + JSON.stringify(c).length, 0) / 4),
                completionTokens: Math.floor(finalReply.length / 4),
                totalTokens: Math.floor(contents.reduce((acc, c) => acc + JSON.stringify(c).length, 0) / 4) + Math.floor(finalReply.length / 4),
                costUsd: calculateGeminiCost(
                  contents.reduce((acc, c) => acc + JSON.stringify(c).length, 0) / 4,
                  finalReply.length / 4
                )
              }
            });
          } catch (e: any) {
            logs.push(`💥 Execution Failed: ${e.message}`);
            return NextResponse.json({
              reply: `I tried to execute the tool "${toolName}" but encountered a server error: ${e.message}`,
              logs,
              success: false
            });
          }
        }

        // Return regular reply if no tools called
        return NextResponse.json({
          reply: responseText,
          logs,
          usage: {
            promptTokens: Math.floor(message.length / 4),
            completionTokens: Math.floor(responseText.length / 4),
            totalTokens: Math.floor(message.length / 4) + Math.floor(responseText.length / 4),
            costUsd: totalCost
          }
        });
      } catch (e: any) {
        logs.push(`💥 Gemini LLM Error: ${e.message}`);
        return NextResponse.json({
          reply: `Sorry, I hit a Gemini LLM API error: ${e.message}`,
          logs
        });
      }
    }

    // -------------------------------------------------------------
    // FALLBACK MODE: OpenAI API
    // -------------------------------------------------------------
    if (state.openaiApiKey) {
      logs.push(`🤖 Running fallback OpenAI tool-use loop with Model: ${state.activeModel}`);
      try {
        const openai = new OpenAI({ apiKey: state.openaiApiKey });
        
        const openAiTools: any[] = [];
        for (const [server, list] of Object.entries(discovered)) {
          list.forEach((t: any) => {
            openAiTools.push({
              type: "function",
              function: {
                name: t.name,
                description: t.description,
                parameters: t.schema
              }
            });
          });
        }
        
        const messages: any[] = [];
        history.forEach((msg: any) => {
          messages.push({ role: msg.sender === "user" ? "user" : "assistant", content: msg.text });
        });
        messages.push({ role: "user", content: message });

        const response = await openai.chat.completions.create({
          model: state.activeModel.startsWith("gemini") ? "gpt-4o-mini" : state.activeModel,
          messages,
          tools: openAiTools.length > 0 ? openAiTools : undefined
        });

        const messageObj = response.choices[0].message;
        const usage = response.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        let totalCost = calculateOpenAiCost(usage.prompt_tokens, usage.completion_tokens);

        if (messageObj.tool_calls && messageObj.tool_calls.length > 0) {
          const toolCall = messageObj.tool_calls[0];
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          
          logs.push(`Agent decided to call tool: ${toolName}`);
          
          const decision = evaluateTool(toolName, toolArgs);
          if (!decision.allowed) {
            logs.push(`❌ Policy Blocked: ${decision.reason}`);
            return NextResponse.json({
              reply: `I wanted to use the tool "${toolName}" to help you, but it was blocked by the dashboard guardrails: ${decision.reason}`,
              logs,
              blocked: true,
              usage: {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
                costUsd: totalCost
              }
            });
          }

          if (decision.requiresApproval) {
            logs.push(`⚠️ Policy Flagged: ${decision.reason}`);
            return NextResponse.json({
              reply: `I need human approval to execute "${toolName}". The request is queued.`,
              logs,
              requiresApproval: true,
              toolCall: {
                id: toolCall.id,
                name: toolName,
                args: toolArgs
              },
              conversationState: { messages }, 
              usage: {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens,
                totalTokens: usage.total_tokens,
                costUsd: totalCost
              }
            });
          }

          logs.push(`✅ Policy Allowed. Executing tool on MCP server...`);
          try {
            const serverUrl = "http://localhost:4002"; 
            const execResp = await axios.post(`${serverUrl}/execute`, {
              tool: toolName,
              args: toolArgs
            });
            const result = execResp.data.result;
            logs.push(`Execution Result: ${JSON.stringify(result)}`);
            
            messages.push(messageObj);
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result)
            });
            
            const finalResponse = await openai.chat.completions.create({
              model: state.activeModel.startsWith("gemini") ? "gpt-4o-mini" : state.activeModel,
              messages
            });
            
            const finalReply = finalResponse.choices[0].message.content;
            const finalUsage = finalResponse.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
            totalCost += calculateOpenAiCost(finalUsage.prompt_tokens, finalUsage.completion_tokens);
            
            return NextResponse.json({
              reply: finalReply,
              logs,
              success: true,
              usage: {
                promptTokens: usage.prompt_tokens + finalUsage.prompt_tokens,
                completionTokens: usage.completion_tokens + finalUsage.completion_tokens,
                totalTokens: usage.total_tokens + finalUsage.total_tokens,
                costUsd: totalCost
              }
            });
          } catch (e: any) {
            logs.push(`💥 Execution Failed: ${e.message}`);
            return NextResponse.json({
              reply: `I tried to execute the tool "${toolName}" but encountered a server error: ${e.message}`,
              logs,
              success: false
            });
          }
        }

        return NextResponse.json({
          reply: messageObj.content,
          logs,
          usage: {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            costUsd: totalCost
          }
        });
      } catch (e: any) {
        logs.push(`💥 OpenAI LLM Error: ${e.message}`);
        return NextResponse.json({
          reply: `Sorry, I hit an LLM API error: ${e.message}`,
          logs
        });
      }
    }

    // -------------------------------------------------------------
    // DEFAULT SIMULATION MODE
    // -------------------------------------------------------------
    let toolCallRequested: any = null;

    if (message.toLowerCase().includes("write")) {
      toolCallRequested = {
        name: "write_file",
        args: { path: "/Users/priyeshsingh/Desktop/test.txt", content: "Hello World from Next.js Guarded Agent!" }
      };
    } else if (message.toLowerCase().includes("list")) {
      toolCallRequested = {
        name: "list_files",
        args: { dir: "/Users/priyeshsingh/Desktop" }
      };
    } else if (message.toLowerCase().includes("delete")) {
      toolCallRequested = {
        name: "delete_file",
        args: { path: "/Users/priyeshsingh/Desktop/test.txt" }
      };
    }

    if (toolCallRequested) {
      logs.push(`Agent decided to call tool: ${toolCallRequested.name}`);
      
      const decision = evaluateTool(toolCallRequested.name, toolCallRequested.args);
      if (!decision.allowed) {
        logs.push(`❌ Policy Blocked: ${decision.reason}`);
        return NextResponse.json({
          reply: `I wanted to use the tool "${toolCallRequested.name}" to help you, but it was blocked by the dashboard guardrails: ${decision.reason}`,
          logs,
          blocked: true
        });
      }

      if (decision.requiresApproval) {
        logs.push(`⚠️ Policy Flagged: ${decision.reason}`);
        return NextResponse.json({
          reply: `I need human approval to execute "${toolCallRequested.name}". The request is queued.`,
          logs,
          requiresApproval: true,
          toolCall: toolCallRequested
        });
      }

      logs.push(`✅ Policy Allowed. Executing tool on MCP server...`);
      try {
        const serverUrl = "http://localhost:4002"; 
        const resp = await axios.post(`${serverUrl}/execute`, {
          tool: toolCallRequested.name,
          args: toolCallRequested.args
        });
        logs.push(`Execution Result: ${JSON.stringify(resp.data.result)}`);
        return NextResponse.json({
          reply: `Successfully executed "${toolCallRequested.name}". Result: ${JSON.stringify(resp.data.result)}`,
          logs,
          success: true
        });
      } catch (e: any) {
        logs.push(`💥 Execution Failed: ${e.message}`);
        return NextResponse.json({
          reply: `Failed to execute tool "${toolCallRequested.name}": ${e.message}`,
          logs,
          success: false
        });
      }
    }

    return NextResponse.json({
      reply: `I'm a Next.js Guarded AI Agent! Try asking me to "write a file", "list files", or "delete a file" to test the real-time guardrails and policies.`,
      logs: ["No tool call triggered."],
      toolsAvailable: discovered
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
