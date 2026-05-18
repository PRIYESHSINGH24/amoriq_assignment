// Global state container for Next.js hot-reloads and route requests
// Using a global symbol to prevent state loss during Next.js live compilations

export interface Policy {
  blockedTools: string[];
  approvalRequired: string[];
  pathWhitelist: string[];
}

interface GlobalState {
  policy: Policy;
  mcpServers: string[];
  openaiApiKey: string;
  geminiApiKey: string;
  activeModel: string;
  sseClients: Array<(data: string) => void>;
}

const GLOBAL_KEY = Symbol.for("guarded_ai_agent.state");

if (!(global as any)[GLOBAL_KEY]) {
  (global as any)[GLOBAL_KEY] = {
    policy: {
      blockedTools: [],
      approvalRequired: [],
      pathWhitelist: ["/Users/priyeshsingh/Desktop/amoriq_assignment"]
    },
    mcpServers: ["http://localhost:4002"],
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    activeModel: "gemini-2.5-flash",
    sseClients: []
  };
}

export const state: GlobalState = (global as any)[GLOBAL_KEY];

// Emitter helper for SSE policy propagation
export function emitPolicyUpdate() {
  const payload = JSON.stringify(state.policy);
  state.sseClients.forEach(callback => {
    try {
      callback(payload);
    } catch (e) {
      console.warn("Failed to write to SSE client connection", e);
    }
  });
}
