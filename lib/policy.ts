import { state } from "./state";

export interface Evaluation {
  allowed: boolean;
  requiresApproval: boolean;
  reason?: string;
}

export function evaluateTool(toolName: string, args: any): Evaluation {
  const policy = state.policy;

  // 1. Blocked Tools validation (highest priority)
  if (policy.blockedTools && policy.blockedTools.includes(toolName)) {
    return {
      allowed: false,
      requiresApproval: false,
      reason: `Tool "${toolName}" is blocked by system security policy.`
    };
  }

  // 2. Human Approval validation (second priority)
  if (policy.approvalRequired && policy.approvalRequired.includes(toolName)) {
    return {
      allowed: true,
      requiresApproval: true,
      reason: `Tool "${toolName}" requires manual admin approval.`
    };
  }

  // 3. Path Whitelisting validation (e.g., CRUD file paths)
  if (args) {
    const pathKeys = ["path", "dir", "filepath", "folder", "filename"];
    for (const key of pathKeys) {
      if (args[key] !== undefined && typeof args[key] === "string") {
        const val = args[key].trim();
        const whitelist = policy.pathWhitelist || [];
        
        // If whitelist is set, verify path starts with at least one prefix
        if (whitelist.length > 0) {
          const isAllowed = whitelist.some(prefix => val.startsWith(prefix));
          if (!isAllowed) {
            return {
              allowed: false,
              requiresApproval: false,
              reason: `File path "${val}" is outside allowed workspace directory whitelists: [${whitelist.join(", ")}].`
            };
          }
        }
      }
    }
  }

  // Default allow
  return {
    allowed: true,
    requiresApproval: false
  };
}
