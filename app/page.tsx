"use client";

import React, { useState, useEffect, useRef } from "react";
import { 
  Shield, Cpu, Settings, Terminal, Send, Plus, 
  Lock, CheckCircle2, AlertTriangle, XCircle, FolderOpen, Coins, BarChart3,
  Database, RefreshCw, Check
} from "lucide-react";

interface Tool {
  name: string;
  description: string;
  server: string;
  schema?: any;
}

interface Message {
  sender: "user" | "agent" | "system";
  text: string;
  requiresApproval?: boolean;
  toolCall?: {
    id?: string;
    name: string;
    args: any;
  };
  conversationState?: any;
  resolved?: boolean;
  resolvedStatus?: "approved" | "denied";
}

interface LogEntry {
  timestamp: string;
  text: string;
  type: "system" | "allow" | "block" | "warn";
}

export default function Dashboard() {
  // Config States
  const [apiKey, setApiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [model, setModel] = useState("gemini-1.5-flash");
  const [hasKey, setHasKey] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [configMsg, setConfigMsg] = useState("");

  // MCP Servers
  const [mcpServers, setMcpServers] = useState<string[]>([]);
  const [newServerUrl, setNewServerUrl] = useState("");

  // Tools & Policies
  const [discoveredTools, setDiscoveredTools] = useState<Tool[]>([]);
  const [blockedTools, setBlockedTools] = useState<string[]>([]);
  const [approvalRequired, setApprovalRequired] = useState<string[]>([]);
  const [pathWhitelist, setPathWhitelist] = useState<string>("");

  // Chat Sandbox & Stats
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "system",
      text: "Welcome to Guarded AI Agent. Type <em>\"write a file\"</em> or <em>\"list files\"</em> to run guardrail evaluations."
    }
  ]);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [sessionCost, setSessionCost] = useState(0.0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [policyBlocksCount, setPolicyBlocksCount] = useState(0);

  // Monitor logs
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initial Data Fetch
  useEffect(() => {
    setLogs([
      { timestamp: new Date().toLocaleTimeString(), text: "[SYSTEM] Policy engine initialized. Listening to MCP transport rules.", type: "system" }
    ]);
    fetchConfig();
    fetchServers();
    fetchToolsAndPolicies();
    setupSSE();
  }, []);

  const addLog = (text: string, type: "system" | "allow" | "block" | "warn" = "system") => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      text,
      type
    }]);

    if (type === "block") {
      setPolicyBlocksCount(c => c + 1);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setHasKey(data.hasOpenAiKey);
      setHasGeminiKey(data.hasGeminiKey);
      setModel(data.model);
    } catch (e: any) {
      console.error(e);
    }
  };

  const fetchServers = async () => {
    try {
      const res = await fetch("/api/mcp-servers");
      const data = await res.json();
      setMcpServers(data.servers || []);
    } catch (e: any) {
      addLog(`Error loading servers: ${e.message}`, "block");
    }
  };

  const fetchToolsAndPolicies = async () => {
    try {
      const pRes = await fetch("/api/policy");
      const pData = await pRes.json();
      setBlockedTools(pData.blockedTools || []);
      setApprovalRequired(pData.approvalRequired || []);
      setPathWhitelist((pData.pathWhitelist || []).join("\n"));

      const tRes = await fetch("/api/tools");
      const tData = await tRes.json();
      setDiscoveredTools(tData.tools || []);
    } catch (e: any) {
      addLog(`Error loading policy or tools: ${e.message}`, "block");
    }
  };

  const setupSSE = () => {
    const evtSource = new EventSource("/api/policy/stream");

    evtSource.onmessage = (e) => {
      try {
        const policy = JSON.parse(e.data);
        setBlockedTools(policy.blockedTools || []);
        setApprovalRequired(policy.approvalRequired || []);
        setPathWhitelist((policy.pathWhitelist || []).join("\n"));
        addLog("⚡ Live Policy synchronised successfully.", "warn");
      } catch (e) {
        console.error("Failed to parse SSE data", e);
      }
    };

    evtSource.onerror = () => {
      console.warn("SSE connection closed.");
    };
  };

  const saveConfig = async () => {
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey ? apiKey : undefined,
          geminiApiKey: geminiApiKey ? geminiApiKey : undefined,
          model
        })
      });
      const data = await res.json();
      addLog(`LLM Config updated. Model set to ${model}`, "system");
      setHasKey(data.hasOpenAiKey);
      setHasGeminiKey(data.hasGeminiKey);
      setApiKey("");
      setGeminiApiKey("");
      setConfigMsg("Loaded successfully.");
      setTimeout(() => setConfigMsg(""), 3000);
    } catch (e: any) {
      addLog(`Failed to save configuration: ${e.message}`, "block");
    }
  };

  const registerServer = async () => {
    if (!newServerUrl.trim()) return;
    addLog(`Registering MCP Server: ${newServerUrl}`);
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newServerUrl })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Connection failed");
      }
      const data = await res.json();
      addLog(`Successfully registered MCP server: ${newServerUrl}`, "allow");
      setNewServerUrl("");
      setMcpServers(data.servers);
      fetchToolsAndPolicies();
    } catch (e: any) {
      addLog(`Failed to add MCP server: ${e.message}`, "block");
    }
  };

  const unregisterServer = async (url: string) => {
    try {
      const res = await fetch("/api/mcp-servers", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const data = await res.json();
      addLog(`Removed MCP server: ${url}`);
      setMcpServers(data.servers);
      fetchToolsAndPolicies();
    } catch (e: any) {
      addLog(`Failed to delete server: ${e.message}`, "block");
    }
  };

  const updatePolicy = async (patch: Partial<{ blockedTools: string[]; approvalRequired: string[]; pathWhitelist: string[] }>) => {
    try {
      const merged = {
        blockedTools: patch.blockedTools !== undefined ? patch.blockedTools : blockedTools,
        approvalRequired: patch.approvalRequired !== undefined ? patch.approvalRequired : approvalRequired,
        pathWhitelist: patch.pathWhitelist !== undefined ? patch.pathWhitelist : pathWhitelist.split("\n").map(l => l.trim()).filter(Boolean)
      };

      await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(merged)
      });
    } catch (e: any) {
      addLog(`Failed to update policy: ${e.message}`, "block");
    }
  };

  const savePathWhitelist = async () => {
    const lines = pathWhitelist.split("\n").map(l => l.trim()).filter(Boolean);
    await updatePolicy({ pathWhitelist: lines });
    addLog("Filepath whitelist policy saved.", "allow");
  };

  const updateStats = (usage: any) => {
    if (usage) {
      if (usage.costUsd) setSessionCost(c => c + usage.costUsd);
      if (usage.totalTokens) setTotalTokens(t => t + usage.totalTokens);
    }
  };

  const sendMessage = async () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    
    setMessages(prev => [...prev, { sender: "user", text }]);
    const newHistory = [...chatHistory, { sender: "user", text }];
    setChatHistory(newHistory);
    setChatInput("");

    try {
      addLog(`Auditing query: "${text}"`);
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: newHistory })
      });

      const result = await res.json();
      
      setMessages(prev => [...prev, {
        sender: "agent",
        text: result.reply,
        requiresApproval: result.requiresApproval,
        toolCall: result.toolCall,
        conversationState: result.conversationState
      }]);

      if (!result.requiresApproval) {
        setChatHistory(prev => [...prev, { sender: "assistant", text: result.reply }]);
      }

      if (result.logs) {
        result.logs.forEach((log: string) => {
          let type: "system" | "allow" | "block" | "warn" = "system";
          if (log.includes("❌") || log.includes("Blocked")) type = "block";
          else if (log.includes("✅") || log.includes("Allowed") || log.includes("Result")) type = "allow";
          else if (log.includes("⚠️") || log.includes("Flagged") || log.includes("approval")) type = "warn";
          addLog(log, type);
        });
      }
      updateStats(result.usage);
    } catch (e: any) {
      setMessages(prev => [...prev, { sender: "agent", text: "Connection error with gateway." }]);
      addLog(`Agent gateway failure: ${e.message}`, "block");
    }
  };

  const handleApprove = async (msgIndex: number, toolCall: any, conversationState: any) => {
    addLog(`Admin authorized execution for ${toolCall.name}.`, "allow");
    try {
      const res = await fetch("/api/agent/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolCall, conversationState })
      });
      const result = await res.json();
      
      setMessages(prev => prev.map((msg, idx) => {
        if (idx === msgIndex) {
          return { ...msg, resolved: true, resolvedStatus: "approved" };
        }
        return msg;
      }));

      setMessages(prev => [...prev, { sender: "agent", text: result.reply }]);
      setChatHistory(prev => [...prev, { sender: "assistant", text: result.reply }]);
      
      if (result.logs) {
        result.logs.forEach((log: string) => addLog(log, "allow"));
      }
      updateStats(result.usage);
    } catch (e: any) {
      addLog(`Approval execution failed: ${e.message}`, "block");
    }
  };

  const handleDeny = (msgIndex: number, toolCall: any) => {
    setMessages(prev => prev.map((msg, idx) => {
      if (idx === msgIndex) {
        return { ...msg, resolved: true, resolvedStatus: "denied" };
      }
      return msg;
    }));
    addLog(`🙋‍♂️ Rejected tool execution: ${toolCall.name}`, "block");
  };

  return (
    <div className="min-h-screen text-zinc-100 font-sans bg-[#09090b] flex flex-col">
      
      {/* HEADER: Sleek Vercel-like Top Bar */}
      <header className="border-b border-zinc-800 bg-[#09090b] sticky top-0 z-40">
        <div className="max-w-[1280px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-zinc-100" />
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-sm tracking-tight text-white font-mono uppercase">
                AMORIQ / GATEWAY
              </h1>
              <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span>
              <span className="text-[10px] font-mono text-zinc-500 uppercase">SYS_OK</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={fetchToolsAndPolicies}
              className="px-3 py-1.5 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 transition-all flex items-center gap-1.5 text-[11px] font-mono text-zinc-300"
            >
              <RefreshCw className="w-3 h-3 text-zinc-400" />
              Sync Rules
            </button>
          </div>
        </div>
      </header>

      {/* METRICS ROW */}
      <section className="border-b border-zinc-800 bg-[#0c0c0e]">
        <div className="max-w-[1280px] mx-auto px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Cumulative Cost</span>
            <div className="text-xl font-bold font-mono text-white mt-1">
              ${sessionCost.toFixed(5)}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Token Overhead</span>
            <div className="text-xl font-bold font-mono text-white mt-1">
              {totalTokens.toLocaleString()}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Policy Blocks</span>
            <div className="text-xl font-bold font-mono text-red-500 mt-1">
              {policyBlocksCount}
            </div>
          </div>
          <div>
            <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">Connected Nodes</span>
            <div className="text-xl font-bold font-mono text-zinc-300 mt-1">
              {mcpServers.length} Active
            </div>
          </div>
        </div>
      </section>

      {/* CORE WORKSPACE PANELS */}
      <main className="max-w-[1280px] w-full mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
        
        {/* LEFT COLUMN: Policies & Registries (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col gap-8">
          
          {/* Card 1: Configuration */}
          <section className="bg-[#0c0c0e] border border-zinc-800 p-6 rounded-lg shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 mb-2 flex items-center gap-2 font-mono">
              <Settings className="w-3.5 h-3.5 text-zinc-400" />
              Cognitive Gateway
            </h3>
            <p className="text-[11px] text-zinc-500 mb-4">Provide Google Gemini API credentials. Preloads automatically from environment variables on launch.</p>
            
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[9px] font-mono uppercase text-zinc-500 block mb-1">Google Gemini API Key</label>
                <input 
                  type="password"
                  value={geminiApiKey}
                  onChange={e => setGeminiApiKey(e.target.value)}
                  placeholder={hasGeminiKey ? "•••••••••••••••• (Gemini API Key Loaded from .env)" : "Enter Gemini API Key (AIzaSy...)"}
                  className="w-full bg-[#09090b] border border-zinc-850 rounded px-3 py-2 text-xs text-white placeholder-zinc-650 focus:outline-none focus:border-zinc-500 transition-all font-mono"
                />
              </div>
              <div>
                <label className="text-[9px] font-mono uppercase text-zinc-500 block mb-1">OpenAI API Key (Optional)</label>
                <input 
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={hasKey ? "•••••••••••••••• (OpenAI API Key Active)" : "Enter OpenAI API Key (sk-...)"}
                  className="w-full bg-[#09090b] border border-zinc-850 rounded px-3 py-2 text-xs text-white placeholder-zinc-650 focus:outline-none focus:border-zinc-500 transition-all font-mono"
                />
              </div>
              <div className="flex gap-2">
                <select 
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  className="flex-1 bg-[#09090b] border border-zinc-850 rounded px-2 py-2 text-xs text-white focus:outline-none focus:border-zinc-500 transition-all font-mono"
                >
                  <option value="gemini-1.5-flash">gemini-1.5-flash (Primary Default)</option>
                  <option value="gemini-1.5-pro">gemini-1.5-pro (Reasoning)</option>
                  <option value="gpt-4o-mini">gpt-4o-mini (Fallback)</option>
                  <option value="gpt-4o">gpt-4o (Fallback)</option>
                </select>
                <button 
                  onClick={saveConfig}
                  className="bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-semibold px-4 py-2 rounded transition-all"
                >
                  Update
                </button>
              </div>
            </div>
            {configMsg && <div className="text-[10px] text-zinc-400 font-mono mt-2 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> {configMsg}
            </div>}
          </section>

          {/* Card 2: Dynamic MCP Registries */}
          <section className="bg-[#0c0c0e] border border-zinc-800 p-6 rounded-lg shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 mb-2 flex items-center gap-2 font-mono">
              <Database className="w-3.5 h-3.5 text-zinc-400" />
              MCP Node Transport
            </h3>
            <p className="text-[11px] text-zinc-500 mb-4">Register live transport nodes at runtime. Discovered tools populate automatically.</p>
            
            <div className="flex gap-2 mb-4">
              <input 
                type="text"
                value={newServerUrl}
                onChange={e => setNewServerUrl(e.target.value)}
                placeholder="e.g. http://localhost:4002"
                className="flex-1 bg-[#09090b] border border-zinc-850 rounded px-3 py-2 text-xs text-white placeholder-zinc-650 focus:outline-none focus:border-zinc-500 transition-all font-mono"
              />
              <button 
                onClick={registerServer}
                className="bg-zinc-900 border border-zinc-800 text-zinc-250 hover:bg-zinc-800 text-xs font-semibold px-4 py-2 rounded transition-all flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {mcpServers.length === 0 ? (
                <div className="text-xs text-zinc-500 py-1">No registered nodes.</div>
              ) : (
                mcpServers.map(url => (
                  <div key={url} className="flex items-center justify-between bg-zinc-900/50 border border-zinc-850 px-3 py-2 rounded text-xs">
                    <span className="font-mono text-zinc-400">{url}</span>
                    <button 
                      onClick={() => unregisterServer(url)}
                      className="text-zinc-500 hover:text-red-400 text-[10px] font-mono transition-all"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Card 3: Guardrails */}
          <section className="bg-[#0c0c0e] border border-zinc-800 p-6 rounded-lg shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 mb-2 flex items-center gap-2 font-mono">
              <Lock className="w-3.5 h-3.5 text-zinc-400" />
              Guardrail Registry
            </h3>
            <p className="text-[11px] text-zinc-500 mb-4">Toggle static policy boundaries dynamically. Interceptions execute before server execution.</p>

            <div className="flex justify-between px-3 py-1.5 bg-zinc-900/50 rounded text-[9px] font-bold text-zinc-500 uppercase tracking-widest font-mono mb-3 border border-zinc-850">
              <span>Tool Identifier</span>
              <span>Block / Approve</span>
            </div>

            <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
              {discoveredTools.length === 0 ? (
                <div className="text-xs text-zinc-500 text-center py-6">No tools discoverable.</div>
              ) : (
                discoveredTools.map(tool => {
                  const isBlocked = blockedTools.includes(tool.name);
                  const needsApproval = approvalRequired.includes(tool.name);
                  
                  return (
                    <div key={tool.name} className="flex items-center justify-between bg-zinc-900/20 border border-zinc-850 px-3 py-2.5 rounded hover:bg-zinc-900/60 transition-all">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-xs text-zinc-200">{tool.name}</span>
                        <span className="font-mono text-[9px] text-zinc-500">{tool.server}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        
                        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={isBlocked}
                            onChange={async (e) => {
                              let list = [...blockedTools];
                              if (e.target.checked) {
                                if (!list.includes(tool.name)) list.push(tool.name);
                              } else {
                                list = list.filter(n => n !== tool.name);
                              }
                              setBlockedTools(list);
                              await updatePolicy({ blockedTools: list });
                            }}
                            className="w-3.5 h-3.5 bg-[#09090b] border-zinc-800 rounded text-zinc-100 accent-zinc-200"
                          />
                          Block
                        </label>

                        <label className="inline-flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={needsApproval}
                            onChange={async (e) => {
                              let list = [...approvalRequired];
                              if (e.target.checked) {
                                if (!list.includes(tool.name)) list.push(tool.name);
                              } else {
                                list = list.filter(n => n !== tool.name);
                              }
                              setApprovalRequired(list);
                              await updatePolicy({ approvalRequired: list });
                            }}
                            className="w-3.5 h-3.5 bg-[#09090b] border-zinc-800 rounded text-zinc-100 accent-zinc-200"
                          />
                          Approve
                        </label>

                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Card 4: Whitelists */}
          <section className="bg-[#0c0c0e] border border-zinc-800 p-6 rounded-lg shadow-sm">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 mb-2 flex items-center gap-2 font-mono">
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              Path Whitelist
            </h3>
            <p className="text-[11px] text-zinc-500 mb-4">Allowed working file path directory boundaries. Enforced programmatically.</p>
            
            <textarea 
              rows={3}
              value={pathWhitelist}
              onChange={e => setPathWhitelist(e.target.value)}
              placeholder="Enter allowed prefixes (e.g. /Users/priyeshsingh/Desktop/amoriq_assignment)"
              className="w-full bg-[#09090b] border border-zinc-850 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-500 transition-all font-mono mb-3"
            />
            <button 
              onClick={savePathWhitelist}
              className="bg-zinc-900 border border-zinc-800 text-zinc-250 hover:bg-zinc-800 text-xs font-semibold px-4 py-2 rounded transition-all"
            >
              Apply Filter Path
            </button>
          </section>

        </div>

        {/* RIGHT COLUMN: Terminal Sandbox & Audit Logs (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col gap-8">
          
          {/* Chat Panel */}
          <section className="bg-[#0c0c0e] border border-zinc-800 p-6 rounded-lg shadow-sm flex flex-col h-[520px]">
            <div className="flex items-center justify-between mb-4 border-b border-zinc-850 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2 font-mono">
                <Cpu className="w-3.5 h-3.5 text-zinc-400" />
                Guarded Agent Sandbox
              </h3>
              <span className="text-[9px] font-mono text-zinc-500 uppercase bg-zinc-900/60 px-2 py-0.5 rounded border border-zinc-800">
                {hasKey ? "Live LLM" : "Simulation"} Mode
              </span>
            </div>
            
            {/* Messages Area */}
            <div className="flex-1 bg-[#09090b] border border-zinc-850 rounded p-4 overflow-y-auto flex flex-col gap-4 mb-4">
              {messages.map((msg, index) => {
                if (msg.sender === "system") {
                  return (
                    <div key={index} className="bg-zinc-900/60 border border-zinc-800 text-zinc-400 text-[11px] px-4 py-2.5 rounded text-center font-mono">
                      <span dangerouslySetInnerHTML={{ __html: msg.text }} />
                    </div>
                  );
                }
                
                const isUser = msg.sender === "user";
                return (
                  <div 
                    key={index}
                    className={`flex flex-col max-w-[85%] rounded px-4 py-2.5 text-xs ${
                      isUser 
                        ? "bg-zinc-900 border border-zinc-800 text-white self-end rounded-br-none" 
                        : "bg-zinc-900/30 border border-zinc-850 text-zinc-300 self-start rounded-bl-none"
                    }`}
                  >
                    <div className="text-[8px] uppercase tracking-wider text-zinc-500 font-mono mb-1 font-bold">
                      {isUser ? "👤 Admin" : "🤖 Agent"}
                    </div>
                    <span>{msg.text}</span>
                    
                    {/* Approval Interactive Card */}
                    {msg.requiresApproval && !msg.resolved && (
                      <div className="mt-3 bg-[#0c0c0e] border border-zinc-800 rounded p-3 flex flex-col gap-2">
                        <span className="font-semibold text-[10px] text-amber-500 flex items-center gap-1 font-mono uppercase">
                          <AlertTriangle className="w-3 h-3" />
                          Awaiting authorization for: {msg.toolCall?.name}
                        </span>
                        <pre className="text-[9px] bg-[#09090b] border border-zinc-850 p-2.5 rounded text-zinc-400 font-mono">
                          {JSON.stringify(msg.toolCall?.args, null, 2)}
                        </pre>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleApprove(index, msg.toolCall, msg.conversationState)}
                            className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold px-3 py-1.5 rounded transition-all"
                          >
                            Approve
                          </button>
                          <button 
                            onClick={() => handleDeny(index, msg.toolCall)}
                            className="bg-red-650 hover:bg-red-500 text-white text-[10px] font-bold px-3 py-1.5 rounded transition-all"
                          >
                            Deny
                          </button>
                        </div>
                      </div>
                    )}

                    {msg.resolved && (
                      <div className={`text-[9px] font-semibold uppercase mt-2 flex items-center gap-1 font-mono ${
                        msg.resolvedStatus === "approved" ? "text-emerald-500" : "text-red-500"
                      }`}>
                        {msg.resolvedStatus === "approved" ? "✓ Authorized & Executed" : "✕ Authorization Refused"}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="flex gap-3">
              <input 
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && sendMessage()}
                placeholder="Type command (e.g. 'write a file', 'list files')..."
                className="flex-1 bg-[#09090b] border border-zinc-850 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-650 transition-all font-mono"
              />
              <button 
                onClick={sendMessage}
                className="bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-semibold px-4 py-2 rounded transition-all flex items-center gap-1.5"
              >
                <Send className="w-3 h-3" /> Run
              </button>
            </div>
          </section>

          {/* Logs Terminal */}
          <section className="bg-[#0c0c0e] border border-zinc-800 p-6 rounded-lg shadow-sm flex flex-col flex-1">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300 mb-2 flex items-center gap-2 font-mono">
              <Terminal className="w-3.5 h-3.5 text-zinc-400" />
              Evaluation Stream Trace
            </h3>
            <p className="text-[11px] text-zinc-500 mb-4 font-mono uppercase tracking-wider text-[9px]">Programmatic Boundary Decisions</p>
            
            <div className="bg-[#09090b] border border-zinc-850 rounded h-[180px] overflow-y-auto p-4 flex flex-col gap-2 font-mono text-[10px] leading-relaxed">
              {logs.map((log, index) => {
                let colorClass = "text-zinc-400";
                if (log.type === "allow") colorClass = "text-emerald-500";
                if (log.type === "block") colorClass = "text-red-500";
                if (log.type === "warn") colorClass = "text-amber-500";
                
                return (
                  <div key={index} className="py-0.5 border-b border-zinc-900 last:border-b-0 flex items-start gap-2">
                    <span className="text-zinc-600 shrink-0">[{log.timestamp}]</span>
                    <span className={colorClass}>{log.text}</span>
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}
