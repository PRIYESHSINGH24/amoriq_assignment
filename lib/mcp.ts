import axios from "axios";
import { state } from "./state";

export async function discoverTools() {
  const tools: Record<string, any[]> = {};
  for (const base of state.mcpServers) {
    try {
      const resp = await axios.get(`${base}/tools`, { timeout: 3000 });
      tools[base] = resp.data.tools || [];
    } catch (e: any) {
      console.warn(`Failed to fetch tools from ${base}: ${e.message}`);
    }
  }
  return tools;
}
