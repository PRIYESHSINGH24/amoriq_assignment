import express, { Request, Response } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

interface Tool {
  name: string;
  description: string;
  schema: {
    type: string;
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}

// ---- MCP SPEC ----
const tools: Tool[] = [
  {
    name: "list_files",
    description: "List files in a directory (non‑recursive).",
    schema: {
      type: "object",
      properties: { dir: { type: "string", description: "Directory path" } },
      required: ["dir"]
    }
  },
  {
    name: "read_file",
    description: "Read the contents of a text file.",
    schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path" } },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write content to a file, creating parent directories if needed.",
    schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute file path" },
        content: { type: "string", description: "File content" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "delete_file",
    description: "Delete a file at the given path.",
    schema: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path" } },
      required: ["path"]
    }
  }
];

app.get("/tools", (req: Request, res: Response) => {
  res.json({ tools });
});

app.post("/execute", async (req: Request, res: Response) => {
  const { tool, args } = req.body;
  try {
    let result;
    switch (tool) {
      case "list_files":
        result = await listFiles(args.dir);
        break;
      case "read_file":
        result = await readFile(args.path);
        break;
      case "write_file":
        result = await writeFile(args.path, args.content);
        break;
      case "delete_file":
        result = await deleteFile(args.path);
        break;
      default:
        throw new Error(`Unknown tool ${tool}`);
    }
    res.json({ success: true, result });
  } catch (e: any) {
    console.error(e);
    res.status(400).json({ success: false, error: e.message });
  }
});

// ---- Implementations ----
function listFiles(dir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    fs.readdir(dir, { withFileTypes: true }, (err, entries) => {
      if (err) return reject(err);
      const files = entries.filter(e => e.isFile()).map(e => e.name);
      resolve(files);
    });
  });
}

function readFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) return reject(err);
      resolve(data);
    });
  });
}

function writeFile(filePath: string, content: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(filePath);
    fs.mkdir(dir, { recursive: true }, err => {
      if (err) return reject(err);
      fs.writeFile(filePath, content, "utf8", err => {
        if (err) return reject(err);
        resolve("written");
      });
    });
  });
}

function deleteFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    fs.unlink(filePath, err => {
      if (err) return reject(err);
      resolve("deleted");
    });
  });
}

const PORT = process.env.MCP_PORT || 4002;
app.listen(PORT, () => console.log(`Custom MCP server listening on http://localhost:${PORT}`));
